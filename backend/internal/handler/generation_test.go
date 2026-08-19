package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestGenerationListFiltersByProject(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:generation-project-filter?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.GenerationJob{}, &model.GenerationAsset{}, &model.GenerationEvent{}); err != nil {
		t.Fatal(err)
	}
	project11, project22 := uint(11), uint(22)
	jobs := []model.GenerationJob{
		{ClientID: "project-11-job", ProjectID: &project11, Source: "canvas", Type: "image", Status: "completed", Prompt: "项目十一", StorageMode: "Permanent"},
		{ClientID: "project-22-job", ProjectID: &project22, Source: "canvas", Type: "image", Status: "completed", Prompt: "项目二十二", StorageMode: "Permanent"},
	}
	if err := db.Create(&jobs).Error; err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/generation-jobs?project_id=11", nil)
	(&GenerationHandler{DB: db}).List(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if body := recorder.Body.String(); !containsAll(body, "项目十一") || containsAll(body, "项目二十二") {
		t.Fatalf("unexpected project-filtered response: %s", body)
	}
}

func TestGenerationListAssetsReturnsOnlyCompletedProjectImages(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:generation-project-assets?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.GenerationJob{}, &model.GenerationAsset{}); err != nil {
		t.Fatal(err)
	}
	project11, project22 := uint(11), uint(22)
	jobs := []model.GenerationJob{
		{ClientID: "assets-project-11", ProjectID: &project11, Source: "canvas", Type: "image", Status: "completed", StorageMode: "Permanent"},
		{ClientID: "assets-project-22", ProjectID: &project22, Source: "canvas", Type: "image", Status: "completed", StorageMode: "Permanent"},
		{ClientID: "assets-running-11", ProjectID: &project11, Source: "canvas", Type: "image", Status: "running", StorageMode: "Permanent"},
	}
	if err := db.Create(&jobs).Error; err != nil {
		t.Fatal(err)
	}
	assets := []model.GenerationAsset{
		{JobID: jobs[0].ID, Role: "output", Ordinal: 0, MediaType: "image", CloudURL: "https://example.com/project-11.png", StorageMode: "Permanent"},
		{JobID: jobs[1].ID, Role: "output", Ordinal: 0, MediaType: "image", CloudURL: "https://example.com/project-22.png", StorageMode: "Permanent"},
		{JobID: jobs[2].ID, Role: "output", Ordinal: 0, MediaType: "image", CloudURL: "https://example.com/running.png", StorageMode: "Permanent"},
		{JobID: jobs[0].ID, Role: "reference", Ordinal: 0, MediaType: "image", CloudURL: "https://example.com/reference.png", StorageMode: "Permanent"},
	}
	if err := db.Create(&assets).Error; err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/generation-jobs/assets?project_id=11", nil)
	(&GenerationHandler{DB: db}).ListAssets(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	if !containsAll(body, "project-11.png") || strings.Contains(body, "project-22.png") || strings.Contains(body, "running.png") || strings.Contains(body, "reference.png") {
		t.Fatalf("unexpected project assets response: %s", body)
	}
}

func TestGenerationListRejectsInvalidProjectID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:generation-invalid-project?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/generation-jobs?project_id=invalid", nil)
	(&GenerationHandler{DB: db}).List(context)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func containsAll(value string, fragments ...string) bool {
	for _, fragment := range fragments {
		if !strings.Contains(value, fragment) {
			return false
		}
	}
	return true
}
