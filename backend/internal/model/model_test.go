package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

type legacyImageTemplate struct {
	Base
	Source         string `gorm:"size:16;index;not null;default:user"`
	SourceKey      string `gorm:"size:160;index"`
	SourceName     string `gorm:"size:120"`
	SourceURL      string `gorm:"size:2048"`
	SortOrder      int    `gorm:"index;not null;default:0"`
	IsPublished    bool   `gorm:"index;not null;default:true"`
	Name           string `gorm:"size:120;not null"`
	Category       string `gorm:"size:64;index;not null"`
	Description    string `gorm:"size:500"`
	Prompt         string `gorm:"type:text;not null"`
	PromptZH       string `gorm:"type:text"`
	PromptEN       string `gorm:"type:text"`
	PromptLanguage string `gorm:"size:16"`
	ModelName      string `gorm:"size:128;not null"`
	ModelVersion   string `gorm:"size:128;not null"`
	Ratio          string `gorm:"size:32"`
	Resolution     string `gorm:"size:32"`
	EnhancePrompt  string `gorm:"size:16;not null;default:Enabled"`
	StorageMode    string `gorm:"size:16;not null;default:Temporary"`
	Accent         string `gorm:"size:32;not null;default:amber"`
	CoverURL       string `gorm:"size:2048"`
}

func (legacyImageTemplate) TableName() string {
	return "image_templates"
}

func TestAutoMigrateAllRemovesRetiredImageTemplateColumns(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:image-template-column-migration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&legacyImageTemplate{}); err != nil {
		t.Fatal(err)
	}
	legacy := legacyImageTemplate{
		Source: "system", SourceKey: "legacy-template", SourceName: "retired source", SourceURL: "https://example.com",
		Name: "保留模板", Category: "portrait", Prompt: "保留的提示词", ModelName: "Kling", ModelVersion: "3.0",
		EnhancePrompt: "Enabled", StorageMode: "Temporary", Accent: "amber",
	}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}

	if err := AutoMigrateAll(db); err != nil {
		t.Fatal(err)
	}
	for _, column := range []string{"source_name", "source_url"} {
		if db.Migrator().HasColumn(&ImageTemplate{}, column) {
			t.Fatalf("retired column %q still exists", column)
		}
	}

	var migrated ImageTemplate
	if err := db.First(&migrated, legacy.ID).Error; err != nil {
		t.Fatal(err)
	}
	if migrated.Source != legacy.Source || migrated.SourceKey != legacy.SourceKey || migrated.Name != legacy.Name || migrated.Prompt != legacy.Prompt {
		t.Fatalf("template data changed during migration: %+v", migrated)
	}
	if err := AutoMigrateAll(db); err != nil {
		t.Fatalf("migration is not idempotent: %v", err)
	}
}
