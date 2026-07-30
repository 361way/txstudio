package app

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v2"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	Crypto   CryptoConfig   `yaml:"crypto"`
	Cache    CacheConfig    `yaml:"cache"`
	Agent    AgentConfig    `yaml:"agent"`
}

type ServerConfig struct {
	Port int    `yaml:"port"`
	Mode string `yaml:"mode"`
}

type DatabaseConfig struct {
	Path string `yaml:"path"`
}

type CryptoConfig struct {
	KeyFile string `yaml:"key_file"`
	AESKey  string `yaml:"-"`
}

type CacheConfig struct {
	Path string `yaml:"path"`
}

type AgentConfig struct {
	BaseURL string `yaml:"base_url"`
	APIKey  string `yaml:"-"`
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取配置文件失败: %w", err)
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("解析配置文件失败: %w", err)
	}

	if value := os.Getenv("VODSTUDIO_DB_PATH"); value != "" {
		cfg.Database.Path = value
	}
	if value := os.Getenv("VODSTUDIO_AES_KEY"); value != "" {
		cfg.Crypto.AESKey = value
	}
	if value := os.Getenv("VODSTUDIO_CACHE_DIR"); value != "" {
		cfg.Cache.Path = value
	}
	if value := os.Getenv("VODSTUDIO_AGENT_BASE_URL"); value != "" {
		cfg.Agent.BaseURL = value
	}
	cfg.Agent.APIKey = os.Getenv("VODSTUDIO_AGENT_API_KEY")
	if cfg.Agent.BaseURL == "" {
		cfg.Agent.BaseURL = "https://tokenhub.tencentmaas.com"
	}

	if cfg.Database.Path == "" {
		cfg.Database.Path = "./data/vodstudio.db"
	}
	if cfg.Crypto.KeyFile == "" {
		cfg.Crypto.KeyFile = filepath.Join(filepath.Dir(cfg.Database.Path), "secret.key")
	}
	if cfg.Cache.Path == "" {
		cfg.Cache.Path = filepath.Join(filepath.Dir(cfg.Database.Path), "cache")
	}
	if cfg.Crypto.AESKey == "" {
		cfg.Crypto.AESKey, err = loadOrCreateLocalKey(cfg.Crypto.KeyFile)
		if err != nil {
			return nil, err
		}
	}
	decodedKey, decodeErr := hex.DecodeString(cfg.Crypto.AESKey)
	if decodeErr != nil || len(decodedKey) != 32 {
		return nil, fmt.Errorf("VODSTUDIO_AES_KEY 必须是 64 字符的 hex 字符串")
	}
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Server.Mode == "" {
		cfg.Server.Mode = "debug"
	}
	return &cfg, nil
}

func loadOrCreateLocalKey(path string) (string, error) {
	if data, err := os.ReadFile(path); err == nil {
		return strings.TrimSpace(string(data)), nil
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("读取本地加密密钥失败: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", fmt.Errorf("创建密钥目录失败: %w", err)
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return "", fmt.Errorf("生成本地加密密钥失败: %w", err)
	}
	hexKey := hex.EncodeToString(key)
	if err := os.WriteFile(path, []byte(hexKey), 0o600); err != nil {
		return "", fmt.Errorf("保存本地加密密钥失败: %w", err)
	}
	return hexKey, nil
}
