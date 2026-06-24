package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vodstudio/backend/internal/middleware"
	"github.com/vodstudio/backend/internal/model"
	"gorm.io/gorm"
)

// ProjectHandler 项目/画布 handler
type ProjectHandler struct {
	DB *gorm.DB
}

type createProjectReq struct {
	Name string `json:"name" binding:"required"`
}

type updateProjectReq struct {
	Name      *string `json:"name"`
	CoverURL  *string `json:"cover_url"`
	Status    *string `json:"status"`
}

type saveCanvasReq struct {
	Data string `json:"data" binding:"required"` // JSON 字符串: {nodes, connections, ...}
}

type createHistoryReq struct {
	Type      string `json:"type" binding:"required"`
	URL       string `json:"url"`
	Prompt    string `json:"prompt"`
	ModelName string `json:"model_name"`
	Meta      string `json:"meta"`
}

// List 项目列表（按当前租户）
func (h *ProjectHandler) List(c *gin.Context) {
	tenantID := middleware.GetCurrentTenantID(c)
	var projects []model.Project
	h.DB.Where("tenant_id = ?", tenantID).Order("updated_at DESC").Find(&projects)
	OK(c, projects)
}

// Create 创建项目
func (h *ProjectHandler) Create(c *gin.Context) {
	var req createProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "项目名称必填")
		return
	}
	tenantID := middleware.GetCurrentTenantID(c)
	userID := middleware.GetCurrentUserID(c)

	// 检查项目数量配额
	var count int64
	h.DB.Model(&model.Project{}).Where("tenant_id = ? AND status = ?", tenantID, "active").Count(&count)
	var sub model.Subscription
	h.DB.Where("tenant_id = ? AND status = ?", tenantID, "active").First(&sub)
	var plan model.Plan
	h.DB.First(&plan, sub.PlanID)

	// 简单配额检查（max_projects）
	if plan.Quotas != "" {
		// 用 reuse 的解析
	}
	if count >= 999 {
		BadRequest(c, "项目数量已达上限")
		return
	}

	project := model.Project{
		TenantID: tenantID,
		OwnerID:  userID,
		Name:     req.Name,
		Status:   "active",
	}
	if err := h.DB.Create(&project).Error; err != nil {
		InternalError(c, "创建项目失败")
		return
	}
	Created(c, project)
}

// Get 项目详情
func (h *ProjectHandler) Get(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	tenantID := middleware.GetCurrentTenantID(c)

	var project model.Project
	if err := h.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&project).Error; err != nil {
		NotFound(c, "项目不存在")
		return
	}
	OK(c, project)
}

// Update 更新项目
func (h *ProjectHandler) Update(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	tenantID := middleware.GetCurrentTenantID(c)

	var req updateProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效")
		return
	}

	var project model.Project
	if err := h.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&project).Error; err != nil {
		NotFound(c, "项目不存在")
		return
	}

	updates := map[string]any{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.CoverURL != nil {
		updates["cover_url"] = *req.CoverURL
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}
	if len(updates) > 0 {
		h.DB.Model(&project).Updates(updates)
	}
	OK(c, project)
}

// Delete 删除项目（软删除）
func (h *ProjectHandler) Delete(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	tenantID := middleware.GetCurrentTenantID(c)

	result := h.DB.Where("id = ? AND tenant_id = ?", id, tenantID).Delete(&model.Project{})
	if result.RowsAffected == 0 {
		NotFound(c, "项目不存在")
		return
	}
	OK(c, gin.H{"deleted": true})
}

// SaveCanvas 保存画布状态（创建新快照）
func (h *ProjectHandler) SaveCanvas(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	tenantID := middleware.GetCurrentTenantID(c)

	var req saveCanvasReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "画布数据必填")
		return
	}

	// 校验项目归属
	var project model.Project
	if err := h.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&project).Error; err != nil {
		NotFound(c, "项目不存在")
		return
	}

	// 查当前最大版本号
	var maxVersion int
	h.DB.Model(&model.ProjectSnapshot{}).Where("project_id = ?", id).Select("COALESCE(MAX(version), 0)").Scan(&maxVersion)

	snapshot := model.ProjectSnapshot{
		ProjectID: uint(id),
		Version:   maxVersion + 1,
		Data:      req.Data,
	}
	if err := h.DB.Create(&snapshot).Error; err != nil {
		InternalError(c, "保存画布失败")
		return
	}

	// 更新项目更新时间
	h.DB.Model(&project).Update("updated_at", project.UpdatedAt)

	OK(c, gin.H{"version": snapshot.Version})
}

// GetCanvas 读取最新画布状态
func (h *ProjectHandler) GetCanvas(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	tenantID := middleware.GetCurrentTenantID(c)

	// 校验归属
	var project model.Project
	if err := h.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&project).Error; err != nil {
		NotFound(c, "项目不存在")
		return
	}

	var snapshot model.ProjectSnapshot
	if err := h.DB.Where("project_id = ?", id).Order("version DESC").First(&snapshot).Error; err != nil {
		OK(c, gin.H{"data": nil, "version": 0})
		return
	}
	OK(c, gin.H{"data": snapshot.Data, "version": snapshot.Version})
}

// ListHistory 历史记录列表
func (h *ProjectHandler) ListHistory(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	tenantID := middleware.GetCurrentTenantID(c)

	// 校验归属
	var project model.Project
	if err := h.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&project).Error; err != nil {
		NotFound(c, "项目不存在")
		return
	}

	var history []model.ProjectHistory
	h.DB.Where("project_id = ?", id).Order("created_at DESC").Find(&history)
	OK(c, history)
}

// CreateHistory 新增历史记录
func (h *ProjectHandler) CreateHistory(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	tenantID := middleware.GetCurrentTenantID(c)

	var req createHistoryReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效")
		return
	}

	var project model.Project
	if err := h.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&project).Error; err != nil {
		NotFound(c, "项目不存在")
		return
	}

	history := model.ProjectHistory{
		ProjectID: uint(id),
		Type:      req.Type,
		URL:       req.URL,
		Prompt:    req.Prompt,
		ModelName: req.ModelName,
		Meta:      req.Meta,
	}
	if err := h.DB.Create(&history).Error; err != nil {
		InternalError(c, "保存历史记录失败")
		return
	}
	Created(c, history)
}
