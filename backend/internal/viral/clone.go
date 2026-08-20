package viral

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/tencentyun/cos-go-sdk-v5"
)

// handleClone 腾讯云 MPS「爆款复刻」接口 CloneViral。
// 用一个接口完成:爆款视频 + 商品图 + 生成参数 + 内容参数 + 人物 Persona → 生成复刻视频。
// 比旧的"拆解→裂变→生成"流程更简洁可靠,直接对接官方原生能力。
func (a *ViralApp) handleClone(c *gin.Context) {
	var req cloneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "请求参数无效")
		return
	}
	if req.VideoUrl == "" {
		Fail(c, http.StatusBadRequest, "缺少爆款视频(VideoUrl)")
		return
	}
	if len(req.Product.Images) == 0 {
		Fail(c, http.StatusBadRequest, "缺少商品图(Product.Images)")
		return
	}
	cred, err := a.loadTencentCredential()
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	secretID := stringValue(cred["secret_id"])
	secretKey := stringValue(cred["secret_key"])
	region := stringValue(cred["mps_region"])
	if region == "" {
		region = stringValue(cred["region"])
	}
	bucket := stringValue(cred["mps_bucket"])
	if secretID == "" || secretKey == "" {
		Fail(c, http.StatusBadRequest, "腾讯云凭证缺少 SecretId 或 SecretKey")
		return
	}
	if bucket == "" {
		Fail(c, http.StatusBadRequest, "请在 API 设置中配置 MPS 输出 COS Bucket(用于保存复刻结果)")
		return
	}
	if err := validateViralInputURL(req.VideoUrl, bucket, region); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	for _, imageURL := range req.Product.Images {
		if err := validateViralInputURL(imageURL, bucket, region); err != nil {
			Fail(c, http.StatusBadRequest, err.Error())
			return
		}
	}

	runID := newRunID()
	OK(c, gin.H{"runId": runID, "status": "started"})

	go func() {
		if err := a.runClone(runID, secretID, secretKey, region, bucket, req); err != nil {
			log.Printf("[viral/clone] %s 失败: %v", runID, err)
			_ = writeTaskError(runID, err.Error())
		}
	}()
}

// cloneRequest CloneViral 请求体(对应官方文档 https://cloud.tencent.com/document/product/862/135652)
type cloneRequest struct {
	VideoUrl  string       `json:"videoUrl"`
	Product   cloneProduct `json:"product"`
	AIGCParam cloneAIGC    `json:"aigcParam"`
	Content   cloneContent `json:"content"`
	Persona   clonePersona `json:"persona"`
}

func validateViralInputURL(rawURL, bucket, region string) error {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || parsed.User != nil {
		return fmt.Errorf("素材必须是本应用上传的 HTTPS COS 地址")
	}
	expectedHost := strings.ToLower(fmt.Sprintf("%s.cos.%s.myqcloud.com", bucket, region))
	objectPath := strings.TrimPrefix(parsed.EscapedPath(), "/")
	if strings.ToLower(parsed.Hostname()) != expectedHost || !strings.HasPrefix(objectPath, viralInputPrefix) {
		return fmt.Errorf("素材必须通过本页面上传，不能直接使用外部地址")
	}
	return nil
}

type cloneProduct struct {
	Images      []string `json:"images"`
	Name        string   `json:"name,omitempty"`
	Description string   `json:"description,omitempty"`
}

type cloneAIGC struct {
	Duration    int    `json:"duration,omitempty"`    // 4-15 秒
	AspectRatio string `json:"aspectRatio,omitempty"` // 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive
	Resolution  string `json:"resolution,omitempty"`  // 720p / 1080p / 2k / 4k
	ModelTier   string `json:"modelTier,omitempty"`   // flagship(默认) / standard
}

type cloneContent struct {
	UserPrompt   string `json:"userPrompt,omitempty"`
	Language     string `json:"language,omitempty"`     // zh/en/ja/ko/es/pt/instrumental
	Market       string `json:"market,omitempty"`       // north_america/europe/china/japan/korea/sea/brazil
	FissionLevel string `json:"fissionLevel,omitempty"` // exact/low/medium/high
}

type clonePersona struct {
	Gender    string `json:"gender,omitempty"`    // male/female/any
	Age       string `json:"age,omitempty"`       // teenager/youth/middle_aged/senior
	Ethnicity string `json:"ethnicity,omitempty"` // caucasian/asian/latino/african/middle_eastern
	BodyType  string `json:"bodyType,omitempty"`  // slim/standard/athletic/chubby
}

// buildCloneViralPayload 把前端小写字段的 cloneRequest 转换为 MPS CloneViral 要求的
// PascalCase 参数结构(参数名见官方文档 https://cloud.tencent.com/document/product/862/135033):
// VideoUrl / Product{Images,Name,Description} / AIGCParam{Duration,AspectRatio,Resolution,ModelTier}
// ContentParam{UserPrompt,Language,Market,FissionLevel} / Persona{Gender,Age,Ethnicity,BodyType}。
// 空字段不发送,避免 MPS 因多余空参数报错。
func buildCloneViralPayload(req cloneRequest) map[string]any {
	payload := map[string]any{
		"VideoUrl": req.VideoUrl,
		"Product": map[string]any{
			"Images": req.Product.Images,
		},
	}
	if req.Product.Name != "" {
		payload["Product"].(map[string]any)["Name"] = req.Product.Name
	}
	if req.Product.Description != "" {
		payload["Product"].(map[string]any)["Description"] = req.Product.Description
	}

	aigc := map[string]any{}
	if req.AIGCParam.Duration > 0 {
		aigc["Duration"] = req.AIGCParam.Duration
	}
	if req.AIGCParam.AspectRatio != "" {
		aigc["AspectRatio"] = req.AIGCParam.AspectRatio
	}
	if req.AIGCParam.Resolution != "" {
		aigc["Resolution"] = req.AIGCParam.Resolution
	}
	if req.AIGCParam.ModelTier != "" {
		aigc["ModelTier"] = req.AIGCParam.ModelTier
	}
	if len(aigc) > 0 {
		payload["AIGCParam"] = aigc
	}

	content := map[string]any{}
	if req.Content.UserPrompt != "" {
		content["UserPrompt"] = req.Content.UserPrompt
	}
	if req.Content.Language != "" {
		content["Language"] = req.Content.Language
	}
	if req.Content.Market != "" {
		content["Market"] = req.Content.Market
	}
	if req.Content.FissionLevel != "" {
		content["FissionLevel"] = req.Content.FissionLevel
	}
	if len(content) > 0 {
		payload["ContentParam"] = content
	}

	persona := map[string]any{}
	if req.Persona.Gender != "" {
		persona["Gender"] = req.Persona.Gender
	}
	if req.Persona.Age != "" {
		persona["Age"] = req.Persona.Age
	}
	if req.Persona.Ethnicity != "" {
		persona["Ethnicity"] = req.Persona.Ethnicity
	}
	if req.Persona.BodyType != "" {
		persona["BodyType"] = req.Persona.BodyType
	}
	if len(persona) > 0 {
		payload["Persona"] = persona
	}

	return payload
}

// runClone 后台执行 CloneViral 并轮询 DescribeCloneViralTask。
// 完成后把临时结果转存到配置的 COS 桶(结果长期保存)。
// MPS 内部管线(如视频理解 step1)偶发 LLM 输出解析失败,自动重试最多 maxCloneAttempts 次。
func (a *ViralApp) runClone(runID, secretID, secretKey, region, bucket string, req cloneRequest) error {
	log.Printf("[viral/clone] %s 调 CloneViral, videoUrl=%s, productImages=%d, bucket=%s",
		runID, req.VideoUrl, len(req.Product.Images), bucket)
	appendTaskLog(runID, "任务启动: 调用 MPS CloneViral(视频 %d 个, 商品图 %d 张, 时长 %ds, 比例 %s, 分辨率 %s, 档位 %s)",
		len([]string{req.VideoUrl}), len(req.Product.Images), req.AIGCParam.Duration, req.AIGCParam.AspectRatio, req.AIGCParam.Resolution, req.AIGCParam.ModelTier)
	if req.Content.FissionLevel != "" {
		appendTaskLog(runID, "内容参数: 语言=%s 市场=%s 复刻程度=%s", req.Content.Language, req.Content.Market, req.Content.FissionLevel)
	}
	if req.Content.UserPrompt != "" {
		appendTaskLog(runID, "自定义指令: %s", req.Content.UserPrompt)
	}

	var lastErr error
	for attempt := 1; attempt <= maxCloneAttempts; attempt++ {
		if attempt > 1 {
			appendTaskLog(runID, "检测到上游内部错误, 自动重试(第 %d/%d 次)...", attempt, maxCloneAttempts)
			time.Sleep(10 * time.Second)
		}
		lastErr = a.runCloneOnce(runID, secretID, secretKey, region, bucket, req)
		if lastErr == nil {
			return nil
		}
		if !isTransientCloneError(lastErr) || attempt == maxCloneAttempts {
			break
		}
	}
	return lastErr
}

// maxCloneAttempts 单次爆款复刻最多尝试次数(MPS 内部管线偶发失败可重试)。
const maxCloneAttempts = 3

// isTransientCloneError 判断是否为可重试的上游内部错误(视频理解/文案生成等 LLM 输出异常)。
func isTransientCloneError(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "pipeline failed") ||
		strings.Contains(msg, "comprehension") ||
		strings.Contains(msg, "parse json") ||
		strings.Contains(msg, "extract_json")
}

// runCloneOnce 单次执行 CloneViral 创建 + 轮询 + 转存。
func (a *ViralApp) runCloneOnce(runID, secretID, secretKey, region, bucket string, req cloneRequest) error {
	// 1. 调 CloneViral 创建任务。
	// 注意:MPS 接口参数名必须为 PascalCase(VideoUrl/Product/AIGCParam/ContentParam/Persona),
	// 不能直接序列化前端传入的小写字段,否则 MPS 会报 MissingParameter: Product。
	payload, _ := json.Marshal(buildCloneViralPayload(req))
	resp, err := a.invokeMPS(secretID, secretKey, region, "CloneViral", string(payload))
	if err != nil {
		appendTaskLog(runID, "创建任务失败: %v", err)
		return fmt.Errorf("创建爆款复刻任务失败: %w", err)
	}
	var created struct {
		TaskId string `json:"TaskId"`
	}
	if err := json.Unmarshal(resp, &created); err != nil || created.TaskId == "" {
		log.Printf("[viral/clone] %s CloneViral 响应无 TaskId: %s", runID, truncateString(string(resp), 500))
		appendTaskLog(runID, "创建任务失败: 响应未包含 TaskId (响应: %s)", truncateString(string(resp), 300))
		return fmt.Errorf("解析 CloneViral 任务创建结果失败")
	}
	taskID := created.TaskId
	log.Printf("[viral/clone] %s CloneViral 成功, TaskId=%s", runID, taskID)
	appendTaskLog(runID, "任务创建成功, MPS TaskId=%s", taskID)

	// 创建成功后立即持久化元数据,保证进程重启后可恢复轮询。
	if err := writeTaskMeta(cloneTaskMeta{RunID: runID, TaskID: taskID, CreatedAt: time.Now(), Request: req}); err != nil {
		log.Printf("[viral/clone] %s 写入任务元数据失败: %v (重启后将无法恢复)", runID, err)
	}

	return a.pollCloneTask(runID, secretID, secretKey, region, bucket, taskID)
}

// pollCloneTask 轮询 DescribeCloneViralTask 直到任务完成,把结果转存 COS 并写出任务结果文件。
// 独立成函数,供创建任务后与进程重启恢复两处复用。
func (a *ViralApp) pollCloneTask(runID, secretID, secretKey, region, bucket, taskID string) error {
	start := time.Now()
	lastStatus := ""
	lastLogStatus := ""
	for time.Since(start) < 15*time.Minute {
		time.Sleep(8 * time.Second)
		elapsed := time.Since(start).Round(time.Second)
		pollPayload, _ := json.Marshal(map[string]any{"TaskId": taskID})
		pollResp, err := a.invokeMPS(secretID, secretKey, region, "DescribeCloneViralTask", string(pollPayload))
		if err != nil {
			log.Printf("[viral/clone] %s DescribeCloneViralTask 失败(%s): %v, 继续重试", runID, elapsed, err)
			appendTaskLog(runID, "查询状态失败(%s): %v, 稍后重试", elapsed, err)
			continue
		}
		var detail map[string]any
		if err := json.Unmarshal(pollResp, &detail); err != nil {
			log.Printf("[viral/clone] %s 轮询响应解析失败(%s): %s", runID, elapsed, truncateString(string(pollResp), 300))
			continue
		}
		status, _ := detail["Status"].(string)
		if status != lastStatus {
			log.Printf("[viral/clone] %s 任务状态(%s): %s", runID, elapsed, status)
			lastStatus = status
		}
		// 状态变化记一条进度日志
		if status != "" && status != lastLogStatus && status != "WAIT" {
			appendTaskLog(runID, "处理中(%s): 状态=%s", elapsed, status)
			lastLogStatus = status
		}
		if status == "DONE" || status == "SUCCESS" || status == "FINISH" {
			urls := extractURLs(detail)
			if len(urls) == 0 {
				appendTaskLog(runID, "任务完成但响应中未找到视频 URL")
				removeTaskMeta(runID)
				return fmt.Errorf("爆款复刻任务完成但未返回视频 URL")
			}
			log.Printf("[viral/clone] %s 完成, urls=%d, 转存 COS", runID, len(urls))
			appendTaskLog(runID, "任务完成, 共 %d 个视频, 开始转存 COS", len(urls))
			// 把临时结果 URL 转存到配置的 COS 桶,返回永久 COS URL
			persisted, err := a.persistToCos(secretID, secretKey, region, bucket, urls)
			if err != nil {
				log.Printf("[viral/clone] %s 转存 COS 失败: %v, 降级返回临时 URL", runID, err)
				appendTaskLog(runID, "转存 COS 失败: %v (降级返回临时 URL)", err)
				persisted = urls
			} else {
				appendTaskLog(runID, "已转存 COS, 返回 %d 个永久链接", len(persisted))
			}
			removeTaskMeta(runID)
			return writeTaskResult(runID, map[string]any{
				"videoUrls": persisted,
				"taskId":    taskID,
				"logRunId":  runID,
			})
		}
		if status == "FAIL" || status == "FAILED" {
			errMsg := truncateString(fmt.Sprintf("%v", detail["Message"]), 500)
			appendTaskLog(runID, "任务失败: %v %s", detail["ErrCode"], errMsg)
			removeTaskMeta(runID)
			return fmt.Errorf("爆款复刻任务失败: %v %s", detail["ErrCode"], errMsg)
		}
	}
	appendTaskLog(runID, "任务超时(超过 15 分钟, 最后状态: %s)", lastStatus)
	// 超时不删 meta:任务可能在 MPS 侧仍在运行,留待下次重启再恢复轮询。
	return fmt.Errorf("爆款复刻任务超时(最后状态: %s)", lastStatus)
}

// resumeCloneTasks 进程启动时扫描持久化的任务元数据,对未完成任务自动恢复轮询。
// 适用于 dev 模式频繁重启或服务异常重启的场景,避免"MPS 云端任务还在跑、本地结果永远拿不到"。
func (a *ViralApp) resumeCloneTasks() {
	cred, err := a.loadTencentCredential()
	if err != nil {
		log.Printf("[viral/clone] 启动恢复跳过: %v", err)
		return
	}
	secretID := stringValue(cred["secret_id"])
	secretKey := stringValue(cred["secret_key"])
	region := stringValue(cred["mps_region"])
	if region == "" {
		region = stringValue(cred["region"])
	}
	bucket := stringValue(cred["mps_bucket"])
	if secretID == "" || secretKey == "" || bucket == "" {
		log.Printf("[viral/clone] 启动恢复跳过: 缺少腾讯云凭证或 MPS Bucket")
		return
	}
	metas := loadTaskMetas()
	for _, meta := range metas {
		// 只恢复近期(6 小时内)创建且尚无结果的任务,避免捞回陈旧/已终态任务。
		if time.Since(meta.CreatedAt) > 6*time.Hour || taskHasResult(meta.RunID) {
			removeTaskMeta(meta.RunID)
			continue
		}
		runID, taskID := meta.RunID, meta.TaskID
		go func() {
			log.Printf("[viral/clone] %s 检测到未完成任务(进程重启), 恢复轮询 MPS TaskId=%s", runID, taskID)
			appendTaskLog(runID, "检测到未完成任务(进程重启), 自动恢复轮询 MPS TaskId=%s", taskID)
			if err := a.pollCloneTask(runID, secretID, secretKey, region, bucket, taskID); err != nil {
				log.Printf("[viral/clone] %s 恢复轮询失败: %v", runID, err)
				_ = writeTaskError(runID, err.Error())
			}
		}()
	}
}

// extractURLs 仅接受腾讯云 MPS 定义的 VideoUrls 字段；禁止从任意上游字段猜测 URL。
func extractURLs(detail map[string]any) []string {
	raw, ok := detail["VideoUrls"].([]any)
	if !ok {
		return nil
	}
	urls := make([]string, 0, len(raw))
	for _, item := range raw {
		if u, ok := item.(string); ok && strings.TrimSpace(u) != "" {
			urls = append(urls, strings.TrimSpace(u))
		}
	}
	return urls
}

func validateMPSResultURL(rawURL string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || !strings.HasSuffix(strings.ToLower(parsed.Hostname()), ".myqcloud.com") {
		return nil, fmt.Errorf("MPS 返回了不受信任的视频地址")
	}
	return parsed, nil
}

// persistToCos 把 MPS 生成的临时结果 URL 下载后转存到配置的 COS 桶,返回永久签名 URL。
// 复用 upload.go 的 newCosClient / signCosURL。
func (a *ViralApp) persistToCos(secretID, secretKey, region, bucket string, urls []string) ([]string, error) {
	config := tencentCosConfig{
		SecretID:  secretID,
		SecretKey: secretKey,
		Bucket:    bucket,
		Region:    region,
	}
	client, err := newCosClient(config)
	if err != nil {
		return nil, fmt.Errorf("构造 COS 客户端失败: %w", err)
	}

	downloadClient := &http.Client{Timeout: 5 * time.Minute, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return fmt.Errorf("MPS 结果下载不允许重定向")
	}}
	persisted := make([]string, 0, len(urls))
	for _, u := range urls {
		parsed, err := validateMPSResultURL(u)
		if err != nil {
			return nil, err
		}
		// 1. 下载经官方字段返回的腾讯云临时视频；限制最大 500MB，避免占用无界内存。
		resp, err := downloadClient.Get(parsed.String())
		if err != nil {
			return nil, fmt.Errorf("下载 MPS 结果失败: %w", err)
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, fmt.Errorf("下载 MPS 结果返回 %d", resp.StatusCode)
		}
		if resp.ContentLength <= 0 || resp.ContentLength > 500<<20 {
			resp.Body.Close()
			return nil, fmt.Errorf("MPS 结果为空或超过 500MB 限制")
		}
		contentType := strings.ToLower(resp.Header.Get("Content-Type"))
		if contentType != "" && !strings.HasPrefix(contentType, "video/") && !strings.HasPrefix(contentType, "application/octet-stream") {
			resp.Body.Close()
			return nil, fmt.Errorf("MPS 结果不是视频文件")
		}

		// 2. 流式上传到 COS，避免将完整视频读入内存。
		ext := path.Ext(parsed.Path)
		if ext == "" {
			ext = ".mp4"
		}
		objectKey := "txstudio-viral/clone/" + time.Now().UTC().Format("20060102") + "/" + uuid.New().String() + ext
		putErr := func() error {
			defer resp.Body.Close()
			_, err := client.Object.Put(context.Background(), objectKey, io.LimitReader(resp.Body, 500<<20), &cos.ObjectPutOptions{
				ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{ContentType: "video/mp4"},
			})
			return err
		}()
		if putErr != nil {
			return nil, fmt.Errorf("上传 COS 失败: %w", putErr)
		}

		// 3. 生成签名 URL(私有桶可访问)
		signedURL, err := signCosURL(config, objectKey)
		if err != nil {
			return nil, fmt.Errorf("生成 COS 签名 URL 失败: %w", err)
		}
		persisted = append(persisted, signedURL)
		log.Printf("[viral/clone] 已转存 COS: %s", objectKey)
	}
	return persisted, nil
}
