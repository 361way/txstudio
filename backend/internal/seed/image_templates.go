package seed

import (
	_ "embed"
	"encoding/json"
	"fmt"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"gorm.io/gorm"
)

const systemTemplateSource = "system"

//go:embed system_image_templates.json
var systemImageTemplatesJSON []byte

type systemImageTemplate struct {
	SourceKey      string `json:"source_key"`
	SourceName     string `json:"source_name"`
	SourceURL      string `json:"source_url"`
	SortOrder      int    `json:"sort_order"`
	Category       string `json:"category"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	Prompt         string `json:"prompt"`
	PromptZH       string `json:"prompt_zh"`
	PromptEN       string `json:"prompt_en"`
	PromptLanguage string `json:"prompt_language"`
	ModelName      string `json:"model_name"`
	ModelVersion   string `json:"model_version"`
	Ratio          string `json:"ratio"`
	Resolution     string `json:"resolution"`
	EnhancePrompt  string `json:"enhance_prompt"`
	StorageMode    string `json:"storage_mode"`
	Accent         string `json:"accent"`
	CoverURL       string `json:"cover_url"`
}

// EnsureSystemImageTemplates 只补充首次缺失的系统模板，不覆盖数据库中已维护的内容。
func EnsureSystemImageTemplates(db *gorm.DB) error {
	var templates []systemImageTemplate
	if err := json.Unmarshal(systemImageTemplatesJSON, &templates); err != nil {
		return fmt.Errorf("解析系统图像模板种子失败: %w", err)
	}

	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.ImageTemplate{}).
			Where("source = '' OR source IS NULL").
			Update("source", "user").Error; err != nil {
			return fmt.Errorf("迁移历史自定义模板来源失败: %w", err)
		}

		for _, item := range templates {
			if item.SourceKey == "" {
				return fmt.Errorf("系统图像模板缺少 source_key")
			}
			var count int64
			if err := tx.Model(&model.ImageTemplate{}).
				Where("source = ? AND source_key = ?", systemTemplateSource, item.SourceKey).
				Count(&count).Error; err != nil {
				return fmt.Errorf("检查系统图像模板 %q 失败: %w", item.SourceKey, err)
			}
			if count > 0 {
				continue
			}
			template := model.ImageTemplate{
				Source: systemTemplateSource, SourceKey: item.SourceKey,
				SourceName: item.SourceName, SourceURL: item.SourceURL,
				SortOrder: item.SortOrder, IsPublished: true,
				Category: item.Category, Name: item.Name, Description: item.Description,
				Prompt: item.Prompt, PromptZH: item.PromptZH, PromptEN: item.PromptEN,
				PromptLanguage: item.PromptLanguage, ModelName: item.ModelName,
				ModelVersion: item.ModelVersion, Ratio: item.Ratio, Resolution: item.Resolution,
				EnhancePrompt: item.EnhancePrompt, StorageMode: item.StorageMode,
				Accent: item.Accent, CoverURL: item.CoverURL,
			}
			if err := tx.Create(&template).Error; err != nil {
				return fmt.Errorf("导入系统图像模板 %q 失败: %w", item.SourceKey, err)
			}
		}
		return nil
	})
}
