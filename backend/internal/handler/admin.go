package handler

import (
	"encoding/json"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vodstudio/backend/internal/model"
	"gorm.io/gorm"
)

// AdminHandler 管理员相关 handler（跨租户）
type AdminHandler struct {
	DB *gorm.DB
}

// userView 用户列表视图（含租户名）
type userView struct {
	model.User
	TenantName string `json:"tenant_name"`
}

// ListUsers 列出所有用户（跨租户）
func (h *AdminHandler) ListUsers(c *gin.Context) {
	var users []model.User
	if err := h.DB.Find(&users).Error; err != nil {
		InternalError(c, "查询用户失败")
		return
	}
	views := make([]userView, 0, len(users))
	for _, u := range users {
		v := userView{User: u}
		var tenant model.Tenant
		if err := h.DB.First(&tenant, u.TenantID).Error; err == nil {
			v.TenantName = tenant.Name
		}
		views = append(views, v)
	}
	OK(c, views)
}

type setQuotaReq struct {
	Quotas map[string]int `json:"quotas"`
}

// SetUserQuota 设置用户配额覆盖
func (h *AdminHandler) SetUserQuota(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var req setQuotaReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效")
		return
	}
	// 序列化为 JSON 存储（与 Plan.Quotas 同结构）
	quotaJSON, _ := json.Marshal(req.Quotas)

	var override model.UserQuotaOverride
	result := h.DB.Where("user_id = ?", id).First(&override)
	if result.Error == gorm.ErrRecordNotFound {
		override = model.UserQuotaOverride{UserID: uint(id), Quotas: string(quotaJSON)}
		if err := h.DB.Create(&override).Error; err != nil {
			InternalError(c, "创建配额失败")
			return
		}
	} else if result.Error == nil {
		override.Quotas = string(quotaJSON)
		if err := h.DB.Save(&override).Error; err != nil {
			InternalError(c, "更新配额失败")
			return
		}
	} else {
		InternalError(c, "查询配额失败")
		return
	}
	OK(c, gin.H{"user_id": id, "quotas": req.Quotas})
}

type setStatusReq struct {
	Status string `json:"status" binding:"required"`
}

// SetUserStatus 启用/禁用用户
func (h *AdminHandler) SetUserStatus(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var req setStatusReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效")
		return
	}
	if req.Status != "active" && req.Status != "suspended" {
		BadRequest(c, "status 只能是 active 或 suspended")
		return
	}
	if err := h.DB.Model(&model.User{}).Where("id = ?", id).Update("status", req.Status).Error; err != nil {
		InternalError(c, "更新状态失败")
		return
	}
	OK(c, gin.H{"user_id": id, "status": req.Status})
}

// ==================== 模板管理 ====================

// ListTemplatesAdmin 管理员列出所有模板（含已归档）
func (h *AdminHandler) ListTemplatesAdmin(c *gin.Context) {
	var templates []model.Template
	if err := h.DB.Find(&templates).Error; err != nil {
		InternalError(c, "查询模板失败")
		return
	}
	OK(c, templates)
}

type templateReq struct {
	Name          string `json:"name" binding:"required"`
	Category      string `json:"category"`
	Type          string `json:"type" binding:"required"`
	Prompt        string `json:"prompt"`
	ModelName     string `json:"model_name"`
	ModelVersion  string `json:"model_version"`
	Ratio         string `json:"ratio"`
	RefImageCount int    `json:"ref_image_count"`
	Description   string `json:"description"`
	Status        string `json:"status"`
}

// CreateTemplate 创建模板（全局，tenant_id 为 nil）
func (h *AdminHandler) CreateTemplate(c *gin.Context) {
	var req templateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效")
		return
	}
	tpl := model.Template{
		Name: req.Name, Category: req.Category, Type: req.Type,
		Prompt: req.Prompt, ModelName: req.ModelName, ModelVersion: req.ModelVersion,
		Ratio: req.Ratio, RefImageCount: req.RefImageCount, Description: req.Description,
		Status: "active",
	}
	if req.Status != "" {
		tpl.Status = req.Status
	}
	if err := h.DB.Create(&tpl).Error; err != nil {
		InternalError(c, "创建模板失败")
		return
	}
	Created(c, tpl)
}

// UpdateTemplate 更新模板
func (h *AdminHandler) UpdateTemplate(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var req templateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效")
		return
	}
	var tpl model.Template
	if err := h.DB.First(&tpl, id).Error; err != nil {
		NotFound(c, "模板不存在")
		return
	}
	tpl.Name = req.Name
	tpl.Category = req.Category
	tpl.Type = req.Type
	tpl.Prompt = req.Prompt
	tpl.ModelName = req.ModelName
	tpl.ModelVersion = req.ModelVersion
	tpl.Ratio = req.Ratio
	tpl.RefImageCount = req.RefImageCount
	tpl.Description = req.Description
	if req.Status != "" {
		tpl.Status = req.Status
	}
	if err := h.DB.Save(&tpl).Error; err != nil {
		InternalError(c, "更新模板失败")
		return
	}
	OK(c, tpl)
}

// DeleteTemplate 删除模板
func (h *AdminHandler) DeleteTemplate(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	if err := h.DB.Delete(&model.Template{}, id).Error; err != nil {
		InternalError(c, "删除模板失败")
		return
	}
	OK(c, gin.H{"deleted": true})
}
