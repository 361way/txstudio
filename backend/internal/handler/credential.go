package handler

import (
	"encoding/json"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vodstudio/backend/internal/middleware"
	"github.com/vodstudio/backend/internal/model"
	"github.com/vodstudio/backend/internal/service"
	"gorm.io/gorm"
)

// CredentialHandler 凭证管理 handler
type CredentialHandler struct {
	DB     *gorm.DB
	Crypto *service.CryptoService
}

type saveCredentialReq struct {
	Provider string                 `json:"provider" binding:"required"` // vod | tokenhub
	Data     map[string]interface{} `json:"data" binding:"required"`     // 明文凭证 JSON
}

// List 当前租户的凭证列表（不返回明文）
func (h *CredentialHandler) List(c *gin.Context) {
	tenantID := middleware.GetCurrentTenantID(c)
	var creds []model.Credential
	h.DB.Where("tenant_id = ?", tenantID).Find(&creds)

	type credView struct {
		ID        uint   `json:"id"`
		Provider  string `json:"provider"`
		HasData   bool   `json:"has_data"`
		CreatedAt string `json:"created_at"`
		UpdatedAt string `json:"updated_at"`
	}
	var views []credView
	for _, cr := range creds {
		views = append(views, credView{
			ID: cr.ID, Provider: cr.Provider, HasData: cr.EncryptedData != "",
			CreatedAt: cr.CreatedAt.Format("2006-01-02 15:04:05"),
			UpdatedAt: cr.UpdatedAt.Format("2006-01-02 15:04:05"),
		})
	}
	OK(c, views)
}

// Save 保存/更新凭证（AES-GCM 加密入库）
func (h *CredentialHandler) Save(c *gin.Context) {
	var req saveCredentialReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效: "+err.Error())
		return
	}
	if req.Provider != "vod" && req.Provider != "tokenhub" {
		BadRequest(c, "provider 只支持 vod 或 tokenhub")
		return
	}

	tenantID := middleware.GetCurrentTenantID(c)

	// 序列化明文 → 加密
	plaintext, err := json.Marshal(req.Data)
	if err != nil {
		InternalError(c, "凭证序列化失败")
		return
	}
	encrypted, err := h.Crypto.Encrypt(plaintext)
	if err != nil {
		InternalError(c, "凭证加密失败")
		return
	}

	// upsert：同租户同 provider 只保留一条
	var existing model.Credential
	result := h.DB.Where("tenant_id = ? AND provider = ?", tenantID, req.Provider).First(&existing)
	if result.Error == gorm.ErrRecordNotFound {
		cred := model.Credential{
			TenantID:      tenantID,
			Provider:      req.Provider,
			EncryptedData: encrypted,
		}
		if err := h.DB.Create(&cred).Error; err != nil {
			InternalError(c, "保存凭证失败")
			return
		}
	} else if result.Error == nil {
		h.DB.Model(&existing).Update("encrypted_data", encrypted)
	}

	OK(c, gin.H{"provider": req.Provider, "saved": true})
}

// Delete 删除凭证
func (h *CredentialHandler) Delete(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	tenantID := middleware.GetCurrentTenantID(c)

	result := h.DB.Where("id = ? AND tenant_id = ?", id, tenantID).Delete(&model.Credential{})
	if result.RowsAffected == 0 {
		NotFound(c, "凭证不存在")
		return
	}
	OK(c, gin.H{"deleted": true})
}

// DecryptForInternal 内部方法：解密指定租户的凭证（供代理 handler 使用）
func (h *CredentialHandler) DecryptForInternal(tenantID uint, provider string) (map[string]interface{}, error) {
	var cred model.Credential
	if err := h.DB.Where("tenant_id = ? AND provider = ?", tenantID, provider).First(&cred).Error; err != nil {
		return nil, err
	}
	plaintext, err := h.Crypto.Decrypt(cred.EncryptedData)
	if err != nil {
		return nil, err
	}
	var m map[string]interface{}
	if err := json.Unmarshal(plaintext, &m); err != nil {
		return nil, err
	}
	return m, nil
}
