package seed

import (
	"testing"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestEnsureSystemImageTemplatesImportsOnce(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:template-seed-test?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ImageTemplate{}); err != nil {
		t.Fatal(err)
	}

	if err := EnsureSystemImageTemplates(db); err != nil {
		t.Fatal(err)
	}
	var firstCount int64
	if err := db.Where("source = ?", systemTemplateSource).Model(&model.ImageTemplate{}).Count(&firstCount).Error; err != nil {
		t.Fatal(err)
	}
	if firstCount != 537 {
		t.Fatalf("expected 537 system templates, got %d", firstCount)
	}

	var original model.ImageTemplate
	if err := db.Where("source = ? AND source_key = ?", systemTemplateSource, "gpt2-case-1").First(&original).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&original).Update("name", "数据库维护后的名称").Error; err != nil {
		t.Fatal(err)
	}
	if err := EnsureSystemImageTemplates(db); err != nil {
		t.Fatal(err)
	}

	var finalCount int64
	if err := db.Where("source = ?", systemTemplateSource).Model(&model.ImageTemplate{}).Count(&finalCount).Error; err != nil {
		t.Fatal(err)
	}
	if finalCount != firstCount {
		t.Fatalf("seed duplicated templates: %d -> %d", firstCount, finalCount)
	}
	var maintained model.ImageTemplate
	if err := db.First(&maintained, original.ID).Error; err != nil {
		t.Fatal(err)
	}
	if maintained.Name != "数据库维护后的名称" {
		t.Fatalf("seed overwrote database-maintained template: %q", maintained.Name)
	}
}
