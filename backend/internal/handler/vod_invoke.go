package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"cnb.cool/txcloud/txstudio/backend/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	maxVODInvokeRequestBody  = 1 << 20
	maxVODInvokeResponseBody = 4 << 20
)

var vodActions = map[string]struct{}{
	"ApplyUpload": {}, "CommitUpload": {}, "PullUpload": {},
	"CreateAigcImageTask": {}, "CreateAigcVideoTask": {},
	"DescribeTaskDetail": {}, "DescribeTaskResult": {}, "DescribeTasks": {}, "DescribeMediaInfos": {},
	"ComposeMedia": {}, "ProcessMedia": {},
}

var mpsActions = map[string]struct{}{
	"ProcessImage": {}, "DescribeImageTaskDetail": {},
}

// TencentInvokeHandler 为固定腾讯云产品提供 TC3 代签和 action 白名单转发。
type TencentInvokeHandler struct {
	DB             *gorm.DB
	Crypto         *service.CryptoService
	Client         *http.Client
	Service        string
	Host           string
	DefaultVersion string
	AllowedActions map[string]struct{}
	InjectSubAppID bool
}

func NewVODInvokeHandler(db *gorm.DB, crypto *service.CryptoService) *TencentInvokeHandler {
	return &TencentInvokeHandler{
		DB: db, Crypto: crypto,
		Service: "vod", Host: "vod.tencentcloudapi.com", DefaultVersion: "2018-07-17",
		AllowedActions: vodActions, InjectSubAppID: true,
	}
}

func NewMPSInvokeHandler(db *gorm.DB, crypto *service.CryptoService) *TencentInvokeHandler {
	return &TencentInvokeHandler{
		DB: db, Crypto: crypto,
		Service: "mps", Host: "mps.tencentcloudapi.com", DefaultVersion: "2019-06-12",
		AllowedActions: mpsActions,
	}
}

type invokeReq struct {
	Action  string          `json:"action"`
	Version string          `json:"version"`
	Region  string          `json:"region"`
	Payload json.RawMessage `json:"payload"`
}

func normalizeAigcStorageMode(action string, payload map[string]interface{}) error {
	if action != "CreateAigcImageTask" && action != "CreateAigcVideoTask" {
		return nil
	}
	outputConfig, exists := payload["OutputConfig"]
	if !exists || outputConfig == nil {
		payload["OutputConfig"] = map[string]interface{}{"StorageMode": "Permanent"}
		return nil
	}
	config, ok := outputConfig.(map[string]interface{})
	if !ok {
		return fmt.Errorf("OutputConfig 必须是对象")
	}
	storageMode, _ := config["StorageMode"].(string)
	storageMode = strings.TrimSpace(storageMode)
	if storageMode == "" {
		config["StorageMode"] = "Permanent"
		return nil
	}
	if storageMode != "Permanent" && storageMode != "Temporary" {
		return fmt.Errorf("StorageMode 仅支持 Permanent 或 Temporary")
	}
	config["StorageMode"] = storageMode
	return nil
}

// Invoke 从 SQLite 解密全局腾讯云凭证，并仅向预设产品域名转发白名单 action。
func (h *TencentInvokeHandler) Invoke(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxVODInvokeRequestBody)
	var req invokeReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Action) == "" {
		BadRequest(c, "请求参数无效")
		return
	}
	payload := map[string]interface{}{}
	if len(req.Payload) > 0 {
		if err := json.Unmarshal(req.Payload, &payload); err != nil {
			BadRequest(c, "payload 格式错误")
			return
		}
	}
	statusCode, contentType, responseBody, err := h.CallRaw(c, req.Action, req.Version, req.Region, payload)
	if err != nil {
		BadRequest(c, err.Error())
		return
	}
	c.Data(statusCode, contentType, responseBody)
}

// CallRaw 使用本机加密保存的凭证调用腾讯云白名单 API，供 HTTP 路由与历史同步共用。
// 调用方永远不接触 SecretId 或 SecretKey。
func (h *TencentInvokeHandler) CallRaw(c *gin.Context, action, version, region string, payload map[string]interface{}) (int, string, []byte, error) {
	action = strings.TrimSpace(action)
	if _, allowed := h.AllowedActions[action]; !allowed {
		return 0, "", nil, fmt.Errorf("不支持的腾讯云 Action")
	}
	if version == "" {
		version = h.DefaultVersion
	}
	credentialData, err := h.loadTencentCredential()
	if err != nil {
		return 0, "", nil, err
	}
	secretID, _ := credentialData["secret_id"].(string)
	secretKey, _ := credentialData["secret_key"].(string)
	credentialRegion, _ := credentialData["region"].(string)
	if secretID == "" || secretKey == "" {
		return 0, "", nil, fmt.Errorf("腾讯云凭证缺少 SecretId 或 SecretKey")
	}
	if region == "" {
		region = credentialRegion
	}
	if payload == nil {
		payload = map[string]interface{}{}
	}
	if err := normalizeAigcStorageMode(action, payload); err != nil {
		return 0, "", nil, err
	}
	if h.InjectSubAppID {
		subAppID, parseErr := parsePositiveUint64(credentialData["sub_app_id"])
		if parseErr != nil {
			return 0, "", nil, fmt.Errorf("腾讯云凭证中的 SubAppId 必须是正整数")
		}
		payload["SubAppId"] = subAppID
	}
	signedPayload, err := json.Marshal(payload)
	if err != nil {
		return 0, "", nil, fmt.Errorf("payload 序列化失败")
	}
	signed := service.SignVodRequest(secretID, secretKey, action, version, region, h.Service, h.Host, string(signedPayload), time.Now().Unix())
	httpReq, err := http.NewRequest("POST", "https://"+h.Host, bytes.NewReader(signedPayload))
	if err != nil {
		return 0, "", nil, fmt.Errorf("构造请求失败")
	}
	httpReq.Header.Set("Authorization", signed.Authorization)
	httpReq.Header.Set("Content-Type", signed.ContentType)
	httpReq.Header.Set("Host", h.Host)
	httpReq.Header.Set("X-TC-Action", signed.XTCAction)
	httpReq.Header.Set("X-TC-Timestamp", signed.XTCTimestamp)
	httpReq.Header.Set("X-TC-Version", signed.XTCVersion)
	if signed.XTCRegion != "" {
		httpReq.Header.Set("X-TC-Region", signed.XTCRegion)
	}
	client := h.Client
	if client == nil {
		client = &http.Client{Timeout: 120 * time.Second}
	}
	upstreamStartedAt := time.Now()
	response, err := client.Do(httpReq)
	if err != nil {
		if c != nil {
			logUpstreamTransportError(c, "tencent-cloud", h.Service, action, upstreamStartedAt, err)
		}
		if strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), "deadline") {
			return 0, "", nil, fmt.Errorf("腾讯云 API 响应超时")
		}
		return 0, "", nil, fmt.Errorf("调用腾讯云 API 失败: %w", err)
	}
	defer response.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, maxVODInvokeResponseBody+1))
	if readErr != nil {
		return 0, "", nil, fmt.Errorf("读取腾讯云 API 响应失败")
	}
	if len(responseBody) > maxVODInvokeResponseBody {
		return 0, "", nil, fmt.Errorf("腾讯云 API 响应过大")
	}
	if c != nil {
		logUpstreamResult(c, "tencent-cloud", h.Service, action, response.StatusCode, upstreamStartedAt, response.Header, responseBody)
	}
	contentType := response.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json; charset=utf-8"
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return response.StatusCode, contentType, responseBody, fmt.Errorf("腾讯云 API 返回 HTTP %d", response.StatusCode)
	}
	return response.StatusCode, contentType, responseBody, nil
}

func (h *TencentInvokeHandler) loadTencentCredential() (map[string]interface{}, error) {
	return loadTencentCredentialData(h.DB, h.Crypto)
}

// loadTencentCredentialData 读取本机加密保存的腾讯云媒体服务凭证，供 VOD 代签与素材缓存共用。
func loadTencentCredentialData(db *gorm.DB, crypto *service.CryptoService) (map[string]interface{}, error) {
	var credential model.Credential
	if err := db.Where("provider = ?", "tencent-cloud").First(&credential).Error; err != nil {
		return nil, &publicError{message: "未配置腾讯云媒体服务凭证，请在右上角 API 设置中配置"}
	}
	plaintext, err := crypto.Decrypt(credential.EncryptedData)
	if err != nil {
		return nil, &publicError{message: "腾讯云凭证解密失败"}
	}
	var data map[string]interface{}
	if err := json.Unmarshal(plaintext, &data); err != nil {
		return nil, &publicError{message: "腾讯云凭证格式错误"}
	}
	return data, nil
}

type publicError struct{ message string }

func (e *publicError) Error() string { return e.message }

func parsePositiveUint64(value interface{}) (uint64, error) {
	var parsed uint64
	var err error

	switch typed := value.(type) {
	case uint64:
		parsed = typed
	case uint:
		parsed = uint64(typed)
	case uint32:
		parsed = uint64(typed)
	case int:
		if typed > 0 {
			parsed = uint64(typed)
		}
	case int64:
		if typed > 0 {
			parsed = uint64(typed)
		}
	case int32:
		if typed > 0 {
			parsed = uint64(typed)
		}
	case float64:
		if typed > 0 && typed == math.Trunc(typed) {
			parsed = uint64(typed)
		}
	case float32:
		value64 := float64(typed)
		if value64 > 0 && value64 == math.Trunc(value64) {
			parsed = uint64(value64)
		}
	case json.Number:
		parsed, err = strconv.ParseUint(string(typed), 10, 64)
	case string:
		parsed, err = strconv.ParseUint(strings.TrimSpace(typed), 10, 64)
	default:
		err = fmt.Errorf("unsupported SubAppId type %T", value)
	}

	if err != nil || parsed == 0 {
		return 0, fmt.Errorf("SubAppId must be a positive uint64")
	}
	return parsed, nil
}
