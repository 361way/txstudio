package handler

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
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
	DB *gorm.DB
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
		query = query.Where("prompt LIKE ? ESCAPE '\\' OR model_name LIKE ? ESCAPE '\\'", pattern, pattern)
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
