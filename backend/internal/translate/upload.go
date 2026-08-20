package translate

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/tencentyun/cos-go-sdk-v5"
)

// 视频译制源视频上传：单视频，≤500MB。
// 对齐现有 handler/mps_asset.go 与 viral/upload.go 的 COS 客户端与安全校验，但不复用其内部函数（保持包独立）。

const (
	translateInputPrefix = "txstudio-translate/library/"
	maxVideoFileSize     = 500 << 20 // 500MB(视频)
)

// tencentCosConfig 译制任务所需的腾讯云凭证(仅 COS 上传用)。
type tencentCosConfig struct {
	SecretID  string
	SecretKey string
	Bucket    string
	Region    string
}

// loadCosConfig 从加密凭证读取 COS 上传配置。
func (a *TranslateApp) loadCosConfig() (tencentCosConfig, error) {
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

// signCosURL 为 COS 对象生成 7 天有效的预签名 URL(供 MPS 访问私有桶与前端播放)。
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

// detectVideoMime 通过文件头检测视频类型,返回 (mimeType, extension, ok)。
func detectVideoMime(data []byte) (string, string, bool) {
	// MP4(ftyp)、QuickTime(moov/mdat)、WEBM/Matroska(1A45DFA3)、AVI(RIFF AVI)
	if len(data) >= 12 {
		if string(data[4:8]) == "ftyp" {
			return "video/mp4", ".mp4", true
		}
		if bytes.HasPrefix(data[4:], []byte("moov")) || bytes.HasPrefix(data[4:], []byte("mdat")) {
			return "video/mp4", ".mp4", true
		}
		if string(data[0:4]) == "RIFF" && string(data[8:12]) == "AVI " {
			return "video/x-msvideo", ".avi", true
		}
	}
	if len(data) >= 4 && bytes.Equal(data[:4], []byte{0x1a, 0x45, 0xdf, 0xa3}) {
		return "video/webm", ".webm", true
	}
	return "", "", false
}

// handleUpload 上传源视频到 COS 并返回预签名 URL。
// 返回 { id, name, size, type, url, key }(对齐 content-studio upload.js)。
func (a *TranslateApp) handleUpload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxVideoFileSize+(1<<20))
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		Fail(c, http.StatusBadRequest, "请选择要上传的文件")
		return
	}
	defer file.Close()
	if header.Size <= 0 || header.Size > maxVideoFileSize {
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
	contentType, extension, ok := detectVideoMime(head[:count])
	if !ok {
		Fail(c, http.StatusBadRequest, "仅支持 MP4/MOV/WEBM/AVI 视频")
		return
	}
	if strings.HasSuffix(strings.ToLower(header.Filename), ".mov") {
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
	objectKey := translateInputPrefix + "videos/" + time.Now().UTC().Format("20060102") + "/" + uuid.New().String() + extension
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
		"type": "video",
		"url":  signedURL,
		"key":  objectKey,
	})
}
