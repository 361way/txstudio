package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"cnb.cool/txcloud/txstudio/backend/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const maxAgentChatBody = 2 << 20

type AgentChatHandler struct {
	db              *gorm.DB
	crypto          *service.CryptoService
	fallbackAPIKey  string
	fallbackBaseURL string
	client          *http.Client
}

func NewAgentChatHandler(db *gorm.DB, crypto *service.CryptoService, fallbackAPIKey, fallbackBaseURL string) *AgentChatHandler {
	return &AgentChatHandler{
		db:              db,
		crypto:          crypto,
		fallbackAPIKey:  strings.TrimSpace(fallbackAPIKey),
		fallbackBaseURL: strings.TrimRight(strings.TrimSpace(fallbackBaseURL), "/"),
		client:          &http.Client{Timeout: 90 * time.Second},
	}
}

func (h *AgentChatHandler) loadCredential() (string, string) {
	apiKey := h.fallbackAPIKey
	baseURL := h.fallbackBaseURL
	if h.db == nil || h.crypto == nil {
		return apiKey, baseURL
	}
	var credential model.Credential
	if err := h.db.Where("provider = ?", "tokenhub").First(&credential).Error; err != nil {
		return apiKey, baseURL
	}
	plaintext, err := h.crypto.Decrypt(credential.EncryptedData)
	if err != nil {
		return apiKey, baseURL
	}
	var data map[string]any
	if json.Unmarshal(plaintext, &data) != nil {
		return apiKey, baseURL
	}
	if value := stringValue(data["api_key"]); value != "" {
		apiKey = value
	}
	if value := strings.TrimRight(stringValue(data["base_url"]), "/"); value != "" {
		baseURL = value
	}
	return apiKey, baseURL
}

type agentChatRequest struct {
	Model          string           `json:"model"`
	Messages       []map[string]any `json:"messages"`
	ResponseFormat map[string]any   `json:"response_format,omitempty"`
	Temperature    float64          `json:"temperature,omitempty"`
}

func writeAgentChatError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"error": gin.H{"message": message}})
}

func isPublicHTTPS(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return false
	}
	addresses, err := net.LookupIP(host)
	if err != nil || len(addresses) == 0 {
		return false
	}
	for _, address := range addresses {
		if address.IsLoopback() || address.IsPrivate() || address.IsLinkLocalUnicast() || address.IsLinkLocalMulticast() || address.IsUnspecified() {
			return false
		}
	}
	return true
}

func (h *AgentChatHandler) Chat(c *gin.Context) {
	apiKey, baseURL := h.loadCredential()
	if apiKey == "" {
		writeAgentChatError(c, http.StatusServiceUnavailable, "智能 Agent 文本模型未配置，请在右上角 API 设置中配置 TokenHub")
		return
	}
	target := baseURL + "/v1/chat/completions"
	if !isPublicHTTPS(target) {
		writeAgentChatError(c, http.StatusServiceUnavailable, "智能 Agent 文本服务地址无效或不安全")
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAgentChatBody)
	var payload agentChatRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&payload); err != nil {
		writeAgentChatError(c, http.StatusBadRequest, "请求格式错误")
		return
	}
	payload.Model = strings.TrimSpace(payload.Model)
	if payload.Model == "" || len(payload.Model) > 128 || len(payload.Messages) == 0 || len(payload.Messages) > 12 {
		writeAgentChatError(c, http.StatusBadRequest, "模型或消息参数无效")
		return
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		writeAgentChatError(c, http.StatusBadRequest, "请求序列化失败")
		return
	}

	request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, target, bytes.NewReader(payloadBytes))
	if err != nil {
		writeAgentChatError(c, http.StatusInternalServerError, "创建上游请求失败")
		return
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+apiKey)
	upstreamStartedAt := time.Now()
	response, err := h.client.Do(request)
	if err != nil {
		logUpstreamTransportError(c, "tokenhub", "chat-completions", payload.Model, upstreamStartedAt, err)
		writeAgentChatError(c, http.StatusBadGateway, "文本模型服务暂不可用")
		return
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(response.Body, maxAgentChatBody))
	logUpstreamResult(c, "tokenhub", "chat-completions", payload.Model, response.StatusCode, upstreamStartedAt, response.Header, responseBody)

	c.Header("Content-Type", "application/json")
	c.Status(response.StatusCode)
	_, _ = c.Writer.Write(responseBody)
}
