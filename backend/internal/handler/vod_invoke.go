package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vodstudio/backend/internal/middleware"
	"github.com/vodstudio/backend/internal/model"
	"github.com/vodstudio/backend/internal/service"
	"gorm.io/gorm"
)

// VODInvokeHandler 腾讯云 VOD API 调用代理端点
// 后端代签 TC3-HMAC、注入 SubAppId、转发请求、配额强制
type VODInvokeHandler struct {
	DB     *gorm.DB
	Crypto *service.CryptoService
	Client *http.Client
}

// invokeReq 请求体
type invokeReq struct {
	Action  string          `json:"action" binding:"required"`
	Version string          `json:"version"`
	Region  string          `json:"region"`
	Payload json.RawMessage `json:"payload"`
}

// VODContextKey 用于在 context 中传递已缓存的请求体
const VODInvokeBodyKey = "vod_invoke_body"

// UsageTypeForVODAction 根据 VOD action 名解析用量类型
// 返回 (usageType, skip)：skip=true 表示不计配额（轮询类）
func UsageTypeForVODAction(action string) (string, bool) {
	switch action {
	case "CreateAigcImageTask", "CreateImage":
		return "image_gen", false
	case "CreateAigcVideoTask", "ComposeMedia", "SubmitMedia":
		return "video_gen", false
	case "DescribeTaskDetail", "DescribeTaskResult", "DescribeTasks":
		// 轮询不计配额，避免用户被免费轮询绕过的同时不重复扣费
		return "", true
	case "ApplyUpload", "CommitUpload", "PullUpload":
		// 上传相关不计生成配额
		return "", true
	default:
		// 未知 action 默认不计配额（放行），由调用方决定
		return "", true
	}
}

// needsSubAppID 判断该 action 是否强制要求 SubAppId
func needsSubAppID(action string) bool {
	switch action {
	case "ApplyUpload", "CommitUpload", "PullUpload",
		"CreateAigcImageTask", "CreateAigcVideoTask",
		"DescribeTaskDetail", "DescribeTaskResult", "DescribeTasks":
		return true
	default:
		return false
	}
}

// parseSubAppID 兼容 string / float64 / json.Number / int 等多种 JSON 反序列化形态，返回正整数（无效返回 0）
func parseSubAppID(v interface{}) int64 {
	switch n := v.(type) {
	case nil:
		return 0
	case string:
		id, err := strconv.ParseInt(strings.TrimSpace(n), 10, 64)
		if err != nil {
			return 0
		}
		return id
	case json.Number:
		id, err := n.Int64()
		if err != nil {
			return 0
		}
		return id
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	default:
		return 0
	}
}

// VODUsageResolver 供 QuotaCheckWithResolver 使用：从请求体解析 action 决定 usageType
func VODUsageResolver(db *gorm.DB) middleware.UsageTypeResolver {
	return func(c *gin.Context) (string, bool) {
		// 缓存 body（middleware 先于 handler 执行，handler 需要重新读）
		bodyBytes, err := io.ReadAll(c.Request.Body)
		c.Request.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		if err != nil {
			return "", true
		}
		c.Set(VODInvokeBodyKey, bodyBytes)

		var req invokeReq
		if err := json.Unmarshal(bodyBytes, &req); err != nil {
			return "", true
		}
		c.Set("vod_invoke_action", req.Action)
		return UsageTypeForVODAction(req.Action)
	}
}

// Invoke POST /api/vod/invoke — 代签转发腾讯云 VOD API
func (h *VODInvokeHandler) Invoke(c *gin.Context) {
	// 从 context 取已缓存的 body（resolver 已读取过）
	bodyBytes, _ := c.Get(VODInvokeBodyKey)
	var req invokeReq
	if err := json.Unmarshal(bodyBytes.([]byte), &req); err != nil {
		BadRequest(c, "请求参数无效")
		return
	}
	if req.Version == "" {
		req.Version = "2018-07-17"
	}

	// 取当前用户租户的 VOD 凭证
	tenantID := middleware.GetCurrentTenantID(c)
	if tenantID == 0 {
		BadRequest(c, "无法识别租户")
		return
	}
	var cred model.Credential
	if err := h.DB.Where("tenant_id = ? AND provider = ?", tenantID, "vod").First(&cred).Error; err != nil {
		BadRequest(c, "未配置腾讯云 VOD 凭据，请联系管理员在后台配置")
		return
	}
	plaintext, err := h.Crypto.Decrypt(cred.EncryptedData)
	if err != nil {
		InternalError(c, "凭证解密失败")
		return
	}
	var credMap map[string]interface{}
	if err := json.Unmarshal(plaintext, &credMap); err != nil {
		InternalError(c, "凭证格式错误")
		return
	}
	secretID, _ := credMap["secret_id"].(string)
	secretKey, _ := credMap["secret_key"].(string)
	subAppID := parseSubAppID(credMap["sub_app_id"])
	credRegion, _ := credMap["region"].(string)
	if secretID == "" || secretKey == "" {
		BadRequest(c, "VOD 凭证不完整（缺少 SecretId/SecretKey）")
		return
	}
	if req.Region == "" {
		req.Region = credRegion
	}

	// 注入 SubAppId（payload 未带或为空/0 时，从租户凭证注入，防伪造且修正空值）
	var payloadObj map[string]interface{}
	if err := json.Unmarshal(req.Payload, &payloadObj); err != nil {
		BadRequest(c, "payload 格式错误")
		return
	}
	// 前端可能传了 SubAppId:0/null/""（无效值），一律以凭证为准覆盖
	if subAppID > 0 && parseSubAppID(payloadObj["SubAppId"]) <= 0 {
		payloadObj["SubAppId"] = subAppID
	}
	// VOD 上传/AIGC 等接口要求 SubAppId 为正整数，缺失则直接报错而非透传给腾讯云
	if needsSubAppID(req.Action) && parseSubAppID(payloadObj["SubAppId"]) <= 0 {
		BadRequest(c, "VOD 凭证缺少有效 SubAppId，请在管理后台配置正确的子应用 ID")
		return
	}
	signedPayload, err := json.Marshal(payloadObj)
	if err != nil {
		InternalError(c, "payload 序列化失败")
		return
	}

	// 签名（使用当前时间戳）
	host := "vod.tencentcloudapi.com"
	timestamp := time.Now().Unix()
	signed := service.SignVodRequest(secretID, secretKey, req.Action, req.Version, req.Region, "vod", host, string(signedPayload), timestamp)

	// 构造转发请求
	httpReq, err := http.NewRequest("POST", "https://"+host, bytes.NewReader(signedPayload))
	if err != nil {
		InternalError(c, "构造请求失败")
		return
	}
	httpReq.Header.Set("Authorization", signed.Authorization)
	httpReq.Header.Set("Content-Type", signed.ContentType)
	httpReq.Header.Set("Host", host)
	httpReq.Header.Set("X-TC-Action", signed.XTCAction)
	httpReq.Header.Set("X-TC-Timestamp", signed.XTCTimestamp)
	httpReq.Header.Set("X-TC-Version", signed.XTCVersion)
	if signed.XTCRegion != "" {
		httpReq.Header.Set("X-TC-Region", signed.XTCRegion)
	}

	if h.Client == nil {
		h.Client = &http.Client{Timeout: 120 * time.Second}
	}
	resp, err := h.Client.Do(httpReq)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline") {
			InternalError(c, "腾讯云 API 响应超时")
		} else {
			InternalError(c, "调用腾讯云 API 失败: "+msg)
		}
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json; charset=utf-8"
	}
	c.Data(resp.StatusCode, contentType, respBody)

	// 用量记录由 QuotaCheckWithResolver 中间件在 2xx 时自动写入（RecordUserUsage）
	_ = fmt.Sprintf // keep import if not used elsewhere
}
