package translate

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// translateRequest 视频译制请求体。
type translateRequest struct {
	VideoUrl        string   `json:"videoUrl"`
	SourceLang      string   `json:"sourceLang"`
	TargetLangs     []string `json:"targetLangs"`
	EnableSubtitles bool     `json:"enableSubtitles"`
	HasSubtitle     *bool    `json:"hasSubtitle"` // 可选覆盖:不传则自动探测视频是否带硬字幕
}

func validateTranslateInputURL(rawURL, bucket, region string) error {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || parsed.User != nil {
		return fmt.Errorf("源视频必须是本应用上传的 HTTPS COS 地址")
	}
	expectedHost := strings.ToLower(fmt.Sprintf("%s.cos.%s.myqcloud.com", bucket, region))
	objectPath := strings.TrimPrefix(parsed.EscapedPath(), "/")
	if strings.ToLower(parsed.Hostname()) != expectedHost || !strings.HasPrefix(objectPath, translateInputPrefix) {
		return fmt.Errorf("源视频必须通过本页面上传，不能直接使用外部地址")
	}
	return nil
}

// handleTranslate 腾讯云 MPS「视频译制」接口 ProcessMedia（AiAnalysisTask Definition=25）。
// 一键完成:字幕提取(OCR/ASR) → 翻译 → 原字幕擦除 → 压制译文字幕 → AI 克隆配音。
// 每种目标语言提交一个 ProcessMedia 任务,异步轮询,完成后返回各语言版本视频 URL。
func (a *TranslateApp) handleTranslate(c *gin.Context) {
	var req translateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "请求参数无效")
		return
	}
	if req.VideoUrl == "" {
		Fail(c, http.StatusBadRequest, "缺少源视频 URL(VideoUrl)")
		return
	}
	if req.SourceLang == "" {
		req.SourceLang = "zh"
	}
	if _, ok := LANG_NAMES[req.SourceLang]; !ok {
		Fail(c, http.StatusBadRequest, "不支持的源语言: "+req.SourceLang)
		return
	}
	if len(req.TargetLangs) == 0 {
		Fail(c, http.StatusBadRequest, "至少选择一个目标语言")
		return
	}
	if len(req.TargetLangs) > 6 {
		Fail(c, http.StatusBadRequest, "最多支持 6 种目标语言")
		return
	}
	for _, lang := range req.TargetLangs {
		if _, ok := LANG_NAMES[lang]; !ok {
			Fail(c, http.StatusBadRequest, "不支持的目标语言: "+lang)
			return
		}
		if lang == req.SourceLang {
			Fail(c, http.StatusBadRequest, "目标语言不能与源语言相同: "+LANG_NAMES[lang])
			return
		}
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
		Fail(c, http.StatusBadRequest, "请在 API 设置中配置 MPS 输出 COS Bucket(用于保存译制结果)")
		return
	}
	if err := validateTranslateInputURL(req.VideoUrl, bucket, region); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	runID := newRunID()
	OK(c, gin.H{"runId": runID, "status": "started"})

	go func() {
		if err := a.runTranslate(runID, secretID, secretKey, region, bucket, req); err != nil {
			log.Printf("[translate] %s 失败: %v", runID, err)
			_ = writeTaskError(runID, err.Error())
		}
	}()
}

// 硬字幕探测:源语言不在 DetectVideoSubtitleArea 支持枚举(zh_en/en/ja/ko)内时降级用 zh_en 提高命中。
var subtitleLangMap = map[string]string{"zh": "zh_en", "en": "en", "ja": "ja", "ko": "ko"}

// detectHardSubtitle 调 MPS DetectVideoSubtitleArea,Result 非空 = 画面有字幕;为空 = 无字幕。
// 失败时保守返回 nil(交由调用方按无字幕处理)。
func (a *TranslateApp) detectHardSubtitle(secretID, secretKey, region, videoUrl, sourceLang string) (*bool, error) {
	videoLanguage := subtitleLangMap[sourceLang]
	if videoLanguage == "" {
		videoLanguage = "zh_en"
	}
	payload, _ := json.Marshal(map[string]any{
		"InputInfo": map[string]any{
			"Type":         "URL",
			"UrlInputInfo": map[string]any{"Url": videoUrl},
		},
		"VideoLanguage": videoLanguage,
	})
	resp, err := a.invokeMPS(secretID, secretKey, region, "DetectVideoSubtitleArea", string(payload))
	if err != nil {
		return nil, err
	}
	var detail struct {
		Result []any `json:"Result"`
	}
	if err := json.Unmarshal(resp, &detail); err != nil {
		return nil, err
	}
	detected := len(detail.Result) > 0
	return &detected, nil
}

// runTranslate 后台执行视频译制:探测字幕 → 逐个目标语言提交 ProcessMedia → 轮询 → 提取输出 → 签名 URL。
// 单个语言失败不影响其他语言;最终把聚合结果写入任务结果文件。
func (a *TranslateApp) runTranslate(runID, secretID, secretKey, region, bucket string, req translateRequest) error {
	targetDesc := make([]string, 0, len(req.TargetLangs))
	for _, lang := range req.TargetLangs {
		targetDesc = append(targetDesc, LANG_NAMES[lang])
	}
	appendTaskLog(runID, "任务启动: %s → %s, 字幕压制=%s, 视频 %s",
		LANG_NAMES[req.SourceLang], strings.Join(targetDesc, "/"),
		boolText(req.EnableSubtitles), req.VideoUrl)

	// 1. 判断原视频是否带硬字幕(前端未显式传 hasSubtitle 时自动探测)
	//    有字幕 → audio_clone_ocr(擦除+OCR提取+翻译+配音+压制);无字幕 → audio_clone_asr(ASR提取+翻译+配音+压制)
	useErase := false
	switch {
	case req.HasSubtitle != nil:
		useErase = *req.HasSubtitle
		appendTaskLog(runID, "字幕模式(手动指定): %s", subtitleModeText(useErase))
	default:
		appendTaskLog(runID, "开始自动检测画面硬字幕...")
		detected, err := a.detectHardSubtitle(secretID, secretKey, region, req.VideoUrl, req.SourceLang)
		if err != nil {
			appendTaskLog(runID, "字幕检测失败(%v), 按无字幕处理(ASR)", err)
		} else {
			useErase = *detected
			appendTaskLog(runID, "字幕检测完成: %s", subtitleModeText(useErase))
		}
	}

	results := make([]map[string]any, 0, len(req.TargetLangs))
	for _, lang := range req.TargetLangs {
		res := a.runTranslateOne(runID, secretID, secretKey, region, bucket, req.VideoUrl, req.SourceLang, lang, req.EnableSubtitles, useErase)
		results = append(results, res)
	}

	return writeTaskResult(runID, map[string]any{
		"results":     results,
		"sourceLang":  req.SourceLang,
		"targetLangs": req.TargetLangs,
		"logRunId":    runID,
	})
}

// runTranslateOne 单个目标语言的完整译制流程,返回该语言的结果(成功/失败)。
func (a *TranslateApp) runTranslateOne(runID, secretID, secretKey, region, bucket, videoUrl, sourceLang, targetLang string, enableSubtitles, useErase bool) map[string]any {
	langName := LANG_NAMES[targetLang]
	fail := func(err error) map[string]any {
		appendTaskLog(runID, "译制 %s 失败: %v", langName, err)
		return map[string]any{
			"lang":     targetLang,
			"langName": langName,
			"status":   "failed",
			"error":    err.Error(),
		}
	}

	// 1. 构造 ExtendedParameter(JSON 字符串):delogo + subtitle_param
	customerAppID := "audio_clone_asr"
	if useErase {
		customerAppID = "audio_clone_ocr"
	}
	extParam := map[string]any{
		"delogo": map[string]any{
			"cluster_id":    "gpu_pre",
			"CustomerAppId": customerAppID,
			"subtitle_param": map[string]any{
				"translate_src_language": sourceLang,
				"translate_dst_language": targetLang,
				"use_draw":               enableSubtitles,
			},
		},
	}
	extParamJSON, _ := json.Marshal(extParam)

	// 2. 调 ProcessMedia 创建任务
	payload, _ := json.Marshal(map[string]any{
		"InputInfo": map[string]any{
			"Type":         "URL",
			"UrlInputInfo": map[string]any{"Url": videoUrl},
		},
		"OutputStorage": map[string]any{
			"Type":             "COS",
			"CosOutputStorage": map[string]any{"Bucket": bucket, "Region": region},
		},
		"OutputDir": "/txstudio-translate/" + runID + "/" + targetLang + "/",
		"AiAnalysisTask": map[string]any{
			"Definition":        25, // 预设模板:视频译制
			"ExtendedParameter": string(extParamJSON),
		},
	})
	appendTaskLog(runID, "提交译制任务: %s → %s (能力=%s)", LANG_NAMES[sourceLang], langName, customerAppID)
	resp, err := a.invokeMPS(secretID, secretKey, region, "ProcessMedia", string(payload))
	if err != nil {
		return fail(fmt.Errorf("创建译制任务失败: %w", err))
	}
	var created struct {
		TaskId string `json:"TaskId"`
	}
	if err := json.Unmarshal(resp, &created); err != nil || created.TaskId == "" {
		log.Printf("[translate] %s ProcessMedia 响应无 TaskId: %s", runID, truncateString(string(resp), 500))
		return fail(fmt.Errorf("解析 ProcessMedia 任务创建结果失败(响应: %s)", truncateString(string(resp), 300)))
	}
	taskID := created.TaskId
	appendTaskLog(runID, "%s 译制任务已创建, MPS TaskId=%s", langName, taskID)

	// 3. 轮询 DescribeTaskDetail 直到完成
	detail, err := a.pollTranslateTask(runID, secretID, secretKey, region, taskID)
	if err != nil {
		return fail(err)
	}

	// 4. 提取输出视频 COS 路径,生成 7 天预签名 URL
	outputPath, outputBucket, outputRegion, err := extractOutputPath(detail)
	if err != nil {
		return fail(fmt.Errorf("译制任务完成但未找到输出视频文件"))
	}
	if outputBucket == "" {
		outputBucket = bucket
	}
	if outputRegion == "" {
		outputRegion = region
	}
	videoURL, err := signCosURL(tencentCosConfig{SecretID: secretID, SecretKey: secretKey, Bucket: outputBucket, Region: outputRegion}, strings.TrimPrefix(outputPath, "/"))
	if err != nil {
		return fail(fmt.Errorf("生成输出视频 URL 失败: %w", err))
	}

	appendTaskLog(runID, "%s 译制完成: %s", langName, videoURL)
	return map[string]any{
		"lang":     targetLang,
		"langName": langName,
		"status":   "success",
		"videoUrl": videoURL,
		"taskId":   taskID,
	}
}

// pollTranslateTask 轮询 DescribeTaskDetail 直到任务完成(最大 15 分钟)。
func (a *TranslateApp) pollTranslateTask(runID, secretID, secretKey, region, taskID string) (map[string]any, error) {
	start := time.Now()
	lastStatus := ""
	lastLogStatus := ""
	for time.Since(start) < 15*time.Minute {
		time.Sleep(5 * time.Second)
		elapsed := time.Since(start).Round(time.Second)
		pollPayload, _ := json.Marshal(map[string]any{"TaskId": taskID})
		pollResp, err := a.invokeMPS(secretID, secretKey, region, "DescribeTaskDetail", string(pollPayload))
		if err != nil {
			appendTaskLog(runID, "查询状态失败(%s): %v, 稍后重试", elapsed, err)
			continue
		}
		var detail map[string]any
		if err := json.Unmarshal(pollResp, &detail); err != nil {
			log.Printf("[translate] %s 轮询响应解析失败(%s): %s", runID, elapsed, truncateString(string(pollResp), 300))
			continue
		}
		status, _ := detail["Status"].(string)
		if status != lastStatus {
			log.Printf("[translate] %s 任务状态(%s): %s", runID, elapsed, status)
			lastStatus = status
		}
		if status != "" && status != lastLogStatus && status != "WAIT" && status != "PROCESSING" {
			appendTaskLog(runID, "处理中(%s): 状态=%s", elapsed, status)
			lastLogStatus = status
		}
		if status == "FINISH" {
			return detail, nil
		}
		if status == "FAIL" {
			code, _ := detail["ErrCode"].(string)
			message, _ := detail["Message"].(string)
			return nil, fmt.Errorf("MPS 译制任务失败: %s %s", code, message)
		}
	}
	appendTaskLog(runID, "任务超时(超过 15 分钟, 最后状态: %s)", lastStatus)
	return nil, fmt.Errorf("MPS 译制任务超时(最后状态: %s)", lastStatus)
}

// extractOutputPath 从 DescribeTaskDetail 结果中提取输出视频的 COS 路径与存储桶信息。
// 译制任务(AiAnalysisTask Definition=25)的结果在 WorkflowTask.AiAnalysisResultSet,
// 输出在 DeLogoTask.Output.Path(注意 Type 是 "DeLogo",大写 L)。
func extractOutputPath(detail map[string]any) (objectPath, bucket, region string, err error) {
	wfTask, _ := detail["WorkflowTask"].(map[string]any)

	if analysisSet, ok := wfTask["AiAnalysisResultSet"].([]any); ok {
		for _, raw := range analysisSet {
			item, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			output := firstNonNilMap(item, "Output", "DeLogoTask.Output", "DelogoTask.Output", "DubbingTask.Output", "OutputFile")
			if outputPath := mapString(output, "Path"); outputPath != "" {
				bucket, region = outputBucketRegion(output)
				return outputPath, bucket, region, nil
			}
		}
	}

	// 兜底:从 MediaProcessResultSet 找输出文件
	if mediaSet, ok := wfTask["MediaProcessResultSet"].([]any); ok {
		for _, raw := range mediaSet {
			item, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			transcode, _ := item["TranscodeTask"].(map[string]any)
			output, _ := transcode["Output"].(map[string]any)
			if outputPath := mapString(output, "Path"); outputPath != "" {
				bucket, region = outputBucketRegion(output)
				return outputPath, bucket, region, nil
			}
		}
	}

	// 兜底2:递归收集形如输出视频文件的路径(以 delogo- 开头或视频扩展名结尾)
	fallbackPath, fallbackBucket, fallbackRegion := walkForVideoPath(detail)
	if fallbackPath != "" {
		return fallbackPath, fallbackBucket, fallbackRegion, nil
	}

	log.Printf("[translate] 解析输出失败: wfTask keys=%v", mapKeys(wfTask))
	return "", "", "", fmt.Errorf("译制任务完成但未找到输出视频文件")
}

// firstNonNilMap 依次尝试取 item 下指定路径的 map 值,返回第一个非 nil 的。
// 路径用 "." 分隔(如 "DeLogoTask.Output")。
func firstNonNilMap(item map[string]any, keys ...string) map[string]any {
	for _, keyPath := range keys {
		var current any = item
		valid := true
		for _, part := range strings.Split(keyPath, ".") {
			next, ok := current.(map[string]any)
			if !ok {
				valid = false
				break
			}
			current, ok = next[part]
			if !ok {
				valid = false
				break
			}
		}
		if valid {
			if result, ok := current.(map[string]any); ok {
				return result
			}
		}
	}
	return nil
}

// outputBucketRegion 从输出对象中解析输出存储桶信息(可能覆盖配置的桶/地域)。
func outputBucketRegion(output map[string]any) (bucket, region string) {
	storage, _ := output["OutputStorage"].(map[string]any)
	cosStorage, _ := storage["CosOutputStorage"].(map[string]any)
	return mapString(cosStorage, "Bucket"), mapString(cosStorage, "Region")
}

// walkForVideoPath 递归收集所有以视频扩展名结尾的对象路径,作为最后的兜底。
func walkForVideoPath(obj any) (objectPath, bucket, region string) {
	videoExts := []string{".mp4", ".mov", ".webm", ".avi", ".mkv"}
	var walk func(v any, currentBucket, currentRegion string) (string, string, string)
	walk = func(v any, currentBucket, currentRegion string) (string, string, string) {
		switch typed := v.(type) {
		case map[string]any:
			if storage, ok := typed["CosOutputStorage"].(map[string]any); ok {
				currentBucket = mapString(storage, "Bucket")
				currentRegion = mapString(storage, "Region")
			}
			if p, ok := typed["Path"].(string); ok {
				for _, ext := range videoExts {
					if strings.HasSuffix(strings.ToLower(p), ext) {
						return p, currentBucket, currentRegion
					}
				}
			}
			for _, val := range typed {
				if p, b, r := walk(val, currentBucket, currentRegion); p != "" {
					return p, b, r
				}
			}
		case []any:
			for _, val := range typed {
				if p, b, r := walk(val, currentBucket, currentRegion); p != "" {
					return p, b, r
				}
			}
		}
		return "", "", ""
	}
	return walk(obj, "", "")
}

// mapString 安全取 map 中的字符串值。
func mapString(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	value, _ := m[key].(string)
	return value
}

// mapKeys 返回 map 的键(用于调试日志)。
func mapKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// boolText 布尔转中文文案。
func boolText(value bool) string {
	if value {
		return "开"
	}
	return "关"
}

// subtitleModeText 把是否有硬字幕转换为可读文案(供日志展示)。
func subtitleModeText(hasHardSubtitle bool) string {
	if hasHardSubtitle {
		return "检测到硬字幕,走擦除+OCR"
	}
	return "未检测到硬字幕,走 ASR"
}
