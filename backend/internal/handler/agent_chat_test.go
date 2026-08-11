package handler

import (
	"encoding/json"
	"testing"

	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"cnb.cool/txcloud/txstudio/backend/internal/service"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestAgentChatLoadsEncryptedTokenHubCredential(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Credential{}); err != nil {
		t.Fatal(err)
	}
	cryptoService, err := service.NewCryptoService("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	plaintext, _ := json.Marshal(map[string]any{
		"api_key":  "saved-tokenhub-key",
		"base_url": "https://example.com/",
	})
	encrypted, err := cryptoService.Encrypt(plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Credential{Provider: "tokenhub", EncryptedData: encrypted}).Error; err != nil {
		t.Fatal(err)
	}

	handler := NewAgentChatHandler(db, cryptoService, "environment-fallback", "https://fallback.example.com")
	apiKey, baseURL := handler.loadCredential()
	if apiKey != "saved-tokenhub-key" {
		t.Fatalf("api key = %q", apiKey)
	}
	if baseURL != "https://example.com" {
		t.Fatalf("base url = %q", baseURL)
	}
}
