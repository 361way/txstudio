package handler

import (
	"encoding/json"
	"strconv"
	"strings"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"cnb.cool/txcloud/txstudio/backend/internal/service"
	"github.com/gin-gonic/gin"
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

// List 全局凭证列表（不返回明文）
func (h *CredentialHandler) List(c *gin.Context) {
	var creds []model.Credential
	h.DB.Order("provider ASC").Find(&creds)

	views := make([]gin.H, 0, len(creds))
	for _, credential := range creds {
		view := gin.H{
			"id":         credential.ID,
			"provider":   credential.Provider,
			"has_data":   credential.EncryptedData != "",
			"created_at": credential.CreatedAt,
			"updated_at": credential.UpdatedAt,
		}
		// 只公开运行时所需的非敏感字段，Secret 永不返回浏览器。
		if plaintext, err := h.Crypto.Decrypt(credential.EncryptedData); err == nil {
			var data map[string]interface{}
			if json.Unmarshal(plaintext, &data) == nil {
				publicConfig := gin.H{}
				switch credential.Provider {
				case "tokenhub":
					publicConfig["base_url"] = data["base_url"]
				case "tencent-cloud":
					publicConfig["sub_app_id"] = data["sub_app_id"]
					publicConfig["region"] = data["region"]
					publicConfig["mps_bucket"] = data["mps_bucket"]
					publicConfig["mps_region"] = data["mps_region"]
				}
				view["config"] = publicConfig
			}
		}
		views = append(views, view)
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
	if req.Provider != "tencent-cloud" && req.Provider != "tokenhub" {
		BadRequest(c, "provider 只支持 tencent-cloud 或 tokenhub")
		return
	}

	// upsert：允许只更新 Bucket/Region 等非敏感配置，未提交的 Secret 保持不变。
	var existing model.Credential
	result := h.DB.Where("provider = ?", req.Provider).First(&existing)
	merged := map[string]interface{}{}
	if result.Error == nil {
		if plaintext, err := h.Crypto.Decrypt(existing.EncryptedData); err == nil {
			_ = json.Unmarshal(plaintext, &merged)
		}
	} else if result.Error != gorm.ErrRecordNotFound {
		InternalError(c, "读取凭证失败")
		return
	}
	for key, value := range req.Data {
		if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
			continue
		}
		merged[key] = value
	}
	if req.Provider == "tencent-cloud" {
		subAppID, err := parsePositiveUint64(merged["sub_app_id"])
		if err != nil {
			BadRequest(c, "SubAppId 必须是正整数")
			return
		}
		merged["sub_app_id"] = subAppID
	}
	plaintext, err := json.Marshal(merged)
	if err != nil {
		InternalError(c, "凭证序列化失败")
		return
	}
	encrypted, err := h.Crypto.Encrypt(plaintext)
	if err != nil {
		InternalError(c, "凭证加密失败")
		return
	}
	if result.Error == gorm.ErrRecordNotFound {
		credential := model.Credential{Provider: req.Provider, EncryptedData: encrypted}
		if err := h.DB.Create(&credential).Error; err != nil {
			InternalError(c, "保存凭证失败")
			return
		}
	} else if err := h.DB.Model(&existing).Update("encrypted_data", encrypted).Error; err != nil {
		InternalError(c, "更新凭证失败")
		return
	}

	OK(c, gin.H{"provider": req.Provider, "saved": true})
}

// Delete 删除凭证
func (h *CredentialHandler) Delete(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	result := h.DB.Delete(&model.Credential{}, id)
	if result.RowsAffected == 0 {
		NotFound(c, "凭证不存在")
		return
	}
	OK(c, gin.H{"deleted": true})
}

// DecryptForInternal 内部方法：解密指定 provider 的全局凭证。
func (h *CredentialHandler) DecryptForInternal(provider string) (map[string]interface{}, error) {
	var cred model.Credential
	if err := h.DB.Where("provider = ?", provider).First(&cred).Error; err != nil {
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
