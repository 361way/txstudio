package handler

import (
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vodstudio/backend/internal/middleware"
	"github.com/vodstudio/backend/internal/model"
	"github.com/vodstudio/backend/internal/service"
	"gorm.io/gorm"
)

// AssetHandler 资产 handler
type AssetHandler struct {
	DB  *gorm.DB
	COS *service.COSService
}

type uploadURLReq struct {
	Filename    string `json:"filename" binding:"required"`
	ContentType string `json:"content_type"`
	ProjectID   uint   `json:"project_id"`
}

type registerAssetReq struct {
	COSKey    string `json:"cos_key" binding:"required"`
	Mime      string `json:"mime"`
	Size      int64  `json:"size"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	ProjectID uint   `json:"project_id"`
}

// UploadURL 获取 COS 临时上传 URL
func (h *AssetHandler) UploadURL(c *gin.Context) {
	var req uploadURLReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "filename 必填")
		return
	}
	tenantID := middleware.GetCurrentTenantID(c)

	if h.COS == nil {
		BadRequest(c, "COS 未配置，无法上传资产")
		return
	}

	presignedURL, cosKey, err := h.COS.PresignUploadURL(tenantID, req.Filename, req.ContentType)
	if err != nil {
		InternalError(c, "生成上传 URL 失败: "+err.Error())
		return
	}

	OK(c, gin.H{
		"upload_url": presignedURL,
		"cos_key":    cosKey,
		"method":     "PUT",
		"headers":    gin.H{"Content-Type": req.ContentType},
	})
}

// Register 登记资产元数据（上传完成后调用）
func (h *AssetHandler) Register(c *gin.Context) {
	var req registerAssetReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效")
		return
	}
	tenantID := middleware.GetCurrentTenantID(c)

	asset := model.Asset{
		TenantID:  tenantID,
		ProjectID: req.ProjectID,
		COSKey:    req.COSKey,
		Mime:      req.Mime,
		Size:      req.Size,
		Width:     req.Width,
		Height:    req.Height,
	}
	if err := h.DB.Create(&asset).Error; err != nil {
		InternalError(c, "登记资产失败")
		return
	}
	Created(c, asset)
}

// Get 获取资产访问 URL
func (h *AssetHandler) Get(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	tenantID := middleware.GetCurrentTenantID(c)

	var asset model.Asset
	if err := h.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&asset).Error; err != nil {
		NotFound(c, "资产不存在")
		return
	}

	url := fmt.Sprintf("%s/%s", h.COS.ObjectURL(""), asset.COSKey)
	OK(c, gin.H{"asset": asset, "url": url})
}
