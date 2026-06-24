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
	client    *cos.Client
	prefix    string
	presignTTL time.Duration
}

// NewCOSService 创建 COS 服务
func NewCOSService(secretID, secretKey, region, bucket, prefix string, presignTTL time.Duration) (*COSService, error) {
	if secretID == "" || secretKey == "" || bucket == "" {
		return nil, fmt.Errorf("COS 配置不完整")
	}
	bucketURL := fmt.Sprintf("https://%s.cos.%s.myqcloud.com", bucket, region)
	u, err := cos.NewClientURL(bucketURL, &http.Client{
		Transport: &cos.AuthorizationTransport{
			SecretID:  secretID,
			SecretKey: secretKey,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("创建 COS 客户端失败: %w", err)
	}
	return &COSService{client: u, prefix: prefix, presignTTL: presignTTL}, nil
}

// PresignUploadURL 为指定租户生成临时上传 URL
// key 格式: {prefix}/{tenantId}/{filename}
func (s *COSService) PresignUploadURL(tenantID uint, filename, contentType string) (string, string, error) {
	key := fmt.Sprintf("%s/%d/%s", s.prefix, tenantID, filename)
	ctx := context.Background()
	presignedURL, err := s.client.Object.GetPresignedURL(ctx, http.MethodPut, key,
		s.client.GetObjectURL("").Host, "", time.Now().Add(s.presignTTL), nil)
	if err != nil {
		return "", "", fmt.Errorf("生成上传 URL 失败: %w", err)
	}
	return presignedURL.String(), key, nil
}

// ObjectURL 返回对象的公共访问 URL（需桶公开读或通过 CDN）
func (s *COSService) ObjectURL(key string) string {
	return fmt.Sprintf("%s/%s", s.client.GetObjectURL("").Host, key)
}
