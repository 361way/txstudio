package handler

import (
	"encoding/json"
	"fmt"
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

// ProxyHandler 通用 CORS 代理（复用现有 proxy-server.go 逻辑，加 SSRF 防护）
type ProxyHandler struct {
	client *http.Client
	db     *gorm.DB
	crypto *service.CryptoService
}

var hopByHop = map[string]struct{}{
	"connection": {}, "keep-alive": {}, "proxy-authenticate": {},
	"proxy-authorization": {}, "te": {}, "trailer": {},
	"transfer-encoding": {}, "upgrade": {}, "host": {},
}

func NewProxyHandler(db *gorm.DB, crypto *service.CryptoService) *ProxyHandler {
	return &ProxyHandler{
		client: &http.Client{Timeout: 120 * time.Second},
		db:     db,
		crypto: crypto,
	}
}

type proxyReq struct {
	URL     string            `json:"url" binding:"required"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

// QueryProxy 处理 query 参数形式的代理请求，供画布与媒体工具共用。
func (h *ProxyHandler) QueryProxy(c *gin.Context) {
	target := strings.TrimSpace(c.Query("url"))
	parsed, err := validateProxyTarget(target)
	if err != nil {
		BadRequest(c, err.Error())
		return
	}

	outReq, err := http.NewRequest(c.Request.Method, parsed.String(), c.Request.Body)
	if err != nil {
		BadRequest(c, "创建上游请求失败")
		return
	}
	for key, values := range c.Request.Header {
		if _, skip := hopByHop[strings.ToLower(key)]; skip {
			continue
		}
		for _, value := range values {
			outReq.Header.Add(key, value)
		}
	}
	outReq.Host = parsed.Host
	if err := h.injectStoredCredential(outReq); err != nil {
		InternalError(c, err.Error())
		return
	}
	h.forward(c, outReq)
}

// Proxy 通用 JSON 代理
func (h *ProxyHandler) Proxy(c *gin.Context) {
	var req proxyReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "url 必填")
		return
	}
	parsed, err := validateProxyTarget(req.URL)
	if err != nil {
		BadRequest(c, err.Error())
		return
	}

	method := strings.ToUpper(req.Method)
	if method == "" {
		method = c.Request.Method
	}
	var bodyReader io.Reader
	if req.Body != "" {
		bodyReader = strings.NewReader(req.Body)
	}
	outReq, err := http.NewRequest(method, parsed.String(), bodyReader)
	if err != nil {
		BadRequest(c, "创建上游请求失败")
		return
	}
	for k, v := range req.Headers {
		if _, skip := hopByHop[strings.ToLower(k)]; !skip {
			outReq.Header.Set(k, v)
		}
	}
	outReq.Host = parsed.Host
	if err := h.injectStoredCredential(outReq); err != nil {
		InternalError(c, err.Error())
		return
	}

	h.forward(c, outReq)
}

// COSPut COS PUT 上传代理
func (h *ProxyHandler) COSPut(c *gin.Context) {
	target := c.Query("url")
	if target == "" {
		BadRequest(c, "缺少 url 参数")
		return
	}
	parsed, err := url.Parse(target)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		BadRequest(c, "无效的目标 URL")
		return
	}
	if parsed.Scheme != "https" {
		BadRequest(c, "COS 上传仅支持 https")
		return
	}
	if !strings.HasSuffix(parsed.Hostname(), ".myqcloud.com") {
		BadRequest(c, "目标非腾讯云 COS 域名")
		return
	}

	outReq, err := http.NewRequest(http.MethodPut, parsed.String(), c.Request.Body)
	if err != nil {
		BadRequest(c, "创建上传请求失败")
		return
	}
	for k, vs := range c.Request.Header {
		if _, skip := hopByHop[strings.ToLower(k)]; skip {
			continue
		}
		for _, v := range vs {
			outReq.Header.Add(k, v)
		}
	}
	outReq.Host = parsed.Host

	resp, err := h.client.Do(outReq)
	if err != nil {
		InternalError(c, "COS 上传失败: "+err.Error())
		return
	}
	defer resp.Body.Close()

	for key, values := range resp.Header {
		if _, skip := hopByHop[strings.ToLower(key)]; skip {
			continue
		}
		for _, v := range values {
			c.Header(key, v)
		}
	}
	c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), readAllOrNull(resp.Body))
}

func (h *ProxyHandler) injectStoredCredential(req *http.Request) error {
	if req.Header.Get("Authorization") != "Bearer __server__" {
		return nil
	}
	var credential model.Credential
	if err := h.db.Where("provider = ?", "tokenhub").First(&credential).Error; err != nil {
		return fmt.Errorf("未配置 TokenHub API Key，请在右上角 API 设置中配置")
	}
	plaintext, err := h.crypto.Decrypt(credential.EncryptedData)
	if err != nil {
		return fmt.Errorf("解密 TokenHub API Key 失败")
	}
	var data map[string]interface{}
	if err := json.Unmarshal(plaintext, &data); err != nil {
		return fmt.Errorf("TokenHub 凭证格式无效")
	}
	apiKey, _ := data["api_key"].(string)
	if strings.TrimSpace(apiKey) == "" {
		return fmt.Errorf("TokenHub API Key 为空")
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	return nil
}

func validateProxyTarget(target string) (*url.URL, error) {
	if target == "" {
		return nil, fmt.Errorf("缺少目标 URL")
	}
	parsed, err := url.Parse(target)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("无效的目标 URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("仅支持 http/https")
	}
	if isInternalHost(parsed.Hostname()) {
		return nil, fmt.Errorf("目标地址不允许为内网地址")
	}
	return parsed, nil
}

func (h *ProxyHandler) forward(c *gin.Context, req *http.Request) {
	resp, err := h.client.Do(req)
	if err != nil {
		InternalError(c, "上游请求失败: "+err.Error())
		return
	}
	defer resp.Body.Close()
	for key, values := range resp.Header {
		if _, skip := hopByHop[strings.ToLower(key)]; skip {
			continue
		}
		for _, value := range values {
			c.Header(key, value)
		}
	}
	c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), readAllOrNull(resp.Body))
}

// isInternalHost SSRF 防护：禁止内网地址
func isInternalHost(hostname string) bool {
	if hostname == "localhost" || hostname == "0.0.0.0" {
		return true
	}
	ip := net.ParseIP(hostname)
	if ip == nil {
		ips, err := net.LookupIP(hostname)
		if err != nil || len(ips) == 0 {
			return false
		}
		ip = ips[0]
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified()
}

func readAllOrNull(r io.Reader) []byte {
	data, err := io.ReadAll(r)
	if err != nil {
		return []byte(fmt.Sprintf("读取响应失败: %v", err))
	}
	return data
}
