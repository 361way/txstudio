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

// GenerationJob 保存跨首页、工具、画布和 Agent 的统一生成任务元数据。
type GenerationJob struct {
	Base
	ClientID     string     `gorm:"size:191;uniqueIndex;not null" json:"client_id"`
	ProjectID    *uint      `gorm:"index" json:"project_id,omitempty"`
	ParentJobID  *uint      `gorm:"index" json:"parent_job_id,omitempty"`
	Source       string     `gorm:"size:32;index;not null" json:"source"`
	Type         string     `gorm:"size:32;index;not null" json:"type"`
	Provider     string     `gorm:"size:64;not null" json:"provider"`
	CloudTaskID  string     `gorm:"size:255;index" json:"cloud_task_id"`
	Status       string     `gorm:"size:32;index;not null" json:"status"`
	Progress     int        `gorm:"not null;default:0" json:"progress"`
	Prompt       string     `gorm:"type:text" json:"prompt"`
	ModelName    string     `gorm:"size:128" json:"model_name"`
	ModelVersion string     `gorm:"size:128" json:"model_version"`
	Parameters   string     `gorm:"type:text" json:"parameters"`
	StorageMode  string     `gorm:"size:32" json:"storage_mode"`
	ErrorCode    string     `gorm:"size:128" json:"error_code"`
	ErrorMessage string     `gorm:"type:text" json:"error_message"`
	StartedAt    *time.Time `json:"started_at,omitempty"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
}

// GenerationAsset 保存任务输入输出的媒体索引；媒体本体仍位于 VOD/COS 或本地缓存。
type GenerationAsset struct {
	Base
	JobID           uint       `gorm:"index:idx_job_asset,unique;not null" json:"job_id"`
	Role            string     `gorm:"size:64;index:idx_job_asset,unique;not null" json:"role"`
	Ordinal         int        `gorm:"index:idx_job_asset,unique;not null" json:"ordinal"`
	MediaType       string     `gorm:"size:32" json:"media_type"`
	CloudFileID     string     `gorm:"size:255;index" json:"cloud_file_id"`
	CloudURL        string     `gorm:"size:4096" json:"cloud_url"`
	LocalPath       string     `gorm:"size:2048" json:"local_path"`
	StorageProvider string     `gorm:"size:32" json:"storage_provider"`
	StorageMode     string     `gorm:"size:32" json:"storage_mode"`
	MimeType        string     `gorm:"size:128" json:"mime_type"`
	FileSize        int64      `json:"file_size"`
	Width           int        `json:"width"`
	Height          int        `json:"height"`
	Duration        float64    `json:"duration"`
	ExpiresAt       *time.Time `json:"expires_at,omitempty"`
	Metadata        string     `gorm:"type:text" json:"metadata"`
}

// GenerationEvent 保存用户可读的任务阶段变化，不记录高频轮询明细或敏感信息。
type GenerationEvent struct {
	Base
	JobID    uint   `gorm:"index:idx_event_sequence,unique;not null" json:"job_id"`
	Sequence int    `gorm:"index:idx_event_sequence,unique;not null" json:"sequence"`
	Stage    string `gorm:"size:64;index" json:"stage"`
	Level    string `gorm:"size:16;not null" json:"level"`
	Message  string `gorm:"size:1000" json:"message"`
	Metadata string `gorm:"type:text" json:"metadata"`
}

// ImageTemplate 保存系统与用户可跨浏览器复用的完整图像生成模板配置。
// 媒体文件不存入数据库，CoverURL 仅保存受控本地路径或 HTTPS URL。
type ImageTemplate struct {
	Base
	Source         string `gorm:"size:16;index;not null;default:user" json:"source"`
	SourceKey      string `gorm:"size:160;index" json:"source_key"`
	SourceName     string `gorm:"size:120" json:"source_name"`
	SourceURL      string `gorm:"size:2048" json:"source_url"`
	SortOrder      int    `gorm:"index;not null;default:0" json:"sort_order"`
	IsPublished    bool   `gorm:"index;not null;default:true" json:"is_published"`
	Name           string `gorm:"size:120;not null" json:"name"`
	Category       string `gorm:"size:64;index;not null" json:"category"`
	Description    string `gorm:"size:500" json:"description"`
	Prompt         string `gorm:"type:text;not null" json:"prompt"`
	PromptZH       string `gorm:"type:text" json:"prompt_zh"`
	PromptEN       string `gorm:"type:text" json:"prompt_en"`
	PromptLanguage string `gorm:"size:16" json:"prompt_language"`
	ModelName      string `gorm:"size:128;not null" json:"model_name"`
	ModelVersion   string `gorm:"size:128;not null" json:"model_version"`
	Ratio          string `gorm:"size:32" json:"ratio"`
	Resolution     string `gorm:"size:32" json:"resolution"`
	EnhancePrompt  string `gorm:"size:16;not null;default:Enabled" json:"enhance_prompt"`
	StorageMode    string `gorm:"size:16;not null;default:Temporary" json:"storage_mode"`
	Accent         string `gorm:"size:32;not null;default:amber" json:"accent"`
	CoverURL       string `gorm:"size:2048" json:"cover_url"`
}

// Credential 保存全局 API 凭证的 AES-GCM 密文。
type Credential struct {
	Base
	Provider      string `gorm:"size:64;uniqueIndex;not null" json:"provider"`
	EncryptedData string `gorm:"type:text;not null" json:"-"`
}

func AutoMigrateAll(db *gorm.DB) error {
	if err := db.AutoMigrate(
		&Project{},
		&ProjectSnapshot{},
		&ProjectHistory{},
		&GenerationJob{},
		&GenerationAsset{},
		&GenerationEvent{},
		&ImageTemplate{},
		&Credential{},
	); err != nil {
		return err
	}
	// 旧版本误将 generation_events.sequence 建为全局唯一索引（idx_job_sequence），
	// 导致不同任务的同一序号互相冲突，后续任务写入事件时触发 UNIQUE 约束失败（500）。
	// 此处删除遗留索引，复合唯一索引 (job_id, sequence) 已由上面的 AutoMigrate 重建。
	for _, stmt := range []string{
		"DROP INDEX IF EXISTS idx_job_sequence",
	} {
		if err := db.Exec(stmt).Error; err != nil {
			return err
		}
	}
	return nil
}
