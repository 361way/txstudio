package middleware

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vodstudio/backend/internal/model"
	"gorm.io/gorm"
)

// UsageTypeResolver 根据请求上下文解析用量类型。
// 返回 (usageType, skip)：
//   - usageType: "image_gen" | "video_gen" | "proxy" 等，对应 Plan.Quotas 中的 key
//   - skip=true: 跳过配额检查与计数（如 VOD 轮询 DescribeTaskDetail）
type UsageTypeResolver func(*gin.Context) (string, bool)

// QuotaCheck 配额检查中间件（按用户）。
// 旧签名：QuotaCheck(db, "proxy") — 固定 usageType，等价于 resolver 返回 ("proxy", false)。
// 新签名：QuotaCheckWithResolver(db, resolver) — usageType 由 resolver 根据 action 决定。
func QuotaCheck(db *gorm.DB, usageType string) gin.HandlerFunc {
	return QuotaCheckWithResolver(db, func(c *gin.Context) (string, bool) {
		return usageType, false
	})
}

// QuotaCheckWithResolver 带 resolver 的配额检查
func QuotaCheckWithResolver(db *gorm.DB, resolver UsageTypeResolver) gin.HandlerFunc {
	return func(c *gin.Context) {
		usageType, skip := resolver(c)
		if skip {
			// 轮询类请求不计配额，直接放行
			c.Next()
			return
		}

		userID := GetCurrentUserID(c)
		if userID == 0 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "无法识别用户"})
			return
		}

		// 查用户级配额覆盖
		limit, ok := getUserQuotaLimit(db, userID, usageType)
		if !ok {
			// 用户/套餐未限制此项，放行
			c.Next()
			return
		}

		// 查当日用户用量
		today := time.Now().Format("2006-01-02")
		var usage model.UserUsageRecord
		result := db.Where("user_id = ? AND type = ? AND date = ?", userID, usageType, today).First(&usage)
		used := 0
		if result.Error == nil {
			used = usage.Count
		}

		if used >= limit {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":      "配额已用尽",
				"usage_type": usageType,
				"used":       used,
				"limit":      limit,
				"reset_at":   fmt.Sprintf("%s 23:59:59", today),
			})
			return
		}

		c.Next()

		// 请求成功后记录用量（仅 2xx 响应）
		if c.Writer.Status() >= 200 && c.Writer.Status() < 300 {
			RecordUserUsage(db, userID, usageType)
		}
	}
}

// getUserQuotaLimit 查用户配额上限。
// 优先级：UserQuotaOverride.Quotas > Plan.Quotas（租户套餐）。
// 返回 (limit, ok)：ok=false 表示无限制。
func getUserQuotaLimit(db *gorm.DB, userID uint, usageType string) (int, bool) {
	// usageType 与 quota JSON key 的映射：
	//   image_gen → daily_image_gen, video_gen → daily_video_gen
	quotaKey := usageToQuotaKey(usageType)

	// 1) 用户级覆盖
	var override model.UserQuotaOverride
	if err := db.Where("user_id = ?", userID).First(&override).Error; err == nil && override.Quotas != "" {
		if v, ok := getQuotaLimit(override.Quotas, quotaKey); ok {
			return v, true
		}
	}
	// 2) 回退到租户套餐
	var user model.User
	if err := db.First(&user, userID).Error; err != nil {
		return 0, false
	}
	var sub model.Subscription
	if err := db.Where("tenant_id = ? AND status = ?", user.TenantID, "active").First(&sub).Error; err != nil {
		return 0, false // 无订阅 → 不限制（或可改为 403）
	}
	var plan model.Plan
	if err := db.First(&plan, sub.PlanID).Error; err != nil {
		return 0, false
	}
	return getQuotaLimit(plan.Quotas, quotaKey)
}

// usageToQuotaKey 把内部 usageType 映射到 Plan.Quotas JSON 的 key
//   image_gen → daily_image_gen
//   video_gen → daily_video_gen
//   其他原样返回（如 proxy）
func usageToQuotaKey(usageType string) string {
	switch usageType {
	case "image_gen":
		return "daily_image_gen"
	case "video_gen":
		return "daily_video_gen"
	default:
		return usageType
	}
}

// RecordUserUsage 原子递增用户用量计数
func RecordUserUsage(db *gorm.DB, userID uint, usageType string) {
	today := time.Now().Format("2006-01-02")
	var usage model.UserUsageRecord
	result := db.Where("user_id = ? AND type = ? AND date = ?", userID, usageType, today).First(&usage)
	if result.Error == gorm.ErrRecordNotFound {
		db.Create(&model.UserUsageRecord{
			UserID: userID,
			Type:   usageType,
			Count:  1,
			Date:   today,
		})
	} else if result.Error == nil {
		db.Model(&usage).UpdateColumn("count", usage.Count+1)
	}
}

// RecordUsage 兼容旧调用（按租户写入旧表，已废弃；新代码用 RecordUserUsage）
// Deprecated: 使用 RecordUserUsage
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
	// 同时写入用户级表
	RecordUserUsage(db, userID, usageType)
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
