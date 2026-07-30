package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/vodstudio/backend/internal/service"
)

// Context keys
const (
	CtxUserID       = "user_id"
	CtxTenantID     = "tenant_id"
	CtxEmail        = "email"
	CtxRole         = "role"
	CtxIsSuperAdmin = "is_super_admin"

	LocalUserID   uint = 1
	LocalTenantID uint = 1
)

// LocalIdentity 为本地单用户应用注入稳定身份，不读取登录态或请求头。
// 现有项目与凭证表继续使用 tenant_id 字段，以兼容已有查询和数据结构。
func LocalIdentity() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(CtxUserID, LocalUserID)
		c.Set(CtxTenantID, LocalTenantID)
		c.Set(CtxEmail, "local@vodstudio")
		c.Set(CtxRole, "owner")
		c.Set(CtxIsSuperAdmin, false)
		c.Next()
	}
}

// AuthRequired 校验 Bearer JWT，注入用户信息到 context
func AuthRequired(jwt *service.JWTService) gin.HandlerFunc {
	return func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		if auth == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "缺少 Authorization 头"})
			return
		}
		parts := strings.SplitN(auth, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization 格式错误"})
			return
		}
		claims, err := jwt.ParseToken(parts[1])
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token 无效或已过期"})
			return
		}
		if claims.Subject != "access" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token 类型错误"})
			return
		}
		c.Set(CtxUserID, claims.UserID)
		c.Set(CtxTenantID, claims.TenantID)
		c.Set(CtxEmail, claims.Email)
		c.Set(CtxRole, claims.Role)
		c.Set(CtxIsSuperAdmin, claims.IsSuperAdmin)
		c.Next()
	}
}

// GetCurrentUserID 从 context 取当前用户 ID
func GetCurrentUserID(c *gin.Context) uint {
	if v, ok := c.Get(CtxUserID); ok {
		if id, ok := v.(uint); ok {
			return id
		}
	}
	return 0
}

// GetCurrentTenantID 从 context 取当前租户 ID
func GetCurrentTenantID(c *gin.Context) uint {
	if v, ok := c.Get(CtxTenantID); ok {
		if id, ok := v.(uint); ok {
			return id
		}
	}
	return 0
}

// GetCurrentRole 从 context 取当前用户角色
func GetCurrentRole(c *gin.Context) string {
	if v, ok := c.Get(CtxRole); ok {
		if r, ok := v.(string); ok {
			return r
		}
	}
	return ""
}
