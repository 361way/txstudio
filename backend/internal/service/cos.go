package service

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/tencentyun/cos-go-sdk-v5"
)

// COSService 腾讯云 COS 资产存储服务
type COSService struct {
	client     *cos.Client
	secretID   string
	secretKey  string
	prefix     string
	presignTTL time.Duration
}

// NewCOSService 创建 COS 服务
func NewCOSService(secretID, secretKey, region, bucket, prefix string, presignTTL time.Duration) (*COSService, error) {
	if secretID == "" || secretKey == "" || bucket == "" {
		return nil, fmt.Errorf("COS 配置不完整")
	}
	bucketURL, err := cos.NewBucketURL(bucket, region, true)
	if err != nil {
		return nil, fmt.Errorf("解析 Bucket URL 失败: %w", err)
	}
	client := cos.NewClient(&cos.BaseURL{BucketURL: bucketURL}, &http.Client{
		Transport: &cos.AuthorizationTransport{
			SecretID:  secretID,
			SecretKey: secretKey,
		},
	})
	return &COSService{client: client, secretID: secretID, secretKey: secretKey, prefix: prefix, presignTTL: presignTTL}, nil
}

// PresignUploadURL 为指定租户生成临时上传 URL
// key 格式: {prefix}/{tenantId}/{filename}
func (s *COSService) PresignUploadURL(tenantID uint, filename, contentType string) (string, string, error) {
	key := fmt.Sprintf("%s/%d/%s", s.prefix, tenantID, filename)
	ctx := context.Background()
	presignedURL, err := s.client.Object.GetPresignedURL(ctx, http.MethodPut, key,
		s.secretID, s.secretKey, s.presignTTL, nil)
	if err != nil {
		return "", "", fmt.Errorf("生成上传 URL 失败: %w", err)
	}
	return presignedURL.String(), key, nil
}

// ObjectURL 返回对象的公共访问 URL（需桶公开读或通过 CDN）
func (s *COSService) ObjectURL(key string) string {
	return s.client.Object.GetObjectURL(key).String()
}
