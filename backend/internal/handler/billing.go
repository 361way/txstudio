package handler

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vodstudio/backend/internal/middleware"
	"github.com/vodstudio/backend/internal/model"
	"gorm.io/gorm"
)

// BillingHandler 计费/用量 handler
type BillingHandler struct {
	DB *gorm.DB
}

type subscribeReq struct {
	PlanCode string `json:"plan_code" binding:"required"` // free | pro | enterprise
}

// Plans 套餐列表
func (h *BillingHandler) Plans(c *gin.Context) {
	var plans []model.Plan
	h.DB.Where("status = ?", "active").Find(&plans)
	OK(c, plans)
}

// Subscription 当前租户的订阅
func (h *BillingHandler) Subscription(c *gin.Context) {
	tenantID := middleware.GetCurrentTenantID(c)

	var sub model.Subscription
	if err := h.DB.Where("tenant_id = ? AND status = ?", tenantID, "active").First(&sub).Error; err != nil {
		NotFound(c, "无有效订阅")
		return
	}
	var plan model.Plan
	h.DB.First(&plan, sub.PlanID)

	OK(c, gin.H{"subscription": sub, "plan": plan})
}

// Subscribe 订阅/切换套餐（MVP：直接切换，不做支付）
func (h *BillingHandler) Subscribe(c *gin.Context) {
	var req subscribeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "plan_code 必填")
		return
	}
	tenantID := middleware.GetCurrentTenantID(c)

	var plan model.Plan
	if err := h.DB.Where("code = ? AND status = ?", req.PlanCode, "active").First(&plan).Error; err != nil {
		BadRequest(c, "套餐不存在")
		return
	}

	var sub model.Subscription
	result := h.DB.Where("tenant_id = ? AND status = ?", tenantID, "active").First(&sub)
	now := time.Now()
	if result.Error == gorm.ErrRecordNotFound {
		sub = model.Subscription{
			TenantID: tenantID, PlanID: plan.ID, Status: "active",
			PeriodStart: now, PeriodEnd: now.AddDate(1, 0, 0),
		}
		h.DB.Create(&sub)
	} else {
		h.DB.Model(&sub).Updates(map[string]any{
			"plan_id":      plan.ID,
			"period_start": now,
			"period_end":   now.AddDate(1, 0, 0),
		})
	}
	OK(c, gin.H{"subscription": sub, "plan": plan})
}

// Usage 当前租户用量统计（当日 + 本月汇总）
func (h *BillingHandler) Usage(c *gin.Context) {
	tenantID := middleware.GetCurrentTenantID(c)
	today := time.Now().Format("2006-01-02")
	monthStart := time.Now().Format("2006-01") + "-01"

	type usageRow struct {
		Type  string `json:"type"`
		Count int    `json:"count"`
	}

	// 当日用量
	var todayUsage []usageRow
	h.DB.Model(&model.UsageRecord{}).
		Select("type, count").
		Where("tenant_id = ? AND date = ?", tenantID, today).
		Scan(&todayUsage)

	// 本月用量汇总
	var monthUsage []usageRow
	h.DB.Model(&model.UsageRecord{}).
		Select("type, SUM(count) as count").
		Where("tenant_id = ? AND date >= ?", tenantID, monthStart).
		Group("type").
		Scan(&monthUsage)

	OK(c, gin.H{
		"today": todayUsage,
		"month": monthUsage,
	})
}
