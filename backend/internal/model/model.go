package model

import (
	"time"

	"gorm.io/gorm"
)

type Base struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Project 是一个本地创作项目。
type Project struct {
	Base
	Name     string `gorm:"size:255;not null" json:"name"`
	CoverURL string `gorm:"size:1024" json:"cover_url"`
	Status   string `gorm:"size:32;default:active" json:"status"`
}

// ProjectSnapshot 保存可恢复的完整画布过程状态。
type ProjectSnapshot struct {
	Base
	ProjectID uint   `gorm:"uniqueIndex;not null" json:"project_id"`
	Data      string `gorm:"type:text;not null" json:"data"`
}

// ProjectHistory 保存图片、视频等生成结果。
type ProjectHistory struct {
	Base
	ProjectID uint   `gorm:"index:idx_project_client,unique;not null" json:"project_id"`
	ClientID  string `gorm:"size:191;index:idx_project_client,unique;not null" json:"client_id"`
	Type      string `gorm:"size:32;not null" json:"type"`
	URL       string `gorm:"size:2048" json:"url"`
	Prompt    string `gorm:"type:text" json:"prompt"`
	ModelName string `gorm:"size:128" json:"model_name"`
	Meta      string `gorm:"type:text" json:"meta"`
}

// Credential 保存全局 API 凭证的 AES-GCM 密文。
type Credential struct {
	Base
	Provider      string `gorm:"size:64;uniqueIndex;not null" json:"provider"`
	EncryptedData string `gorm:"type:text;not null" json:"-"`
}

func AutoMigrateAll(db *gorm.DB) error {
	return db.AutoMigrate(
		&Project{},
		&ProjectSnapshot{},
		&ProjectHistory{},
		&Credential{},
	)
}
