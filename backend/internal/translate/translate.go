// Package translate 实现「视频译制·全球投放」能力：MPS 视频译制（AiAnalysisTask Definition=25）一站式完成
// 字幕提取(OCR/ASR) → 翻译 → 原字幕擦除 → 压制译文字幕 → AI 克隆配音，支持多种目标语言。
// 该包完全独立于现有 handler 包，遵循"只增不改"：新增 API 全部挂在 /api/translate/*，
// 复用现有加密凭证与 TC3 签名，不修改任何现有 handler 行为。
package translate

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"cnb.cool/txcloud/txstudio/backend/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// MPS 产品信息（与现有 handler/vod_invoke.go 对齐）
const (
	mpsService = "mps"
	mpsHost    = "mps.tencentcloudapi.com"
	mpsVersion = "2019-06-12"
)

// 异步任务结果文件的目录（临时数据，不落 SQLite）
var (
	taskDirOnce     sync.Once
	taskCleanerOnce sync.Once
	taskDirVal      string
)

// taskDir 返回任务临时目录（默认系统 temp/txstudio-translate-tasks），同一进程内只解析一次。
func taskDir() string {
	taskDirOnce.Do(func() {
		taskDirVal = filepath.Join(os.TempDir(), "txstudio-translate-tasks")
	})
	return taskDirVal
}

// TranslateApp 提供视频译制能力所需的依赖。
type TranslateApp struct {
	DB     *gorm.DB
	Crypto *service.CryptoService
	Client *http.Client
}

// NewTranslateApp 构造 TranslateApp。
func NewTranslateApp(db *gorm.DB, crypto *service.CryptoService) *TranslateApp {
	return &TranslateApp{
		DB:     db,
		Crypto: crypto,
		Client: &http.Client{Timeout: 120 * time.Second},
	}
}

// Register 在 /api 分组下注册视频译制路由（只追加，不影响现有路由）。
func Register(api *gin.RouterGroup, app *TranslateApp) {
	v := api.Group("/translate")
	{
		v.POST("/upload", app.handleUpload)
		v.POST("/translate", app.handleTranslate)
		v.GET("/tasks/:runId/result", app.handleTaskResult)
		v.GET("/tasks/:runId/log", app.handleTaskLog)
	}
	taskCleanerOnce.Do(startTaskCleaner)
}

// 视频译制支持语种（与腾讯云文档 https://cloud.tencent.com/document/product/862/124504#language 对齐）
var LANG_NAMES = map[string]string{
	"zh": "中文", "en": "英语", "ja": "日语", "de": "德语",
	"fr": "法语", "ko": "韩语", "ru": "俄语", "uk": "乌克兰语",
	"pt": "葡萄牙语", "it": "意大利语", "es": "西班牙语", "id": "印度尼西亚语",
	"nl": "荷兰语", "tr": "土耳其语", "fil": "菲律宾语", "ms": "马来语",
	"el": "希腊语", "fi": "芬兰语", "hr": "克罗地亚语", "sk": "斯洛伐克语",
	"pl": "波兰语", "sv": "瑞典语", "hi": "印地语", "bg": "保加利亚语",
	"ro": "罗马尼亚语", "cs": "捷克语", "da": "丹麦语", "ta": "泰米尔语",
	"hun": "匈牙利语", "vi": "越南语", "th": "泰语", "ar": "阿拉伯语",
}

// ------------------------- 凭证读取（复用现有加密存储） -------------------------

// loadTencentCredential 解密全局腾讯云凭证。
// 返回 map，含 secret_id / secret_key / region / sub_app_id / mps_bucket / mps_region。
func (a *TranslateApp) loadTencentCredential() (map[string]interface{}, error) {
	var credential model.Credential
	if err := a.DB.Where("provider = ?", "tencent-cloud").First(&credential).Error; err != nil {
		return nil, fmt.Errorf("未配置腾讯云媒体服务凭证，请在右上角 API 设置中配置")
	}
	plaintext, err := a.Crypto.Decrypt(credential.EncryptedData)
	if err != nil {
		return nil, fmt.Errorf("腾讯云凭证解密失败")
	}
	var data map[string]interface{}
	if err := json.Unmarshal(plaintext, &data); err != nil {
		return nil, fmt.Errorf("腾讯云凭证格式错误")
	}
	return data, nil
}

// stringValue 安全提取 map 中的字符串值。
func stringValue(value interface{}) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprint(value)
}

// ------------------------- MPS 代签请求 -------------------------

// invokeMPS 对 MPS API 执行一次 TC3 代签调用，返回响应体。
// 复用现有 service.SignVodRequest 的通用 TC3 签名（service 参数为 mps）。
func (a *TranslateApp) invokeMPS(secretID, secretKey, region, action, payload string) ([]byte, error) {
	timestamp := time.Now().Unix()
	signed := service.SignVodRequest(
		secretID, secretKey, action, mpsVersion, region, mpsService, mpsHost, payload, timestamp,
	)
	req, err := http.NewRequest("POST", "https://"+mpsHost, bytes.NewReader([]byte(payload)))
	if err != nil {
		return nil, fmt.Errorf("构造请求失败: %w", err)
	}
	req.Header.Set("Authorization", signed.Authorization)
	req.Header.Set("Content-Type", signed.ContentType)
	req.Header.Set("Host", mpsHost)
	req.Header.Set("X-TC-Action", signed.XTCAction)
	req.Header.Set("X-TC-Timestamp", signed.XTCTimestamp)
	req.Header.Set("X-TC-Version", signed.XTCVersion)
	if signed.XTCRegion != "" {
		req.Header.Set("X-TC-Region", signed.XTCRegion)
	}

	resp, err := a.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("调用腾讯云 MPS 失败: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取 MPS 响应失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("MPS API 返回 %d: %s", resp.StatusCode, truncateString(string(body), 500))
	}
	// 腾讯云 API 响应统一用 { "Response": { ... } } 包裹;剥掉外壳,让调用方直接解析内层。
	// 若响应含 Error,直接返回错误。
	var envelope struct {
		Response *json.RawMessage `json:"Response"`
	}
	if err := json.Unmarshal(body, &envelope); err == nil && envelope.Response != nil {
		var inner map[string]any
		if err := json.Unmarshal(*envelope.Response, &inner); err == nil {
			if errObj, ok := inner["Error"].(map[string]any); ok {
				code, _ := errObj["Code"].(string)
				msg, _ := errObj["Message"].(string)
				return nil, fmt.Errorf("MPS %s: %s: %s", action, code, msg)
			}
			// 返回剥壳后的内层 JSON
			innerBytes, _ := json.Marshal(inner)
			return innerBytes, nil
		}
	}
	return body, nil
}

// truncateString 截断长字符串用于错误信息。
func truncateString(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

// ------------------------- 响应辅助(对齐现有 handler 包的 OK/Fail 格式) -------------------------

// OK 成功响应
func OK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// Fail 错误响应
func Fail(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"success": false, "error": msg})
}

// ------------------------- 异步任务存储 -------------------------

// writeTaskResult 将任务结果写入临时文件，供前端轮询读取。
func writeTaskResult(runID string, result map[string]interface{}) error {
	if err := os.MkdirAll(taskDir(), 0o700); err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]interface{}{
		"ready":  true,
		"status": "success",
		"result": result,
	})
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(taskDir(), runID+".json"), payload, 0o600)
}

// writeTaskError 将任务错误写入临时文件。
func writeTaskError(runID string, message string) error {
	if err := os.MkdirAll(taskDir(), 0o700); err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]interface{}{
		"ready":  true,
		"status": "error",
		"error":  message,
	})
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(taskDir(), runID+".json"), payload, 0o600)
}

// newRunID 生成一个任务 ID。
func newRunID() string {
	return fmt.Sprintf("tr_%d", time.Now().UnixNano())
}
