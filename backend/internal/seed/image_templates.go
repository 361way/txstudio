package seed

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"gorm.io/gorm"
)

const systemTemplateSource = "system"

//go:embed system_image_templates.json
var systemImageTemplatesJSON []byte

//go:embed assets/cases/*
var systemTemplateAssets embed.FS

type systemImageTemplate struct {
	SourceKey      string `json:"source_key"`
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

func loadSystemImageTemplates() ([]systemImageTemplate, error) {
	var templates []systemImageTemplate
	if err := json.Unmarshal(systemImageTemplatesJSON, &templates); err != nil {
		return nil, fmt.Errorf("解析系统图像模板种子失败: %w", err)
	}
	return templates, nil
}

// EnsureSystemImageTemplates 只补充首次缺失的系统模板，不覆盖数据库中已维护的内容。
func EnsureSystemImageTemplates(db *gorm.DB) error {
	templates, err := loadSystemImageTemplates()
	if err != nil {
		return err
	}

	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.ImageTemplate{}).
			Where("source = '' OR source IS NULL").
			Update("source", "user").Error; err != nil {
			return fmt.Errorf("迁移历史自定义模板来源失败: %w", err)
		}

		if err := tx.Model(&model.ImageTemplate{}).
			Where("source = ? AND storage_mode = ?", systemTemplateSource, "Temporary").
			Update("storage_mode", "Permanent").Error; err != nil {
			return fmt.Errorf("迁移系统图像模板存储模式失败: %w", err)
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

// EnsureSystemTemplateAssets 将内嵌的系统模板封面补写到用户缓存目录。
// 已存在的文件不会被覆盖，避免影响用户已缓存或手动替换的本地文件。
func EnsureSystemTemplateAssets(cacheRoot string) error {
	templates, err := loadSystemImageTemplates()
	if err != nil {
		return err
	}

	assetNames := make(map[string]struct{})
	for _, template := range templates {
		const coverPrefix = "/file/cases/"
		if !strings.HasPrefix(template.CoverURL, coverPrefix) {
			continue
		}
		name := strings.TrimPrefix(template.CoverURL, coverPrefix)
		if name == "" || path.Base(name) != name {
			return fmt.Errorf("系统图像模板封面路径无效: %q", template.CoverURL)
		}
		assetNames[name] = struct{}{}
	}

	if len(assetNames) == 0 {
		return nil
	}
	casesDir := filepath.Join(cacheRoot, "cases")
	if err := os.MkdirAll(casesDir, 0o700); err != nil {
		return fmt.Errorf("创建系统模板封面目录失败: %w", err)
	}

	names := make([]string, 0, len(assetNames))
	for name := range assetNames {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if err := copySystemTemplateAsset(casesDir, name); err != nil {
			return err
		}
	}
	return nil
}

func copySystemTemplateAsset(casesDir, name string) error {
	target := filepath.Join(casesDir, name)
	if info, err := os.Stat(target); err == nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("系统模板封面目标不是普通文件: %q", target)
		}
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("检查系统模板封面失败: %w", err)
	}

	assetPath := path.Join("assets", "cases", name)
	content, err := fs.ReadFile(systemTemplateAssets, assetPath)
	if err != nil {
		return fmt.Errorf("读取内嵌系统模板封面 %q 失败: %w", name, err)
	}
	temporary, err := os.CreateTemp(casesDir, ".template-cover-*")
	if err != nil {
		return fmt.Errorf("创建系统模板封面临时文件失败: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return fmt.Errorf("写入系统模板封面失败: %w", err)
	}
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("设置系统模板封面权限失败: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("关闭系统模板封面临时文件失败: %w", err)
	}
	if err := os.Rename(temporaryPath, target); err != nil {
		return fmt.Errorf("保存系统模板封面失败: %w", err)
	}
	return nil
}
