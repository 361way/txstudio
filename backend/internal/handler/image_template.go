package handler

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var templateSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

var allowedTemplateAccents = map[string]bool{
	"amber": true, "slate": true, "rose": true, "violet": true,
	"cyan": true, "emerald": true, "red": true, "indigo": true,
}

type ImageTemplateHandler struct {
	DB *gorm.DB
}

type imageTemplateRequest struct {
	Name          string `json:"name" binding:"required"`
	Category      string `json:"category" binding:"required"`
	Description   string `json:"description"`
	Prompt        string `json:"prompt" binding:"required"`
	ModelName     string `json:"model_name" binding:"required"`
	ModelVersion  string `json:"model_version" binding:"required"`
	Ratio         string `json:"ratio"`
	Resolution    string `json:"resolution"`
	EnhancePrompt string `json:"enhance_prompt"`
	StorageMode   string `json:"storage_mode"`
	Accent        string `json:"accent"`
	CoverURL      string `json:"cover_url"`
}

func trimTemplateField(value string, max int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > max {
		return string(runes[:max])
	}
	return value
}

func validTemplateCoverURL(value string) bool {
	if value == "" || strings.HasPrefix(value, "/file/") || strings.HasPrefix(value, "/api/cache/") {
		return true
	}
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil
}

func normalizeTemplateRequest(req imageTemplateRequest) (model.ImageTemplate, string) {
	template := model.ImageTemplate{
		Name: trimTemplateField(req.Name, 120), Category: strings.ToLower(trimTemplateField(req.Category, 64)),
		Description: trimTemplateField(req.Description, 500), Prompt: trimTemplateField(req.Prompt, 20000),
		ModelName: trimTemplateField(req.ModelName, 128), ModelVersion: trimTemplateField(req.ModelVersion, 128),
		Ratio: trimTemplateField(req.Ratio, 32), Resolution: trimTemplateField(req.Resolution, 32),
		EnhancePrompt: trimTemplateField(req.EnhancePrompt, 16), StorageMode: trimTemplateField(req.StorageMode, 16),
		Accent: strings.ToLower(trimTemplateField(req.Accent, 32)), CoverURL: trimTemplateField(req.CoverURL, 2048),
	}
	if template.Name == "" || template.Prompt == "" || template.ModelName == "" || template.ModelVersion == "" {
		return template, "名称、提示词、模型和版本不能为空"
	}
	if !templateSlugPattern.MatchString(template.Category) {
		return template, "模板分类格式无效"
	}
	if template.EnhancePrompt == "" {
		template.EnhancePrompt = "Enabled"
	}
	if template.EnhancePrompt != "Enabled" && template.EnhancePrompt != "Disabled" {
		return template, "提示词增强配置无效"
	}
	if template.StorageMode == "" {
		template.StorageMode = "Temporary"
	}
	if template.StorageMode != "Temporary" && template.StorageMode != "Permanent" {
		return template, "存储模式配置无效"
	}
	if template.Accent == "" {
		template.Accent = "amber"
	}
	if !allowedTemplateAccents[template.Accent] {
		return template, "模板主题配置无效"
	}
	if !validTemplateCoverURL(template.CoverURL) {
		return template, "封面仅支持 HTTPS 或本地缓存路径"
	}
	return template, ""
}

func parseTemplateID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		BadRequest(c, "模板 ID 无效")
		return 0, false
	}
	return uint(id), true
}

func (h *ImageTemplateHandler) List(c *gin.Context) {
	var templates []model.ImageTemplate
	if err := h.DB.Order("updated_at DESC, id DESC").Find(&templates).Error; err != nil {
		InternalError(c, "读取自定义模板失败")
		return
	}
	OK(c, templates)
}

func (h *ImageTemplateHandler) Create(c *gin.Context) {
	var req imageTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "模板配置格式无效")
		return
	}
	template, message := normalizeTemplateRequest(req)
	if message != "" {
		BadRequest(c, message)
		return
	}
	if err := h.DB.Create(&template).Error; err != nil {
		InternalError(c, "创建自定义模板失败")
		return
	}
	Created(c, template)
}

func (h *ImageTemplateHandler) Update(c *gin.Context) {
	id, ok := parseTemplateID(c)
	if !ok {
		return
	}
	var existing model.ImageTemplate
	if err := h.DB.First(&existing, id).Error; err != nil {
		NotFound(c, "自定义模板不存在")
		return
	}
	var req imageTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "模板配置格式无效")
		return
	}
	next, message := normalizeTemplateRequest(req)
	if message != "" {
		BadRequest(c, message)
		return
	}
	updates := map[string]any{
		"name": next.Name, "category": next.Category, "description": next.Description,
		"prompt": next.Prompt, "model_name": next.ModelName, "model_version": next.ModelVersion,
		"ratio": next.Ratio, "resolution": next.Resolution, "enhance_prompt": next.EnhancePrompt,
		"storage_mode": next.StorageMode, "accent": next.Accent, "cover_url": next.CoverURL,
	}
	if err := h.DB.Model(&existing).Updates(updates).Error; err != nil {
		InternalError(c, "更新自定义模板失败")
		return
	}
	if err := h.DB.First(&existing, id).Error; err != nil {
		InternalError(c, "读取更新后的模板失败")
		return
	}
	OK(c, existing)
}

func (h *ImageTemplateHandler) Delete(c *gin.Context) {
	id, ok := parseTemplateID(c)
	if !ok {
		return
	}
	result := h.DB.Delete(&model.ImageTemplate{}, id)
	if result.Error != nil {
		InternalError(c, "删除自定义模板失败")
		return
	}
	if result.RowsAffected == 0 {
		NotFound(c, "自定义模板不存在")
		return
	}
	OK(c, gin.H{"deleted": id})
}
