package handler

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ProxyHandler 通用 CORS 代理（复用现有 proxy-server.go 逻辑，加 SSRF 防护）
type ProxyHandler struct {
	client *http.Client
}

var hopByHop = map[string]struct{}{
	"connection": {}, "keep-alive": {}, "proxy-authenticate": {},
	"proxy-authorization": {}, "te": {}, "trailer": {},
	"transfer-encoding": {}, "upgrade": {}, "host": {},
}

func NewProxyHandler() *ProxyHandler {
	return &ProxyHandler{client: &http.Client{Timeout: 120 * time.Second}}
}

type proxyReq struct {
	URL     string            `json:"url" binding:"required"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

// Proxy 通用 CORS 代理
func (h *ProxyHandler) Proxy(c *gin.Context) {
	var req proxyReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "url 必填")
		return
	}
	parsed, err := url.Parse(req.URL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		BadRequest(c, "无效的目标 URL")
		return
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		BadRequest(c, "仅支持 http/https")
		return
	}
	if isInternalHost(parsed.Hostname()) {
		BadRequest(c, "目标地址不允许为内网地址")
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

	resp, err := h.client.Do(outReq)
	if err != nil {
		InternalError(c, "上游请求失败: "+err.Error())
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
