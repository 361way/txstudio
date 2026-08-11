package handler

import (
	"strconv"
	"time"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"github.com/gin-gonic/gin"
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
	Name     *string `json:"name"`
	CoverURL *string `json:"cover_url"`
	Status   *string `json:"status"`
}

type saveCanvasReq struct {
	Data string `json:"data" binding:"required"` // JSON 字符串: {nodes, connections, ...}
}

type createHistoryReq struct {
	ClientID  string `json:"client_id"`
	Type      string `json:"type" binding:"required"`
	URL       string `json:"url"`
	Prompt    string `json:"prompt"`
	ModelName string `json:"model_name"`
	Meta      string `json:"meta"`
}

type replaceHistoryReq struct {
	Items []createHistoryReq `json:"items"`
}

type deleteHistoryReq struct {
	ClientIDs []string `json:"client_ids" binding:"required"`
}

// List 项目列表（按当前租户）
func (h *ProjectHandler) List(c *gin.Context) {
	var projects []model.Project
	h.DB.Order("updated_at DESC").Find(&projects)
	OK(c, projects)
}

// Create 创建项目
func (h *ProjectHandler) Create(c *gin.Context) {
	var req createProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "项目名称必填")
		return
	}

	project := model.Project{Name: req.Name, Status: "active"}
	if err := h.DB.Create(&project).Error; err != nil {
		InternalError(c, "创建项目失败")
		return
	}
	Created(c, project)
}

// Get 项目详情
func (h *ProjectHandler) Get(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	var project model.Project
	if err := h.DB.First(&project, id).Error; err != nil {
		NotFound(c, "项目不存在")
		return
	}
	OK(c, project)
}

// Update 更新项目
func (h *ProjectHandler) Update(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	var req updateProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效")
		return
	}

	var project model.Project
	if err := h.DB.First(&project, id).Error; err != nil {
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

// Delete 硬删除项目及其画布、历史和资产元数据
func (h *ProjectHandler) Delete(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	err := h.DB.Transaction(func(tx *gorm.DB) error {
		var project model.Project
		if err := tx.First(&project, id).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ProjectSnapshot{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ProjectHistory{}).Error; err != nil {
			return err
		}
		return tx.Delete(&project).Error
	})
	if err == gorm.ErrRecordNotFound {
		NotFound(c, "项目不存在")
		return
	}
	if err != nil {
		InternalError(c, "删除项目失败")
		return
	}
	OK(c, gin.H{"deleted": true})
}

// SaveCanvas 保存画布状态（创建新快照）
func (h *ProjectHandler) SaveCanvas(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	var req saveCanvasReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "画布数据必填")
		return
	}

	// 校验项目归属
	var project model.Project
	if err := h.DB.First(&project, id).Error; err != nil {
		NotFound(c, "项目不存在")
		return
	}

	// 每个项目只维护一份当前过程快照。
	var snapshot model.ProjectSnapshot
	result := h.DB.Where("project_id = ?", id).First(&snapshot)
	if result.Error == gorm.ErrRecordNotFound {
		snapshot = model.ProjectSnapshot{ProjectID: uint(id), Data: req.Data}
		if err := h.DB.Create(&snapshot).Error; err != nil {
			InternalError(c, "保存画布失败")
			return
		}
	} else if result.Error != nil {
		InternalError(c, "读取画布快照失败")
		return
	} else if err := h.DB.Model(&snapshot).Updates(map[string]any{
		"data": req.Data,
	}).Error; err != nil {
		InternalError(c, "保存画布失败")
		return
	}

	h.DB.Model(&project).Update("updated_at", time.Now())
	OK(c, snapshot)
}

// GetCanvas 读取最新画布状态
func (h *ProjectHandler) GetCanvas(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	// 校验归属
	var project model.Project
	if err := h.DB.First(&project, id).Error; err != nil {
		NotFound(c, "项目不存在")
		return
	}

	var snapshot model.ProjectSnapshot
	if err := h.DB.Where("project_id = ?", id).First(&snapshot).Error; err != nil {
		OK(c, gin.H{"data": nil})
		return
	}
	OK(c, gin.H{"data": snapshot.Data})
}

// ListHistory 历史记录列表
func (h *ProjectHandler) ListHistory(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	// 校验归属
	var project model.Project
	if err := h.DB.First(&project, id).Error; err != nil {
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

	var req createHistoryReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效")
		return
	}

	var project model.Project
	if err := h.DB.First(&project, id).Error; err != nil {
		NotFound(c, "项目不存在")
		return
	}

	history := model.ProjectHistory{
		ProjectID: uint(id),
		ClientID:  req.ClientID,
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

// ReplaceHistory 使用当前画布历史快照替换项目历史，供前端防抖持久化。
func (h *ProjectHandler) ReplaceHistory(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	var req replaceHistoryReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "历史记录格式无效")
		return
	}

	var project model.Project
	if err := h.DB.First(&project, id).Error; err != nil {
		NotFound(c, "项目不存在")
		return
	}

	err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("project_id = ?", id).Delete(&model.ProjectHistory{}).Error; err != nil {
			return err
		}
		for _, item := range req.Items {
			history := model.ProjectHistory{
				ProjectID: uint(id),
				ClientID:  item.ClientID,
				Type:      item.Type,
				URL:       item.URL,
				Prompt:    item.Prompt,
				ModelName: item.ModelName,
				Meta:      item.Meta,
			}
			if err := tx.Create(&history).Error; err != nil {
				return err
			}
		}
		return tx.Model(&project).Update("updated_at", time.Now()).Error
	})
	if err != nil {
		InternalError(c, "保存历史记录失败")
		return
	}
	OK(c, gin.H{"saved": len(req.Items)})
}

// DeleteHistory 根据前端稳定 ID 硬删除项目历史，页面删除后数据库立即同步。
func (h *ProjectHandler) DeleteHistory(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	var req deleteHistoryReq
	if err := c.ShouldBindJSON(&req); err != nil || len(req.ClientIDs) == 0 {
		BadRequest(c, "请选择要删除的历史记录")
		return
	}

	var project model.Project
	if err := h.DB.First(&project, id).Error; err != nil {
		NotFound(c, "项目不存在")
		return
	}

	result := h.DB.Where("project_id = ? AND client_id IN ?", id, req.ClientIDs).
		Delete(&model.ProjectHistory{})
	if result.Error != nil {
		InternalError(c, "删除历史记录失败")
		return
	}
	h.DB.Model(&project).Update("updated_at", time.Now())
	OK(c, gin.H{"deleted": result.RowsAffected})
}
