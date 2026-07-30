package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// SuperAdminRequired 校验当前用户是否为全局超级管理员
// 必须在 AuthRequired 之后使用（依赖其设置的 is_super_admin context key）
func SuperAdminRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !GetCurrentIsSuperAdmin(c) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "需要管理员权限"})
			return
		}
		c.Next()
	}
}

// GetCurrentIsSuperAdmin 从 context 取当前用户是否为超级管理员
func GetCurrentIsSuperAdmin(c *gin.Context) bool {
	if v, ok := c.Get(CtxIsSuperAdmin); ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}
