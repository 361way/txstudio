package middleware

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"github.com/vodstudio/backend/internal/model"
)

// QuotaCheck 配额检查中间件。
// usageType: video_gen | image_gen | proxy 等，对应 Plan.Quotas 中的 key
func QuotaCheck(db *gorm.DB, usageType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenantID := GetCurrentTenantID(c)
		if tenantID == 0 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "无法识别租户"})
			return
		}

		// 查当前订阅的套餐
		var sub model.Subscription
		if err := db.Where("tenant_id = ? AND status = ?", tenantID, "active").First(&sub).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "无有效订阅"})
			return
		}
		var plan model.Plan
		if err := db.First(&plan, sub.PlanID).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "套餐不存在"})
			return
		}

		// 解析套餐配额
		quotaLimit, ok := getQuotaLimit(plan.Quotas, usageType)
		if !ok {
			// 套餐未限制此项，放行
			c.Next()
			return
		}

		// 查当日用量
		today := time.Now().Format("2006-01-02")
		var usage model.UsageRecord
		result := db.Where("tenant_id = ? AND type = ? AND date = ?", tenantID, usageType, today).First(&usage)
		used := 0
		if result.Error == nil {
			used = usage.Count
		}

		if used >= quotaLimit {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":       "配额已用尽",
				"usage_type":  usageType,
				"used":        used,
				"limit":       quotaLimit,
				"reset_at":    fmt.Sprintf("%s 23:59:59", today),
			})
			return
		}

		c.Next()

		// 请求成功后记录用量（仅 2xx 响应）
		if c.Writer.Status() >= 200 && c.Writer.Status() < 300 {
			RecordUsage(db, tenantID, GetCurrentUserID(c), usageType)
		}
	}
}

// RecordUsage 原子递增用量计数
func RecordUsage(db *gorm.DB, tenantID, userID uint, usageType string) {
	today := time.Now().Format("2006-01-02")
	var usage model.UsageRecord
	result := db.Where("tenant_id = ? AND type = ? AND date = ?", tenantID, usageType, today).First(&usage)
	if result.Error == gorm.ErrRecordNotFound {
		db.Create(&model.UsageRecord{
			TenantID: tenantID,
			UserID:   userID,
			Type:     usageType,
			Count:    1,
			Date:     today,
		})
	} else if result.Error == nil {
		db.Model(&usage).UpdateColumn("count", usage.Count+1)
	}
}

// getQuotaLimit 从 JSON 配额字符串中取指定类型的限额
func getQuotaLimit(quotasJSON, key string) (int, bool) {
	m := map[string]int{}
	if err := json.Unmarshal([]byte(quotasJSON), &m); err != nil {
		return 0, false
	}
	v, ok := m[key]
	return v, ok
}
