package model

import (
	"time"

	"gorm.io/gorm"
)

// Base 所有模型的公共字段（软删除由 gorm.DeletedAt 处理）
type Base struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// Tenant 租户/组织
type Tenant struct {
	Base
	Name   string `gorm:"size:128;not null" json:"name"`
	Slug   string `gorm:"size:64;uniqueIndex;not null" json:"slug"`
	Status string `gorm:"size:32;default:active" json:"status"` // active | suspended
}

// User 用户
type User struct {
	Base
	TenantID     uint   `gorm:"index;not null" json:"tenant_id"`
	Email        string `gorm:"size:255;uniqueIndex;not null" json:"email"`
	PasswordHash string `gorm:"size:255;not null" json:"-"`
	DisplayName  string `gorm:"size:128" json:"display_name"`
	Role         string `gorm:"size:32;default:owner" json:"role"` // owner | admin | member | viewer
	Status       string `gorm:"size:32;default:active" json:"status"`
	LastLoginAt  *time.Time `json:"last_login_at"`
}

// Plan 套餐定义
type Plan struct {
	Base
	Code       string `gorm:"size:64;uniqueIndex;not null" json:"code"` // free | pro | enterprise
	Name       string `gorm:"size:128;not null" json:"name"`
	Quotas     string `gorm:"type:json" json:"quotas"`                  // JSON: {daily_video_gen, daily_image_gen, storage_mb, max_projects}
	PriceCents int    `json:"price_cents"`
	Period     string `gorm:"size:16;default:monthly" json:"period"`    // monthly | yearly
	Status     string `gorm:"size:32;default:active" json:"status"`
}

// Subscription 订阅（租户 1:1）
type Subscription struct {
	Base
	TenantID    uint   `gorm:"uniqueIndex;not null" json:"tenant_id"`
	PlanID      uint   `gorm:"not null" json:"plan_id"`
	Status      string `gorm:"size:32;default:active" json:"status"` // active | expired | cancelled
	PeriodStart time.Time `json:"period_start"`
	PeriodEnd   time.Time `json:"period_end"`
}

// UsageRecord 用量记录（按租户+日期+类型聚合）
type UsageRecord struct {
	Base
	TenantID uint   `gorm:"index:idx_tenant_date,unique;not null" json:"tenant_id"`
	UserID   uint   `gorm:"index" json:"user_id"`
	Type     string `gorm:"size:64;index:idx_tenant_date,unique;not null" json:"type"` // video_gen | image_gen | storage | proxy
	Count    int    `gorm:"default:0" json:"count"`
	Date     string `gorm:"size:10;index:idx_tenant_date,unique;not null" json:"date"` // YYYY-MM-DD
}

// Project 项目/画布
type Project struct {
	Base
	TenantID uint   `gorm:"index;not null" json:"tenant_id"`
	OwnerID  uint   `gorm:"not null" json:"owner_id"`
	Name     string `gorm:"size:255;not null" json:"name"`
	CoverURL string `gorm:"size:1024" json:"cover_url"`
	Status   string `gorm:"size:32;default:active" json:"status"` // active | archived
}

// ProjectSnapshot 画布快照（版本化保存）
type ProjectSnapshot struct {
	Base
	ProjectID uint   `gorm:"index;not null" json:"project_id"`
	Version   int    `gorm:"not null" json:"version"`
	Data      string `gorm:"type:longtext" json:"data"` // JSON: {nodes, connections, ...}
}

// ProjectHistory 生成历史记录
type ProjectHistory struct {
	Base
	ProjectID uint   `gorm:"index;not null" json:"project_id"`
	Type      string `gorm:"size:32;not null" json:"type"` // image | video
	URL       string `gorm:"size:1024" json:"url"`
	Prompt    string `gorm:"type:text" json:"prompt"`
	ModelName string `gorm:"size:128" json:"model_name"`
	Meta      string `gorm:"type:json" json:"meta"` // 额外元数据
}

// Asset 资产元数据
type Asset struct {
	Base
	TenantID  uint   `gorm:"index;not null" json:"tenant_id"`
	ProjectID uint   `gorm:"index" json:"project_id"`
	COSKey    string `gorm:"size:1024;not null" json:"cos_key"` // tenant/{tenantId}/...
	Mime      string `gorm:"size:128" json:"mime"`
	Size      int64  `json:"size"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
}

// Credential 加密凭证（VOD / TokenHub 的 AK/SK）
type Credential struct {
	Base
	TenantID      uint   `gorm:"index;not null" json:"tenant_id"`
	Provider      string `gorm:"size:64;not null" json:"provider"` // vod | tokenhub
	EncryptedData string `gorm:"type:text;not null" json:"-"`      // AES-GCM 加密的 JSON
	// 明文结构（仅传输用，不入库）:
	// vod:      {secret_id, secret_key, sub_app_id, region}
	// tokenhub: {api_key, base_url}
}

// AutoMigrateAll 自动迁移所有表
func AutoMigrateAll(db *gorm.DB) error {
	return db.AutoMigrate(
		&Tenant{},
		&User{},
		&Plan{},
		&Subscription{},
		&UsageRecord{},
		&Project{},
		&ProjectSnapshot{},
		&ProjectHistory{},
		&Asset{},
		&Credential{},
	)
}

// SeedPlans 写入默认套餐（幂等）
func SeedPlans(db *gorm.DB) error {
	plans := []Plan{
		{
			Code: "free", Name: "免费版",
			Quotas:     `{"daily_video_gen":5,"daily_image_gen":20,"storage_mb":512,"max_projects":3}`,
			PriceCents: 0, Period: "monthly", Status: "active",
		},
		{
			Code: "pro", Name: "专业版",
			Quotas:     `{"daily_video_gen":50,"daily_image_gen":200,"storage_mb":5120,"max_projects":20}`,
			PriceCents: 9900, Period: "monthly", Status: "active",
		},
		{
			Code: "enterprise", Name: "企业版",
			Quotas:     `{"daily_video_gen":1000,"daily_image_gen":5000,"storage_mb":51200,"max_projects":999}`,
			PriceCents: 99900, Period: "monthly", Status: "active",
		},
	}
	for _, p := range plans {
		var existing Plan
		if err := db.Where("code = ?", p.Code).First(&existing).Error; err == gorm.ErrRecordNotFound {
			if err := db.Create(&p).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
