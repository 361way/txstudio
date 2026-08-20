// Package viral 实现「爆款复刻」能力：视频理解拆解 → 裂变方案 → 一键生成同款视频。
// 该包完全独立于现有 handler 包，遵循"只增不改"：新增 API 全部挂在 /api/viral/*，
// 复用现有加密凭证与 TC3 签名，不修改任何现有 handler 行为。
package viral

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
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

// taskDir 返回任务临时目录（默认系统 temp/viral-tasks），同一进程内只解析一次。
func taskDir() string {
	taskDirOnce.Do(func() {
		taskDirVal = filepath.Join(os.TempDir(), "txstudio-viral-tasks")
	})
	return taskDirVal
}

// ViralApp 提供爆款复刻能力所需的依赖。
type ViralApp struct {
	DB     *gorm.DB
	Crypto *service.CryptoService
	Client *http.Client
}

// NewViralApp 构造 ViralApp。
func NewViralApp(db *gorm.DB, crypto *service.CryptoService) *ViralApp {
	return &ViralApp{
		DB:     db,
		Crypto: crypto,
		Client: &http.Client{Timeout: 120 * time.Second},
	}
}

// Register 在 /api 分组下注册爆款复刻路由（只追加，不影响现有路由）。
func Register(api *gin.RouterGroup, app *ViralApp) {
	v := api.Group("/viral")
	{
		v.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
		v.POST("/upload", app.handleUpload)
		v.POST("/clone", app.handleClone)
		v.GET("/tasks/:runId/result", app.handleTaskResult)
		v.GET("/tasks/:runId/log", app.handleTaskLog)
	}
	// 进程启动后异步恢复未完成任务并清理过期本地结果，不阻塞路由注册。
	go app.resumeCloneTasks()
	taskCleanerOnce.Do(startTaskCleaner)
}

// ------------------------- 凭证读取（复用现有加密存储） -------------------------

// loadTencentCredential 解密全局腾讯云凭证。
// 返回 map，含 secret_id / secret_key / region / sub_app_id / mps_bucket / mps_region。
func (a *ViralApp) loadTencentCredential() (map[string]interface{}, error) {
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

// loadTokenhubCredential 解密全局 TokenHub 凭证；缺失时回退到默认网关。
func (a *ViralApp) loadTokenhubCredential() (apiKey, baseURL string) {
	var credential model.Credential
	if err := a.DB.Where("provider = ?", "tokenhub").First(&credential).Error; err != nil {
		return "", ""
	}
	plaintext, err := a.Crypto.Decrypt(credential.EncryptedData)
	if err != nil {
		return "", ""
	}
	var data map[string]interface{}
	if err := json.Unmarshal(plaintext, &data); err != nil {
		return "", ""
	}
	apiKey = stringValue(data["api_key"])
	baseURL = strings.TrimRight(stringValue(data["base_url"]), "/")
	return apiKey, baseURL
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
func (a *ViralApp) invokeMPS(secretID, secretKey, region, action, payload string) ([]byte, error) {
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
	return fmt.Sprintf("vr_%d", time.Now().UnixNano())
}
