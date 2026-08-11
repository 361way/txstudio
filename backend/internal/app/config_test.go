package app

import (
	"os"
	"path/filepath"
	"testing"
)

func clearConfigEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"TXSTUDIO_DATA_DIR", "TXSTUDIO_DB_PATH", "TXSTUDIO_AES_KEY",
		"TXSTUDIO_CACHE_DIR", "TXSTUDIO_LOG_PATH", "TXSTUDIO_AGENT_BASE_URL",
		"TXSTUDIO_AGENT_API_KEY",
	} {
		t.Setenv(key, "")
	}
}

func TestLoadConfigWithoutYAMLInitializesStandaloneData(t *testing.T) {
	clearConfigEnvironment(t)
	dataDir := filepath.Join(t.TempDir(), "standalone-data")
	cfg, err := LoadConfig("", dataDir)
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}

	checks := map[string]string{
		"data dir": cfg.DataDir,
		"database": cfg.Database.Path,
		"key":      cfg.Crypto.KeyFile,
		"cache":    cfg.Cache.Path,
		"log":      cfg.Logging.Path,
	}
	for label, value := range checks {
		if !filepath.IsAbs(value) {
			t.Fatalf("%s path is not absolute: %q", label, value)
		}
	}
	if cfg.Database.Path != filepath.Join(dataDir, "txstudio.db") {
		t.Fatalf("database path = %q", cfg.Database.Path)
	}
	if cfg.Server.Port != 8080 || cfg.Server.Mode != "release" {
		t.Fatalf("unexpected server defaults: %+v", cfg.Server)
	}
	if _, err := os.Stat(cfg.Crypto.KeyFile); err != nil {
		t.Fatalf("key file was not created: %v", err)
	}
	if decoded := len(cfg.Crypto.AESKey); decoded != 64 {
		t.Fatalf("AES key length = %d", decoded)
	}
}

func TestLoadConfigExplicitMissingFileFails(t *testing.T) {
	clearConfigEnvironment(t)
	_, err := LoadConfig(filepath.Join(t.TempDir(), "missing.yaml"), "")
	if err == nil {
		t.Fatal("expected explicit missing config to fail")
	}
}

func TestLoadConfigDataDirOverridesYAMLPaths(t *testing.T) {
	clearConfigEnvironment(t)
	root := t.TempDir()
	configPath := filepath.Join(root, "config.yaml")
	if err := os.WriteFile(configPath, []byte("database:\n  path: ./legacy.db\nserver:\n  port: 9090\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	portableDir := filepath.Join(root, "portable")
	cfg, err := LoadConfig(configPath, portableDir)
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}
	if cfg.Database.Path != filepath.Join(portableDir, "txstudio.db") {
		t.Fatalf("database path = %q", cfg.Database.Path)
	}
	if cfg.Server.Port != 9090 {
		t.Fatalf("server port = %d", cfg.Server.Port)
	}
}
