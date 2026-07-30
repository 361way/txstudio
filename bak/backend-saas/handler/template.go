package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vodstudio/backend/internal/model"
	"gorm.io/gorm"
)

// TemplateHandler 模板公共读取 handler（普通用户可见 active 模板）
type TemplateHandler struct {
	DB *gorm.DB
}

// List 列出活跃模板，可选按 category 过滤
func (h *TemplateHandler) List(c *gin.Context) {
	q := h.DB.Where("status = ?", "active")
	if cat := c.Query("category"); cat != "" {
		q = q.Where("category = ?", cat)
	}
	if t := c.Query("type"); t != "" {
		q = q.Where("type = ?", t)
	}
	var templates []model.Template
	if err := q.Find(&templates).Error; err != nil {
		InternalError(c, "查询模板失败")
		return
	}
	OK(c, templates)
}

// Get 单个模板详情
func (h *TemplateHandler) Get(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var tpl model.Template
	if err := h.DB.First(&tpl, id).Error; err != nil {
		NotFound(c, "模板不存在")
		return
	}
	OK(c, tpl)
}
