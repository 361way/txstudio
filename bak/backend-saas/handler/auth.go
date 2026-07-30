package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vodstudio/backend/internal/middleware"
	"github.com/vodstudio/backend/internal/model"
	"github.com/vodstudio/backend/internal/service"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// AuthHandler 认证相关 handler
type AuthHandler struct {
	DB  *gorm.DB
	JWT *service.JWTService
}

type registerReq struct {
	Email       string `json:"email" binding:"required,email"`
	Password    string `json:"password" binding:"required,min=6"`
	DisplayName string `json:"display_name"`
	TenantName  string `json:"tenant_name"`
}

type loginReq struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type refreshReq struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// Register 注册：自动创建租户 + owner 用户 + free 订阅
func (h *AuthHandler) Register(c *gin.Context) {
	var req registerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效: "+err.Error())
		return
	}

	// 检查 email 是否已注册
	var count int64
	h.DB.Model(&model.User{}).Where("email = ?", req.Email).Count(&count)
	if count > 0 {
		BadRequest(c, "该邮箱已注册")
		return
	}

	// 哈希密码
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		InternalError(c, "密码加密失败")
		return
	}

	// 生成 slug
	slug := generateSlug(req.Email)
	if req.TenantName == "" {
		req.TenantName = req.DisplayName + " 的空间"
	}
	if req.DisplayName == "" {
		req.DisplayName = strings.Split(req.Email, "@")[0]
	}

	// 事务：创建租户 + 用户 + 订阅
	err = h.DB.Transaction(func(tx *gorm.DB) error {
		tenant := model.Tenant{Name: req.TenantName, Slug: slug, Status: "active"}
		if err := tx.Create(&tenant).Error; err != nil {
			return err
		}

		user := model.User{
			TenantID:     tenant.ID,
			Email:        req.Email,
			PasswordHash: string(hash),
			DisplayName:  req.DisplayName,
			Role:         "owner",
			Status:       "active",
		}
		if err := tx.Create(&user).Error; err != nil {
			return err
		}

		// 查 free 套餐
		var plan model.Plan
		if err := tx.Where("code = ?", "free").First(&plan).Error; err != nil {
			return err
		}

		now := time.Now()
		sub := model.Subscription{
			TenantID:    tenant.ID,
			PlanID:      plan.ID,
			Status:      "active",
			PeriodStart: now,
			PeriodEnd:   now.AddDate(1, 0, 0),
		}
		if err := tx.Create(&sub).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		InternalError(c, "注册失败: "+err.Error())
		return
	}

	// 查回用户并签发 token
	var user model.User
	h.DB.Preload("TenantID").Where("email = ?", req.Email).First(&user)

	accessToken, _ := h.JWT.GenerateAccessToken(user.ID, user.TenantID, user.Email, user.Role, user.IsSuperAdmin)
	refreshToken, _ := h.JWT.GenerateRefreshToken(user.ID, user.TenantID, user.Email, user.Role, user.IsSuperAdmin)

	Created(c, gin.H{
		"user":          user,
		"access_token":  accessToken,
		"refresh_token": refreshToken,
	})
}

// Login 登录
func (h *AuthHandler) Login(c *gin.Context) {
	var req loginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效: "+err.Error())
		return
	}

	var user model.User
	if err := h.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
		Unauthorized(c, "邮箱或密码错误")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		Unauthorized(c, "邮箱或密码错误")
		return
	}

	if user.Status != "active" {
		Fail(c, http.StatusForbidden, "账号已被禁用")
		return
	}

	now := time.Now()
	h.DB.Model(&user).Update("last_login_at", now)

	accessToken, _ := h.JWT.GenerateAccessToken(user.ID, user.TenantID, user.Email, user.Role, user.IsSuperAdmin)
	refreshToken, _ := h.JWT.GenerateRefreshToken(user.ID, user.TenantID, user.Email, user.Role, user.IsSuperAdmin)

	OK(c, gin.H{
		"user":          user,
		"access_token":  accessToken,
		"refresh_token": refreshToken,
	})
}

// Refresh 刷新 access token
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req refreshReq
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "请求参数无效")
		return
	}

	claims, err := h.JWT.ParseToken(req.RefreshToken)
	if err != nil {
		Unauthorized(c, "refresh token 无效或已过期")
		return
	}
	if claims.Subject != "refresh" {
		Unauthorized(c, "token 类型错误")
		return
	}

	// 校验用户仍有效
	var user model.User
	if err := h.DB.First(&user, claims.UserID).Error; err != nil {
		Unauthorized(c, "用户不存在")
		return
	}
	if user.Status != "active" {
		Fail(c, http.StatusForbidden, "账号已被禁用")
		return
	}

	accessToken, _ := h.JWT.GenerateAccessToken(user.ID, user.TenantID, user.Email, user.Role, user.IsSuperAdmin)
	OK(c, gin.H{"access_token": accessToken})
}

// Me 当前用户信息
func (h *AuthHandler) Me(c *gin.Context) {
	userID := middleware.GetCurrentUserID(c)
	var user model.User
	if err := h.DB.First(&user, userID).Error; err != nil {
		NotFound(c, "用户不存在")
		return
	}
	// 返回配额摘要：今日图片/视频用量 vs 上限
	quota := h.buildUserQuotaSummary(&user)
	OK(c, gin.H{
		"user":            user,
		"is_super_admin":  user.IsSuperAdmin,
		"quota":           quota,
	})
}

// buildUserQuotaSummary 计算用户今日配额使用情况
// 上限优先级：UserQuotaOverride > Plan.Quotas
func (h *AuthHandler) buildUserQuotaSummary(user *model.User) gin.H {
	today := time.Now().Format("2006-01-02")
	limits := map[string]int{
		"daily_image_gen": 0,
		"daily_video_gen": 0,
	}
	// 查用户覆盖
	var override model.UserQuotaOverride
	if err := h.DB.Where("user_id = ?", user.ID).First(&override).Error; err == nil && override.Quotas != "" {
		parseQuotaJSON(override.Quotas, limits)
	} else {
		// 回退到套餐
		var sub model.Subscription
		if err := h.DB.Where("tenant_id = ? AND status = ?", user.TenantID, "active").First(&sub).Error; err == nil {
			var plan model.Plan
			if err := h.DB.First(&plan, sub.PlanID).Error; err == nil {
				parseQuotaJSON(plan.Quotas, limits)
			}
		}
	}
	// 查今日用量
	var records []model.UserUsageRecord
	h.DB.Where("user_id = ? AND date = ?", user.ID, today).Find(&records)
	usage := map[string]int{}
	for _, r := range records {
		usage[r.Type] = r.Count
	}
	return gin.H{
		"limits": limits,
		"usage":  usage,
		"date":   today,
	}
}

// parseQuotaJSON 将 quota JSON 解析进 limits map（仅取认识的 key）
func parseQuotaJSON(jsonStr string, limits map[string]int) {
	// 简易解析：避免引入额外依赖，使用 golang 标准库
	// JSON 形如 {"daily_video_gen":5,"daily_image_gen":20,"storage_mb":512,"max_projects":3}
	type quotaShape struct {
		DailyVideoGen int `json:"daily_video_gen"`
		DailyImageGen int `json:"daily_image_gen"`
		StorageMB     int `json:"storage_mb"`
		MaxProjects   int `json:"max_projects"`
	}
	var q quotaShape
	if err := json.Unmarshal([]byte(jsonStr), &q); err == nil {
		limits["daily_video_gen"] = q.DailyVideoGen
		limits["daily_image_gen"] = q.DailyImageGen
	}
}

// generateSlug 从 email 生成租户 slug
func generateSlug(email string) string {
	prefix := strings.Split(email, "@")[0]
	prefix = strings.ToLower(strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		return '-'
	}, prefix))
	return prefix + "-" + time.Now().Format("0102")
}
