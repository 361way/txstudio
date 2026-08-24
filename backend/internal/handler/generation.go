package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultGenerationPageSize = 24
	maxGenerationPageSize     = 100
)

var allowedGenerationStatuses = map[string]bool{
	"queued": true, "running": true, "completed": true, "completed_with_errors": true,
	"failed": true, "cancelled": true,
}

var allowedGenerationTypes = map[string]bool{
	"image": true, "video": true, "agent": true, "mps": true, "compose": true,
}

type GenerationHandler struct {
	DB  *gorm.DB
	VOD *TencentInvokeHandler

	cloudSyncOnce sync.Once
	cloudSyncMu   sync.Mutex
	cloudImportMu sync.Mutex
}

type generationEventReq struct {
	Stage    string         `json:"stage"`
	Level    string         `json:"level"`
	Message  string         `json:"message"`
	Metadata map[string]any `json:"metadata"`
}

type generationAssetReq struct {
	Role            string         `json:"role"`
	Ordinal         int            `json:"ordinal"`
	MediaType       string         `json:"media_type"`
	CloudFileID     string         `json:"cloud_file_id"`
	CloudURL        string         `json:"cloud_url"`
	LocalPath       string         `json:"local_path"`
	StorageProvider string         `json:"storage_provider"`
	StorageMode     string         `json:"storage_mode"`
	MimeType        string         `json:"mime_type"`
	FileSize        int64          `json:"file_size"`
	Width           int            `json:"width"`
	Height          int            `json:"height"`
	Duration        float64        `json:"duration"`
	ExpiresAt       *time.Time     `json:"expires_at"`
	Metadata        map[string]any `json:"metadata"`
}

type createGenerationReq struct {
	ClientID     string               `json:"client_id" binding:"required"`
	ProjectID    *uint                `json:"project_id"`
	ParentJobID  *uint                `json:"parent_job_id"`
	Source       string               `json:"source" binding:"required"`
	Type         string               `json:"type" binding:"required"`
	Provider     string               `json:"provider"`
	Status       string               `json:"status"`
	Prompt       string               `json:"prompt"`
	ModelName    string               `json:"model_name"`
	ModelVersion string               `json:"model_version"`
	Parameters   map[string]any       `json:"parameters"`
	StorageMode  string               `json:"storage_mode"`
	Assets       []generationAssetReq `json:"assets"`
}

type updateGenerationReq struct {
	CloudTaskID  *string              `json:"cloud_task_id"`
	Status       *string              `json:"status"`
	Progress     *int                 `json:"progress"`
	ErrorCode    *string              `json:"error_code"`
	ErrorMessage *string              `json:"error_message"`
	FinishedAt   *time.Time           `json:"finished_at"`
	Parameters   map[string]any       `json:"parameters"`
	Assets       []generationAssetReq `json:"assets"`
	Event        *generationEventReq  `json:"event"`
}

type generationDetail struct {
	model.GenerationJob
	Assets []model.GenerationAsset `json:"assets"`
	Events []model.GenerationEvent `json:"events"`
}

type generationSyncResult struct {
	JobID       uint   `json:"job_id"`
	CloudTaskID string `json:"cloud_task_id"`
	Status      string `json:"status"`
	Outputs     int    `json:"outputs"`
	Message     string `json:"message"`
}

type importVODTaskReq struct {
	CloudTaskID string `json:"cloud_task_id"`
}

func cleanText(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) > max {
		return value[:max]
	}
	return value
}

func safeJSON(value map[string]any) string {
	if len(value) == 0 {
		return "{}"
	}
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded) > 256*1024 {
		return "{}"
	}
	return string(encoded)
}

func normalizeGenerationStatus(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if !allowedGenerationStatuses[value] {
		return ""
	}
	return value
}

func normalizeEventLevel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "warning", "error":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "info"
	}
}

func normalizedStorageMode(value string) string {
	value = cleanText(value, 32)
	if value == "Temporary" || value == "Permanent" {
		return value
	}
	return "Permanent"
}

func assetFromReq(jobID uint, item generationAssetReq) model.GenerationAsset {
	return model.GenerationAsset{
		JobID: jobID, Role: cleanText(item.Role, 64), Ordinal: item.Ordinal,
		MediaType: cleanText(item.MediaType, 32), CloudFileID: cleanText(item.CloudFileID, 255),
		CloudURL: cleanText(item.CloudURL, 4096), LocalPath: cleanText(item.LocalPath, 2048),
		StorageProvider: cleanText(item.StorageProvider, 32), StorageMode: normalizedStorageMode(item.StorageMode),
		MimeType: cleanText(item.MimeType, 128), FileSize: item.FileSize, Width: item.Width,
		Height: item.Height, Duration: item.Duration, ExpiresAt: item.ExpiresAt, Metadata: safeJSON(item.Metadata),
	}
}

func appendGenerationEvent(tx *gorm.DB, jobID uint, req generationEventReq) error {
	var maxSequence int
	if err := tx.Model(&model.GenerationEvent{}).Where("job_id = ?", jobID).
		Select("COALESCE(MAX(sequence), 0)").Scan(&maxSequence).Error; err != nil {
		return err
	}
	event := model.GenerationEvent{
		JobID: jobID, Sequence: maxSequence + 1, Stage: cleanText(req.Stage, 64),
		Level: normalizeEventLevel(req.Level), Message: cleanText(req.Message, 1000), Metadata: safeJSON(req.Metadata),
	}
	return tx.Create(&event).Error
}

func upsertGenerationAssets(tx *gorm.DB, jobID uint, items []generationAssetReq) error {
	for _, item := range items {
		if cleanText(item.Role, 64) == "" || item.Ordinal < 0 {
			continue
		}
		asset := assetFromReq(jobID, item)
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "job_id"}, {Name: "role"}, {Name: "ordinal"}},
			DoUpdates: clause.AssignmentColumns([]string{"media_type", "cloud_file_id", "cloud_url", "local_path", "storage_provider", "storage_mode", "mime_type", "file_size", "width", "height", "duration", "expires_at", "metadata", "updated_at"}),
		}).Create(&asset).Error; err != nil {
			return err
		}
	}
	return nil
}

func mapAny(value any) map[string]any {
	mapped, _ := value.(map[string]any)
	return mapped
}

func stringAny(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	default:
		return ""
	}
}

func intAny(value any) int {
	parsed, _ := strconv.Atoi(stringAny(value))
	return parsed
}

func floatAny(value any) float64 {
	parsed, _ := strconv.ParseFloat(stringAny(value), 64)
	return parsed
}

func vodTaskNode(response map[string]any) map[string]any {
	for _, key := range []string{"AigcImageTask", "AigcVideoTask", "SceneAigcImageTask", "SceneAigcVideoTask"} {
		if node := mapAny(response[key]); len(node) > 0 {
			return node
		}
	}
	return nil
}

func mediaTypeForGenerationJob(job model.GenerationJob) string {
	if job.Type == "video" {
		return "video"
	}
	return "image"
}

func mimeTypeForVODFile(fileType string) string {
	switch strings.ToLower(strings.TrimSpace(fileType)) {
	case "jpg", "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "webp":
		return "image/webp"
	case "mp4":
		return "video/mp4"
	case "mov":
		return "video/quicktime"
	default:
		return ""
	}
}

func extractVODOutputAssets(job model.GenerationJob, taskNode map[string]any) []generationAssetReq {
	output := mapAny(taskNode["Output"])
	fileInfos, _ := output["FileInfos"].([]any)
	assets := make([]generationAssetReq, 0, len(fileInfos))
	for _, value := range fileInfos {
		fileInfo := mapAny(value)
		fileURL := stringAny(fileInfo["FileUrl"])
		if !strings.HasPrefix(fileURL, "http://") && !strings.HasPrefix(fileURL, "https://") {
			continue
		}
		metadata := mapAny(fileInfo["MetaData"])
		assets = append(assets, generationAssetReq{
			Role:            "output",
			Ordinal:         len(assets),
			MediaType:       mediaTypeForGenerationJob(job),
			CloudFileID:     stringAny(fileInfo["FileId"]),
			CloudURL:        fileURL,
			StorageProvider: "tencent-vod",
			StorageMode:     normalizedStorageMode(job.StorageMode),
			MimeType:        mimeTypeForVODFile(stringAny(fileInfo["FileType"])),
			FileSize:        int64(floatAny(metadata["Size"])),
			Width:           intAny(metadata["Width"]),
			Height:          intAny(metadata["Height"]),
			Duration:        floatAny(metadata["Duration"]),
			Metadata: map[string]any{
				"cloud_task_status": stringAny(taskNode["Status"]),
				"file_type":         stringAny(fileInfo["FileType"]),
			},
		})
	}
	if len(assets) == 0 {
		// 部分 VOD 返回仅提供 URL 数组，不携带 FileInfos；仍可恢复可展示媒体。
		for _, key := range []string{"FileUrls", "Urls", "OutputUrls"} {
			values, _ := output[key].([]any)
			for _, value := range values {
				fileURL := stringAny(value)
				if strings.HasPrefix(fileURL, "http://") || strings.HasPrefix(fileURL, "https://") {
					assets = append(assets, generationAssetReq{
						Role: "output", Ordinal: len(assets), MediaType: mediaTypeForGenerationJob(job), CloudURL: fileURL,
						StorageProvider: "tencent-vod", StorageMode: normalizedStorageMode(job.StorageMode),
						Metadata: map[string]any{"cloud_task_status": stringAny(taskNode["Status"]), "output_field": key},
					})
				}
			}
		}
	}
	return assets
}

func (h *GenerationHandler) persistVODSync(job *model.GenerationJob, status string, progress int, errorCode, errorMessage string, assets []generationAssetReq, event generationEventReq) error {
	return h.DB.Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{
			"status":        status,
			"progress":      progress,
			"error_code":    cleanText(errorCode, 128),
			"error_message": cleanText(errorMessage, 4000),
		}
		if status == "completed" || status == "completed_with_errors" || status == "failed" || status == "cancelled" {
			now := time.Now()
			updates["finished_at"] = &now
		}
		if err := tx.Model(job).Updates(updates).Error; err != nil {
			return err
		}
		if err := upsertGenerationAssets(tx, job.ID, assets); err != nil {
			return err
		}
		return appendGenerationEvent(tx, job.ID, event)
	})
}

func (h *GenerationHandler) describeVODTask(taskID string) (map[string]any, map[string]any, string, error) {
	if h.VOD == nil {
		return nil, nil, "", fmt.Errorf("腾讯云同步服务未初始化")
	}
	_, _, rawResponse, err := h.VOD.CallRaw(nil, "DescribeTaskDetail", "2018-07-17", "", map[string]any{"TaskId": taskID})
	if err != nil {
		return nil, nil, "", err
	}
	var envelope struct {
		Response map[string]any `json:"Response"`
	}
	if err := json.Unmarshal(rawResponse, &envelope); err != nil {
		return nil, nil, "", fmt.Errorf("解析腾讯云任务响应失败")
	}
	if cloudError := mapAny(envelope.Response["Error"]); len(cloudError) > 0 {
		return nil, nil, "", fmt.Errorf("腾讯云任务查询失败: %s", stringAny(cloudError["Message"]))
	}
	taskNode := vodTaskNode(envelope.Response)
	if len(taskNode) == 0 {
		return nil, nil, "", fmt.Errorf("腾讯云响应未包含 AIGC 任务详情")
	}
	return envelope.Response, taskNode, strings.ToUpper(stringAny(envelope.Response["Status"])), nil
}

// SyncCloudTask 查询 VOD 的真实状态，并把完成结果原子写回统一生成历史。
func (h *GenerationHandler) SyncCloudTask(job *model.GenerationJob) (generationSyncResult, error) {
	h.cloudSyncMu.Lock()
	defer h.cloudSyncMu.Unlock()

	if err := h.DB.First(job, job.ID).Error; err != nil {
		return generationSyncResult{JobID: job.ID}, fmt.Errorf("生成任务不存在")
	}
	result := generationSyncResult{JobID: job.ID, CloudTaskID: job.CloudTaskID, Status: job.Status}
	if job.Provider != "tencent-vod" || strings.TrimSpace(job.CloudTaskID) == "" {
		return result, fmt.Errorf("该任务没有可同步的腾讯云任务 ID")
	}
	// 已有输出的成功任务无需重复查询或追加事件，保证手动同步幂等。
	if job.Status == "completed" {
		var outputs int64
		if err := h.DB.Model(&model.GenerationAsset{}).Where("job_id = ? AND role = ? AND cloud_url <> ''", job.ID, "output").Count(&outputs).Error; err != nil {
			return result, err
		}
		if outputs > 0 {
			result.Outputs = int(outputs)
			result.Message = "任务已同步完成"
			return result, nil
		}
	}
	_, taskNode, cloudStatus, err := h.describeVODTask(job.CloudTaskID)
	if err != nil {
		return result, err
	}
	progress := intAny(taskNode["Progress"])
	if progress < 0 || progress > 100 {
		progress = 0
	}
	if cloudStatus == "FINISH" {
		errorCode := stringAny(taskNode["ErrCodeExt"])
		if errorCode == "" || errorCode == "0" {
			errorCode = stringAny(taskNode["ErrCode"])
		}
		if errorCode != "" && errorCode != "0" {
			message := stringAny(taskNode["Message"])
			if message == "" {
				message = "腾讯云 AIGC 任务失败"
			}
			if err := h.persistVODSync(job, "failed", 100, errorCode, message, nil, generationEventReq{Stage: "cloud_sync_failed", Level: "error", Message: message}); err != nil {
				return result, err
			}
			result.Status = "failed"
			result.Message = message
			return result, nil
		}
		assets := extractVODOutputAssets(*job, taskNode)
		if len(assets) == 0 {
			message := "云端任务已完成，但未返回可展示的输出文件"
			if err := h.persistVODSync(job, "completed_with_errors", 100, "OUTPUT_NOT_FOUND", message, nil, generationEventReq{Stage: "cloud_sync_partial", Level: "warning", Message: message}); err != nil {
				return result, err
			}
			result.Status = "completed_with_errors"
			result.Message = message
			return result, nil
		}
		if err := h.persistVODSync(job, "completed", 100, "", "", assets, generationEventReq{Stage: "cloud_sync_completed", Level: "info", Message: "已从腾讯云同步完成结果", Metadata: map[string]any{"outputs": len(assets)}}); err != nil {
			return result, err
		}
		result.Status = "completed"
		result.Outputs = len(assets)
		result.Message = "已同步云端完成结果"
		return result, nil
	}
	if cloudStatus == "ABORTED" || cloudStatus == "FAILED" {
		message := stringAny(taskNode["Message"])
		if message == "" {
			message = "腾讯云任务已终止"
		}
		if err := h.persistVODSync(job, "failed", progress, stringAny(taskNode["ErrCode"]), message, nil, generationEventReq{Stage: "cloud_sync_failed", Level: "error", Message: message}); err != nil {
			return result, err
		}
		result.Status = "failed"
		result.Message = message
		return result, nil
	}
	if progress == 0 {
		progress = job.Progress
	}
	if job.Status != "running" || job.Progress != progress {
		if err := h.persistVODSync(job, "running", progress, "", "", nil, generationEventReq{Stage: "cloud_sync_running", Level: "info", Message: "已同步腾讯云任务状态", Metadata: map[string]any{"cloud_status": cloudStatus}}); err != nil {
			return result, err
		}
	}
	result.Status = "running"
	result.Message = "云端任务仍在处理中"
	return result, nil
}

func (h *GenerationHandler) Sync(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		BadRequest(c, "任务 ID 无效")
		return
	}
	var job model.GenerationJob
	if err := h.DB.First(&job, id).Error; err != nil {
		NotFound(c, "生成任务不存在")
		return
	}
	result, err := h.SyncCloudTask(&job)
	if err != nil {
		BadRequest(c, err.Error())
		return
	}
	OK(c, result)
}

// ImportVODTask 将云端已存在、但本地记录缺失的 AIGC 任务导入生成历史。
func (h *GenerationHandler) ImportVODTask(c *gin.Context) {
	h.cloudImportMu.Lock()
	defer h.cloudImportMu.Unlock()

	var req importVODTaskReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效")
		return
	}
	taskID := cleanText(req.CloudTaskID, 255)
	if !strings.Contains(taskID, "-AigcImageTask-") && !strings.Contains(taskID, "-AigcVideoTask-") {
		BadRequest(c, "仅支持导入腾讯云 AIGC 图片或视频任务")
		return
	}
	var existing model.GenerationJob
	if err := h.DB.Where("cloud_task_id = ?", taskID).First(&existing).Error; err == nil {
		result, syncErr := h.SyncCloudTask(&existing)
		if syncErr != nil {
			BadRequest(c, syncErr.Error())
			return
		}
		OK(c, result)
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		InternalError(c, "查询已有任务失败")
		return
	}
	response, taskNode, _, err := h.describeVODTask(taskID)
	if err != nil {
		BadRequest(c, err.Error())
		return
	}
	input := mapAny(taskNode["Input"])
	outputConfig := mapAny(input["OutputConfig"])
	taskType := stringAny(response["TaskType"])
	jobType := "image"
	if strings.Contains(taskType, "Video") {
		jobType = "video"
	}
	createdAt := time.Now()
	if parsed, parseErr := time.Parse(time.RFC3339, stringAny(response["CreateTime"])); parseErr == nil {
		createdAt = parsed
	}
	job := model.GenerationJob{
		ClientID:     "cloud-recovery:" + taskID,
		Source:       "cloud_recovery",
		Type:         jobType,
		Provider:     "tencent-vod",
		CloudTaskID:  taskID,
		Status:       "running",
		Progress:     0,
		Prompt:       cleanText(stringAny(input["Prompt"]), 20000),
		ModelName:    cleanText(stringAny(input["ModelName"]), 128),
		ModelVersion: cleanText(stringAny(input["ModelVersion"]), 128),
		Parameters:   safeJSON(input),
		StorageMode:  normalizedStorageMode(stringAny(outputConfig["StorageMode"])),
		StartedAt:    &createdAt,
	}
	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&job).Error; err != nil {
			return err
		}
		return appendGenerationEvent(tx, job.ID, generationEventReq{Stage: "cloud_imported", Level: "info", Message: "已从腾讯云导入历史任务", Metadata: map[string]any{"task_type": taskType}})
	}); err != nil {
		InternalError(c, "创建恢复任务失败")
		return
	}
	result, syncErr := h.SyncCloudTask(&job)
	if syncErr != nil {
		// 云端查询临时失败时保留已导入的 running 记录，后台补偿将继续重试。
		c.JSON(202, gin.H{"success": true, "data": gin.H{"job_id": job.ID, "cloud_task_id": taskID, "status": "running", "message": "任务已导入，等待云端状态同步"}})
		return
	}
	OK(c, result)
}

func (h *GenerationHandler) SyncRecentPending(limit int) ([]generationSyncResult, error) {
	if limit < 1 {
		limit = 1
	}
	if limit > 16 {
		limit = 16
	}
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	var jobs []model.GenerationJob
	if err := h.DB.Where("provider = ? AND status IN ? AND cloud_task_id <> '' AND created_at >= ?", "tencent-vod", []string{"queued", "running"}, cutoff).
		Order("created_at DESC").Limit(limit).Find(&jobs).Error; err != nil {
		return nil, err
	}
	results := make([]generationSyncResult, 0, len(jobs))
	for index := range jobs {
		result, syncErr := h.SyncCloudTask(&jobs[index])
		if syncErr != nil {
			result.Message = syncErr.Error()
		}
		results = append(results, result)
	}
	return results, nil
}

// StartCloudSyncLoop 在本地服务运行期间补偿近期被浏览器中断的 VOD 任务。
// 仅扫描带 cloud_task_id 的 queued/running 任务，已完成任务不会重复请求云端。
func (h *GenerationHandler) StartCloudSyncLoop() {
	h.cloudSyncOnce.Do(func() {
		go func() {
			initialDelay := time.NewTimer(8 * time.Second)
			defer initialDelay.Stop()
			<-initialDelay.C
			if _, err := h.SyncRecentPending(8); err != nil {
				// 凭证尚未配置或网络暂不可用时静默等待下一轮，不影响本地服务。
			}
			ticker := time.NewTicker(5 * time.Minute)
			defer ticker.Stop()
			for range ticker.C {
				_, _ = h.SyncRecentPending(8)
			}
		}()
	})
}

func (h *GenerationHandler) SyncPending(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "8"))
	results, err := h.SyncRecentPending(limit)
	if err != nil {
		InternalError(c, "查询待同步任务失败")
		return
	}
	OK(c, gin.H{"items": results, "count": len(results)})
}

func (h *GenerationHandler) ListAssets(c *gin.Context) {
	rawProjectID := strings.TrimSpace(c.Query("project_id"))
	projectID, err := strconv.ParseUint(rawProjectID, 10, 64)
	if err != nil || projectID == 0 {
		BadRequest(c, "项目 ID 无效")
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "60"))
	if limit < 1 {
		limit = 1
	}
	if limit > 120 {
		limit = 120
	}

	var assets []model.GenerationAsset
	err = h.DB.Model(&model.GenerationAsset{}).
		Joins("JOIN generation_jobs ON generation_jobs.id = generation_assets.job_id").
		Where("generation_jobs.project_id = ? AND generation_assets.role = ? AND generation_assets.media_type = ? AND generation_jobs.status IN ?", projectID, "output", "image", []string{"completed", "completed_with_errors"}).
		Where("generation_assets.cloud_url <> '' OR generation_assets.local_path <> ''").
		Order("generation_assets.created_at DESC").
		Limit(limit).
		Find(&assets).Error
	if err != nil {
		InternalError(c, "查询项目生成图片失败")
		return
	}
	OK(c, assets)
}

func (h *GenerationHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", strconv.Itoa(defaultGenerationPageSize)))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = defaultGenerationPageSize
	}
	if pageSize > maxGenerationPageSize {
		pageSize = maxGenerationPageSize
	}

	query := h.DB.Model(&model.GenerationJob{})
	if value := cleanText(c.Query("type"), 32); value != "" {
		query = query.Where("type = ?", value)
	}
	if value := cleanText(c.Query("status"), 32); value != "" {
		query = query.Where("status = ?", value)
	}
	if value := cleanText(c.Query("source"), 32); value != "" {
		query = query.Where("source = ?", value)
	}
	if rawProjectID := strings.TrimSpace(c.Query("project_id")); rawProjectID != "" {
		projectID, err := strconv.ParseUint(rawProjectID, 10, 64)
		if err != nil || projectID == 0 {
			BadRequest(c, "项目 ID 无效")
			return
		}
		query = query.Where("project_id = ?", projectID)
	}
	if value := cleanText(c.Query("q"), 200); value != "" {
		pattern := "%" + strings.ReplaceAll(strings.ReplaceAll(value, "%", "\\%"), "_", "\\_") + "%"
		query = query.Where("prompt LIKE ? ESCAPE '\\' OR model_name LIKE ? ESCAPE '\\' OR cloud_task_id LIKE ? ESCAPE '\\'", pattern, pattern, pattern)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		InternalError(c, "查询生成历史失败")
		return
	}
	var jobs []model.GenerationJob
	if err := query.Order("created_at DESC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&jobs).Error; err != nil {
		InternalError(c, "查询生成历史失败")
		return
	}
	if len(jobs) > 0 {
		ids := make([]uint, 0, len(jobs))
		for _, job := range jobs {
			ids = append(ids, job.ID)
		}
		var assets []model.GenerationAsset
		h.DB.Where("job_id IN ? AND role = ?", ids, "output").Order("ordinal ASC").Find(&assets)
		firstAsset := map[uint]model.GenerationAsset{}
		for _, asset := range assets {
			if _, ok := firstAsset[asset.JobID]; !ok {
				firstAsset[asset.JobID] = asset
			}
		}
		items := make([]gin.H, 0, len(jobs))
		for _, job := range jobs {
			items = append(items, gin.H{"job": job, "preview": firstAsset[job.ID]})
		}
		OK(c, gin.H{"items": items, "page": page, "page_size": pageSize, "total": total})
		return
	}
	OK(c, gin.H{"items": []any{}, "page": page, "page_size": pageSize, "total": total})
}

func (h *GenerationHandler) Create(c *gin.Context) {
	var req createGenerationReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "生成任务参数无效")
		return
	}
	jobType := strings.ToLower(cleanText(req.Type, 32))
	if !allowedGenerationTypes[jobType] {
		BadRequest(c, "不支持的生成任务类型")
		return
	}
	status := normalizeGenerationStatus(req.Status)
	if status == "" {
		status = "queued"
	}
	now := time.Now()
	job := model.GenerationJob{
		ClientID: cleanText(req.ClientID, 191), ProjectID: req.ProjectID, ParentJobID: req.ParentJobID,
		Source: cleanText(req.Source, 32), Type: jobType, Provider: cleanText(req.Provider, 64),
		Status: status, Prompt: cleanText(req.Prompt, 20000), ModelName: cleanText(req.ModelName, 128),
		ModelVersion: cleanText(req.ModelVersion, 128), Parameters: safeJSON(req.Parameters),
		StorageMode: normalizedStorageMode(req.StorageMode), StartedAt: &now,
	}
	if job.ClientID == "" || job.Source == "" {
		BadRequest(c, "任务标识和来源不能为空")
		return
	}
	if job.Provider == "" {
		job.Provider = "tencent-vod"
	}
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&job).Error; err != nil {
			return err
		}
		if err := upsertGenerationAssets(tx, job.ID, req.Assets); err != nil {
			return err
		}
		return appendGenerationEvent(tx, job.ID, generationEventReq{Stage: "queued", Message: "任务已创建"})
	})
	if err != nil {
		InternalError(c, "创建生成任务失败")
		return
	}
	Created(c, job)
}

func (h *GenerationHandler) Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		BadRequest(c, "任务 ID 无效")
		return
	}
	var job model.GenerationJob
	if err := h.DB.First(&job, id).Error; err != nil {
		NotFound(c, "生成任务不存在")
		return
	}
	var assets []model.GenerationAsset
	var events []model.GenerationEvent
	h.DB.Where("job_id = ?", id).Order("role ASC, ordinal ASC").Find(&assets)
	h.DB.Where("job_id = ?", id).Order("sequence ASC").Find(&events)
	OK(c, generationDetail{GenerationJob: job, Assets: assets, Events: events})
}

func (h *GenerationHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		BadRequest(c, "任务 ID 无效")
		return
	}
	var req updateGenerationReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "任务更新参数无效")
		return
	}
	var job model.GenerationJob
	if err := h.DB.First(&job, id).Error; err != nil {
		NotFound(c, "生成任务不存在")
		return
	}

	err = h.DB.Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{}
		if req.CloudTaskID != nil {
			updates["cloud_task_id"] = cleanText(*req.CloudTaskID, 255)
		}
		if req.Progress != nil {
			progress := *req.Progress
			if progress < 0 {
				progress = 0
			}
			if progress > 100 {
				progress = 100
			}
			updates["progress"] = progress
		}
		if req.Status != nil {
			status := normalizeGenerationStatus(*req.Status)
			if status == "" {
				return fmt.Errorf("invalid status")
			}
			updates["status"] = status
			if status == "completed" || status == "completed_with_errors" || status == "failed" || status == "cancelled" {
				now := time.Now()
				updates["finished_at"] = &now
			}
		}
		if req.ErrorCode != nil {
			updates["error_code"] = cleanText(*req.ErrorCode, 128)
		}
		if req.ErrorMessage != nil {
			updates["error_message"] = cleanText(*req.ErrorMessage, 4000)
		}
		if req.FinishedAt != nil {
			updates["finished_at"] = req.FinishedAt
		}
		if req.Parameters != nil {
			updates["parameters"] = safeJSON(req.Parameters)
		}
		if len(updates) > 0 {
			if err := tx.Model(&job).Updates(updates).Error; err != nil {
				return err
			}
		}
		if err := upsertGenerationAssets(tx, job.ID, req.Assets); err != nil {
			return err
		}
		if req.Event != nil {
			if err := appendGenerationEvent(tx, job.ID, *req.Event); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		BadRequest(c, "更新生成任务失败")
		return
	}
	h.Get(c)
}

func (h *GenerationHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		BadRequest(c, "任务 ID 无效")
		return
	}
	var job model.GenerationJob
	if err := h.DB.First(&job, id).Error; err != nil {
		NotFound(c, "生成任务不存在")
		return
	}
	err = h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("job_id = ?", id).Delete(&model.GenerationEvent{}).Error; err != nil {
			return err
		}
		if err := tx.Where("job_id = ?", id).Delete(&model.GenerationAsset{}).Error; err != nil {
			return err
		}
		return tx.Delete(&job).Error
	})
	if err != nil {
		InternalError(c, "删除生成历史失败")
		return
	}
	OK(c, gin.H{"deleted": id, "files_deleted": false})
}
