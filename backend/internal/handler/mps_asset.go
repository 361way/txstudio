package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"cnb.cool/txcloud/txstudio/backend/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/tencentyun/cos-go-sdk-v5"
	"gorm.io/gorm"
)

const (
	mpsInputPrefix  = "mps-saas/input/"
	maxMPSImageSize = 20 << 20
)

type MPSAssetHandler struct {
	DB     *gorm.DB
	Crypto *service.CryptoService
}

type tencentCloudConfig struct {
	SecretID  string
	SecretKey string
	Bucket    string
	Region    string
}

type uploadFromURLReq struct {
	URL string `json:"url" binding:"required"`
}

// Output 通过本地服务读取 MPS 写入配置 COS Bucket 的处理结果，
// 使私有 Bucket 的 Output.Path 也能作为浏览器可访问地址使用。
func (h *MPSAssetHandler) Output(c *gin.Context) {
	objectKey, err := mpsOutputObjectKey(c.Query("path"))
	if err != nil {
		BadRequest(c, err.Error())
		return
	}
	config, err := h.loadConfig()
	if err != nil {
		BadRequest(c, err.Error())
		return
	}
	client, err := newMPSCOSClient(config)
	if err != nil {
		InternalError(c, err.Error())
		return
	}
	response, err := client.Object.Get(c.Request.Context(), objectKey, nil)
	if err != nil {
		InternalError(c, "读取 MPS 输出结果失败")
		return
	}
	defer response.Body.Close()
	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		c.Header("Content-Type", contentType)
	}
	if contentLength := response.Header.Get("Content-Length"); contentLength != "" {
		c.Header("Content-Length", contentLength)
	}
	c.Header("Cache-Control", "private, max-age=600")
	c.Status(http.StatusOK)
	if _, err := io.Copy(c.Writer, response.Body); err != nil {
		log.Printf("[mps] 输出结果传输失败: %v", err)
	}
}

// Upload 将本地图片安全上传到配置的 COS Bucket，作为 MPS ProcessImage 的 COS 输入。
func (h *MPSAssetHandler) Upload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxMPSImageSize+(1<<20))
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		BadRequest(c, "请选择要上传的图片")
		return
	}
	defer file.Close()
	if header.Size <= 0 || header.Size > maxMPSImageSize {
		BadRequest(c, "图片大小必须在 20MB 以内")
		return
	}

	contentType, extension, err := inspectMPSImage(file, header)
	if err != nil {
		BadRequest(c, err.Error())
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		InternalError(c, "读取上传图片失败")
		return
	}
	config, err := h.loadConfig()
	if err != nil {
		BadRequest(c, err.Error())
		return
	}
	object, err := uploadMPSObject(config, file, contentType, extension)
	if err != nil {
		InternalError(c, err.Error())
		return
	}
	OK(c, gin.H{"bucket": config.Bucket, "region": config.Region, "object": object})
}

// UploadFromURL 将公开图片先安全转存到 COS，避免将任意 URL 直接交给 MPS。
func (h *MPSAssetHandler) UploadFromURL(c *gin.Context) {
	var req uploadFromURLReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "图片 URL 无效")
		return
	}
	parsed, err := validateExternalImageURL(req.URL)
	if err != nil {
		BadRequest(c, err.Error())
		return
	}
	config, err := h.loadConfig()
	if err != nil {
		BadRequest(c, err.Error())
		return
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(next *http.Request, _ []*http.Request) error {
			_, err := validateExternalImageURL(next.URL.String())
			return err
		},
	}
	response, err := client.Get(parsed.String())
	if err != nil {
		BadRequest(c, "获取图片 URL 失败")
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 || response.ContentLength > maxMPSImageSize {
		BadRequest(c, "图片 URL 返回异常状态或文件超过 20MB")
		return
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxMPSImageSize+1))
	if err != nil || len(data) == 0 || len(data) > maxMPSImageSize {
		BadRequest(c, "读取图片失败或图片超过 20MB")
		return
	}
	contentType, extension, ok := detectMPSImage(data)
	if !ok {
		BadRequest(c, "URL 仅支持 JPG、PNG、WEBP 图片")
		return
	}
	object, err := uploadMPSObject(config, bytes.NewReader(data), contentType, extension)
	if err != nil {
		InternalError(c, err.Error())
		return
	}
	OK(c, gin.H{"bucket": config.Bucket, "region": config.Region, "object": object})
}

func (h *MPSAssetHandler) loadConfig() (tencentCloudConfig, error) {
	var credential model.Credential
	if err := h.DB.Where("provider = ?", "tencent-cloud").First(&credential).Error; err != nil {
		return tencentCloudConfig{}, fmt.Errorf("未配置腾讯云媒体服务凭证，请在右上角 API 设置中配置")
	}
	plaintext, err := h.Crypto.Decrypt(credential.EncryptedData)
	if err != nil {
		return tencentCloudConfig{}, fmt.Errorf("腾讯云凭证解密失败")
	}
	var data map[string]interface{}
	if err := json.Unmarshal(plaintext, &data); err != nil {
		return tencentCloudConfig{}, fmt.Errorf("腾讯云凭证格式错误")
	}
	config := tencentCloudConfig{
		SecretID:  stringValue(data["secret_id"]),
		SecretKey: stringValue(data["secret_key"]),
		Bucket:    stringValue(data["mps_bucket"]),
		Region:    stringValue(data["mps_region"]),
	}
	if config.Region == "" {
		config.Region = stringValue(data["region"])
	}
	if config.SecretID == "" || config.SecretKey == "" || config.Bucket == "" || config.Region == "" {
		return tencentCloudConfig{}, fmt.Errorf("请在 API 设置中完整填写腾讯云密钥、MPS 输出 COS Bucket 和 Region")
	}
	return config, nil
}

func newMPSCOSClient(config tencentCloudConfig) (*cos.Client, error) {
	bucketURL, err := url.Parse(fmt.Sprintf("https://%s.cos.%s.myqcloud.com", config.Bucket, config.Region))
	if err != nil {
		return nil, fmt.Errorf("COS Bucket 地址无效")
	}
	return cos.NewClient(&cos.BaseURL{BucketURL: bucketURL}, &http.Client{
		Transport: &cos.AuthorizationTransport{SecretID: config.SecretID, SecretKey: config.SecretKey},
	}), nil
}

func mpsOutputObjectKey(rawPath string) (string, error) {
	objectKey := strings.TrimSpace(rawPath)
	objectKey = strings.TrimPrefix(objectKey, "/")
	if objectKey == "" || len(objectKey) > 2048 || strings.Contains(objectKey, "\\") || strings.ContainsRune(objectKey, '\x00') {
		return "", fmt.Errorf("MPS 输出路径无效")
	}
	for _, segment := range strings.Split(objectKey, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return "", fmt.Errorf("MPS 输出路径无效")
		}
	}
	return objectKey, nil
}

func uploadMPSObject(config tencentCloudConfig, body io.Reader, contentType, extension string) (string, error) {
	client, err := newMPSCOSClient(config)
	if err != nil {
		return "", err
	}
	objectKey := mpsInputPrefix + time.Now().UTC().Format("20060102") + "/" + uuid.New().String() + extension
	options := &cos.ObjectPutOptions{ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{ContentType: contentType}}
	if _, err := client.Object.Put(context.Background(), objectKey, body, options); err != nil {
		return "", fmt.Errorf("上传图片到 COS 失败: %w", err)
	}
	return "/" + objectKey, nil
}

func inspectMPSImage(file multipart.File, header *multipart.FileHeader) (string, string, error) {
	buffer := make([]byte, 512)
	count, err := file.Read(buffer)
	if err != nil && err != io.EOF {
		return "", "", fmt.Errorf("读取图片失败")
	}
	contentType, extension, ok := detectMPSImage(buffer[:count])
	if !ok {
		return "", "", fmt.Errorf("仅支持 JPG、PNG、WEBP 图片")
	}
	if suffix := strings.ToLower(path.Ext(header.Filename)); suffix != "" && suffix != extension && !(suffix == ".jpeg" && extension == ".jpg") {
		return "", "", fmt.Errorf("图片扩展名与内容不匹配")
	}
	return contentType, extension, nil
}

func detectMPSImage(data []byte) (string, string, bool) {
	if len(data) >= 3 && bytes.Equal(data[:3], []byte{0xff, 0xd8, 0xff}) {
		return "image/jpeg", ".jpg", true
	}
	if len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}) {
		return "image/png", ".png", true
	}
	if len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return "image/webp", ".webp", true
	}
	return "", "", false
}

func validateExternalImageURL(rawURL string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return nil, fmt.Errorf("请输入公开可访问的 HTTP 或 HTTPS 图片 URL")
	}
	addresses, err := net.DefaultResolver.LookupIP(context.Background(), "ip", parsed.Hostname())
	if err != nil || len(addresses) == 0 {
		return nil, fmt.Errorf("无法解析图片 URL 域名")
	}
	for _, address := range addresses {
		if isPrivateAddress(address) {
			return nil, fmt.Errorf("图片 URL 不允许指向本地或私有网络")
		}
	}
	return parsed, nil
}

func isPrivateAddress(address net.IP) bool {
	if address.IsLoopback() || address.IsPrivate() || address.IsLinkLocalUnicast() || address.IsLinkLocalMulticast() || address.IsUnspecified() || address.IsMulticast() {
		return true
	}
	if ipv4 := address.To4(); ipv4 != nil {
		switch ipv4[0] {
		case 9, 10, 11, 21, 30:
			return true
		}
	}
	return false
}

func stringValue(value interface{}) string {
	return strings.TrimSpace(fmt.Sprint(value))
}
