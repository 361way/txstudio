package seed

import (
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestSystemTemplateAssetsMatchSeed(t *testing.T) {
	templates, err := loadSystemImageTemplates()
	if err != nil {
		t.Fatal(err)
	}

	const coverPrefix = "/file/cases/"
	assetNames := make(map[string]struct{})
	for _, template := range templates {
		if strings.HasPrefix(template.CoverURL, coverPrefix) {
			assetNames[strings.TrimPrefix(template.CoverURL, coverPrefix)] = struct{}{}
		}
	}
	if len(assetNames) != 537 {
		t.Fatalf("expected 537 system template covers, got %d", len(assetNames))
	}
	for name := range assetNames {
		if _, err := fs.Stat(systemTemplateAssets, path.Join("assets", "cases", name)); err != nil {
			t.Fatalf("embedded cover %q is missing: %v", name, err)
		}
	}
}

func TestCopySystemTemplateAssetPreservesExistingFile(t *testing.T) {
	casesDir := filepath.Join(t.TempDir(), "cases")
	if err := os.MkdirAll(casesDir, 0o700); err != nil {
		t.Fatal(err)
	}
	const name = "mens-editorial-portrait.png"
	if err := copySystemTemplateAsset(casesDir, name); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(filepath.Join(casesDir, name)); err != nil || info.Size() == 0 {
		t.Fatalf("embedded cover was not restored: %v", err)
	}
	if err := os.WriteFile(filepath.Join(casesDir, name), []byte("local replacement"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := copySystemTemplateAsset(casesDir, name); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(casesDir, name))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "local replacement" {
		t.Fatal("existing local cover was unexpectedly overwritten")
	}
}

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
