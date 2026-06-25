package app

import (
	"log"
	"os"
	"strings"

	"github.com/vodstudio/backend/internal/model"
	"github.com/vodstudio/backend/internal/service"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// bootstrapAdmin 启动时预置全局超级管理员。
// 通过环境变量 VODSTUDIO_ADMIN_EMAIL + VODSTUDIO_ADMIN_PASSWORD 配置。
// - 若 email 用户已存在：设置 IsSuperAdmin=true（幂等）
// - 若不存在：创建专用 admin 租户 + 超管用户
func bootstrapAdmin(db *gorm.DB) {
	email := strings.TrimSpace(os.Getenv("VODSTUDIO_ADMIN_EMAIL"))
	password := os.Getenv("VODSTUDIO_ADMIN_PASSWORD")
	if email == "" {
		log.Println("[admin] 未配置 VODSTUDIO_ADMIN_EMAIL，跳过管理员预置")
		return
	}

	// 查是否已存在
	var user model.User
	err := db.Where("email = ?", email).First(&user).Error
	if err == nil {
		// 用户已存在
		if !user.IsSuperAdmin {
			db.Model(&user).Update("is_super_admin", true)
			log.Printf("[admin] 已将现有用户 %s 提升为超级管理员", email)
		} else {
			log.Printf("[admin] 用户 %s 已是超级管理员", email)
		}
		return
	}
	if err != gorm.ErrRecordNotFound {
		log.Printf("[admin] 查询管理员失败: %v", err)
		return
	}

	// 创建新管理员
	if password == "" {
		log.Printf("[admin] 创建新管理员 %s 但未配置 VODSTUDIO_ADMIN_PASSWORD，跳过", email)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("[admin] 密码加密失败: %v", err)
		return
	}

	_ = service.NewJWTService // 仅为避免 service 未引用；实际不需要

	err = db.Transaction(func(tx *gorm.DB) error {
		tenant := model.Tenant{Name: "系统管理", Slug: "admin-system", Status: "active"}
		if err := tx.Create(&tenant).Error; err != nil {
			return err
		}
		admin := model.User{
			TenantID:     tenant.ID,
			Email:        email,
			PasswordHash: string(hash),
			DisplayName:  "管理员",
			Role:         "admin",
			Status:       "active",
			IsSuperAdmin: true,
		}
		if err := tx.Create(&admin).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		log.Printf("[admin] 创建管理员失败: %v", err)
		return
	}
	log.Printf("[admin] 超级管理员 %s 创建成功", email)
}
