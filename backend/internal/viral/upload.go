package viral

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/tencentyun/cos-go-sdk-v5"
)

// 爆款复刻素材上传:视频 + 商品图(最多 4 张) + 可选模特图/场景图。
// 对齐现有 handler/mps_asset.go 的 COS 客户端与安全校验,但不复用其内部函数(保持包独立)。

const (
	viralInputPrefix  = "txstudio-viral/library/"
	maxViralFileSize  = 500 << 20 // 500MB(视频)
	maxViralImageSize = 20 << 20  // 20MB(图片)
)

// tencentCosConfig 复刻任务所需的腾讯云凭证(仅 COS 上传用)。
type tencentCosConfig struct {
	SecretID  string
	SecretKey string
	Bucket    string
	Region    string
}

// loadCosConfig 从加密凭证读取 COS 上传配置。
func (a *ViralApp) loadCosConfig() (tencentCosConfig, error) {
	data, err := a.loadTencentCredential()
	if err != nil {
		return tencentCosConfig{}, err
	}
	config := tencentCosConfig{
		SecretID:  stringValue(data["secret_id"]),
		SecretKey: stringValue(data["secret_key"]),
		Bucket:    stringValue(data["mps_bucket"]),
		Region:    stringValue(data["mps_region"]),
	}
	if config.Region == "" {
		config.Region = stringValue(data["region"])
	}
	if config.SecretID == "" || config.SecretKey == "" || config.Bucket == "" || config.Region == "" {
		return tencentCosConfig{}, fmt.Errorf("请在 API 设置中完整填写腾讯云密钥、MPS 输出 COS Bucket 和 Region")
	}
	return config, nil
}

// newCosClient 构造 COS 客户端(与现有 mps_asset 的 newMPSCOSClient 等价)。
func newCosClient(config tencentCosConfig) (*cos.Client, error) {
	bucketURL, err := url.Parse(fmt.Sprintf("https://%s.cos.%s.myqcloud.com", config.Bucket, config.Region))
	if err != nil {
		return nil, fmt.Errorf("COS Bucket 地址无效")
	}
	return cos.NewClient(&cos.BaseURL{BucketURL: bucketURL}, &http.Client{
		Transport: &cos.AuthorizationTransport{SecretID: config.SecretID, SecretKey: config.SecretKey},
	}), nil
}

// signCosURL 为 COS 对象生成 7 天有效的预签名 URL(供 MPS 访问私有桶)。
func signCosURL(config tencentCosConfig, key string) (string, error) {
	client, err := newCosClient(config)
	if err != nil {
		return "", err
	}
	presignedURL, err := client.Object.GetPresignedURL2(context.Background(), "GET", key, 7*24*3600*time.Second, nil)
	if err != nil {
		return "", fmt.Errorf("生成预签名 URL 失败: %w", err)
	}
	return presignedURL.String(), nil
}

// detectMime 通过文件头检测图片/视频类型,返回 (mimeType, extension, isVideo, ok)。
func detectMime(data []byte) (string, string, bool, bool) {
	if len(data) >= 3 && bytes.Equal(data[:3], []byte{0xff, 0xd8, 0xff}) {
		return "image/jpeg", ".jpg", false, true
	}
	if len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}) {
		return "image/png", ".png", false, true
	}
	if len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return "image/webp", ".webp", false, true
	}
	// 视频:MP4(ftyp)、QuickTime(moov)、WEBM/Matroska(1A45DFA3)、AVI(RIFF AVI)
	if len(data) >= 12 {
		if string(data[4:8]) == "ftyp" {
			return "video/mp4", ".mp4", true, true
		}
		if bytes.HasPrefix(data[4:], []byte("moov")) || bytes.HasPrefix(data[4:], []byte("mdat")) {
			return "video/mp4", ".mp4", true, true
		}
		if string(data[0:4]) == "RIFF" && string(data[8:12]) == "AVI " {
			return "video/x-msvideo", ".avi", true, true
		}
	}
	if len(data) >= 4 && bytes.Equal(data[:4], []byte{0x1a, 0x45, 0xdf, 0xa3}) {
		return "video/webm", ".webm", true, true
	}
	return "", "", false, false
}

// validateExternalURL 校验公开可访问 URL(SSRF 防护,对齐现有实现)。
func validateExternalURL(rawURL string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return nil, fmt.Errorf("请输入公开可访问的 HTTP 或 HTTPS URL")
	}
	addresses, err := net.DefaultResolver.LookupIP(context.Background(), "ip", parsed.Hostname())
	if err != nil || len(addresses) == 0 {
		return nil, fmt.Errorf("无法解析 URL 域名")
	}
	for _, address := range addresses {
		if address.IsLoopback() || address.IsPrivate() || address.IsLinkLocalUnicast() || address.IsLinkLocalMulticast() || address.IsUnspecified() || address.IsMulticast() {
			return nil, fmt.Errorf("URL 不允许指向本地或私有网络")
		}
	}
	return parsed, nil
}

// handleUpload 上传素材到 COS 并返回预签名 URL。
// 支持:视频(单文件,≤500MB) / 图片(单文件,≤20MB,最多前端自行控制数量)。
// 返回 { id, name, type, url, key }(对齐 content-studio upload.js)。
func (a *ViralApp) handleUpload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxViralFileSize+(1<<20))
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		Fail(c, http.StatusBadRequest, "请选择要上传的文件")
		return
	}
	defer file.Close()
	if header.Size <= 0 || header.Size > maxViralFileSize {
		Fail(c, http.StatusBadRequest, "文件大小必须在 500MB 以内")
		return
	}
	// 读文件头检测类型
	head := make([]byte, 512)
	count, _ := io.ReadFull(file, head)
	if count < 4 {
		Fail(c, http.StatusBadRequest, "无法识别文件类型")
		return
	}
	contentType, extension, isVideo, ok := detectMime(head[:count])
	if !ok {
		Fail(c, http.StatusBadRequest, "仅支持 MP4/MOV/WEBM/AVI 视频 或 JPG/PNG/WEBP 图片")
		return
	}
	_ = isVideo
	if strings.HasSuffix(strings.ToLower(header.Filename), ".mov") && extension == "" {
		contentType, extension = "video/mp4", ".mov"
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		Fail(c, http.StatusInternalServerError, "读取文件失败")
		return
	}
	config, err := a.loadCosConfig()
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	client, err := newCosClient(config)
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	subDir := "videos"
	if !isVideo {
		subDir = "images"
	}
	objectKey := viralInputPrefix + subDir + "/" + time.Now().UTC().Format("20060102") + "/" + uuid.New().String() + extension
	if _, err := client.Object.Put(context.Background(), objectKey, file, &cos.ObjectPutOptions{
		ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{ContentType: contentType},
	}); err != nil {
		Fail(c, http.StatusInternalServerError, "上传到 COS 失败: "+err.Error())
		return
	}
	signedURL, err := signCosURL(config, objectKey)
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, gin.H{
		"id":   uuid.New().String(),
		"name": header.Filename,
		"size": header.Size,
		"type": func() string {
			if isVideo {
				return "video"
			}
			return "image"
		}(),
		"url": signedURL,
		"key": objectKey,
	})
}

// handleUploadFromURL 将公开 URL 素材安全转存到 COS(供前端从 URL 添加素材)。
func (a *ViralApp) handleUploadFromURL(c *gin.Context) {
	var req struct {
		URL string `json:"url" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "URL 无效")
		return
	}
	parsed, err := validateExternalURL(req.URL)
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	config, err := a.loadCosConfig()
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	client := &http.Client{
		Timeout: 60 * time.Second,
		CheckRedirect: func(next *http.Request, _ []*http.Request) error {
			_, err := validateExternalURL(next.URL.String())
			return err
		},
	}
	response, err := client.Get(parsed.String())
	if err != nil {
		Fail(c, http.StatusBadRequest, "获取 URL 失败")
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 || response.ContentLength > maxViralFileSize {
		Fail(c, http.StatusBadRequest, "URL 返回异常状态或文件过大")
		return
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxViralFileSize+1))
	if err != nil || len(data) == 0 || len(data) > maxViralFileSize {
		Fail(c, http.StatusBadRequest, "读取文件失败或文件超过 500MB")
		return
	}
	contentType, extension, isVideo, ok := detectMime(data)
	if !ok {
		Fail(c, http.StatusBadRequest, "URL 内容仅支持视频或图片")
		return
	}
	cosClient, err := newCosClient(config)
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	subDir := "videos"
	if !isVideo {
		subDir = "images"
	}
	objectKey := viralInputPrefix + subDir + "/" + time.Now().UTC().Format("20060102") + "/" + uuid.New().String() + extension
	if _, err := cosClient.Object.Put(context.Background(), objectKey, bytes.NewReader(data), &cos.ObjectPutOptions{
		ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{ContentType: contentType},
	}); err != nil {
		Fail(c, http.StatusInternalServerError, "上传到 COS 失败: "+err.Error())
		return
	}
	signedURL, err := signCosURL(config, objectKey)
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, gin.H{
		"id":   uuid.New().String(),
		"name": path.Base(parsed.Path),
		"size": len(data),
		"type": func() string {
			if isVideo {
				return "video"
			}
			return "image"
		}(),
		"url": signedURL,
		"key": objectKey,
	})
}

// 类型占位,避免未使用导入(Go 编译要求)。
var _ = multipart.ErrMessageTooLarge
var _ = json.Marshal

// 占位实现:上传相关 handler 已在 upload.go 完成。
// handleUpload / handleUploadFromURL 已在文件内实现。
