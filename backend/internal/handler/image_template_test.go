package handler

import "testing"

func TestNormalizeImageTemplateRequest(t *testing.T) {
	template, message := normalizeTemplateRequest(imageTemplateRequest{
		Name: "商业肖像", Category: "portrait", Prompt: "电影感商业肖像",
		ModelName: "Kling", ModelVersion: "3.0", Ratio: "3:4", Resolution: "2K",
		EnhancePrompt: "Enabled", StorageMode: "Permanent", Accent: "amber",
		CoverURL: "https://example.com/cover.png",
	})
	if message != "" {
		t.Fatalf("unexpected validation error: %s", message)
	}
	if template.Name != "商业肖像" || template.StorageMode != "Permanent" {
		t.Fatalf("unexpected template: %+v", template)
	}
}

func TestNormalizeImageTemplateRejectsUnsafeCover(t *testing.T) {
	_, message := normalizeTemplateRequest(imageTemplateRequest{
		Name: "测试", Category: "portrait", Prompt: "测试提示词",
		ModelName: "Kling", ModelVersion: "3.0", CoverURL: "javascript:alert(1)",
	})
	if message == "" {
		t.Fatal("expected unsafe cover URL to be rejected")
	}
}

func TestNormalizeImageTemplateDefaults(t *testing.T) {
	template, message := normalizeTemplateRequest(imageTemplateRequest{
		Name: "测试", Category: "custom", Prompt: "测试提示词",
		ModelName: "OG", ModelVersion: "image2_low",
	})
	if message != "" {
		t.Fatal(message)
	}
	if template.EnhancePrompt != "Enabled" || template.StorageMode != "Permanent" || template.Accent != "amber" {
		t.Fatalf("defaults not applied: %+v", template)
	}
}
