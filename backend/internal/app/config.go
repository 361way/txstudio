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

const defaultAgentBaseURL = "https://tokenhub.tencentmaas.com"

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	Crypto   CryptoConfig   `yaml:"crypto"`
	Cache    CacheConfig    `yaml:"cache"`
	Logging  LoggingConfig  `yaml:"logging"`
	Agent    AgentConfig    `yaml:"agent"`
	DataDir  string         `yaml:"-"`
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

type LoggingConfig struct {
	Path       string `yaml:"path"`
	MaxSizeMB  int    `yaml:"max_size_mb"`
	MaxBackups int    `yaml:"max_backups"`
}

type AgentConfig struct {
	BaseURL string `yaml:"base_url"`
	APIKey  string `yaml:"-"`
}

// DefaultDataDir 返回当前操作系统的用户级数据目录。最终二进制无需配置文件，
// 首次运行会在该目录自动创建数据库、密钥、缓存和日志。
func DefaultDataDir() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(root) == "" {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil || strings.TrimSpace(home) == "" {
			return "", fmt.Errorf("无法确定 TxStudio 用户数据目录")
		}
		root = filepath.Join(home, ".config")
	}
	return filepath.Join(root, "TxStudio"), nil
}

func absolutePath(path, baseDir string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", nil
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(baseDir, path)
	}
	return filepath.Abs(filepath.Clean(path))
}

// LoadConfig 加载可选 YAML 配置。configPath 为空时直接使用内置默认值；
// dataDir 非空时统一覆盖所有运行数据路径，适合便携运行和自动化测试。
func LoadConfig(configPath, dataDir string) (*Config, error) {
	cfg := Config{
		Server:  ServerConfig{Port: 8080, Mode: "release"},
		Logging: LoggingConfig{MaxSizeMB: 20, MaxBackups: 10},
		Agent:   AgentConfig{BaseURL: defaultAgentBaseURL},
	}

	workingDir, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("读取当前工作目录失败: %w", err)
	}
	configBaseDir := workingDir
	configPath = strings.TrimSpace(configPath)
	if configPath != "" {
		absoluteConfigPath, pathErr := absolutePath(configPath, workingDir)
		if pathErr != nil {
			return nil, fmt.Errorf("解析配置文件路径失败: %w", pathErr)
		}
		data, readErr := os.ReadFile(absoluteConfigPath)
		if readErr != nil {
			return nil, fmt.Errorf("读取配置文件失败: %w", readErr)
		}
		if unmarshalErr := yaml.Unmarshal(data, &cfg); unmarshalErr != nil {
			return nil, fmt.Errorf("解析配置文件失败: %w", unmarshalErr)
		}
		configBaseDir = filepath.Dir(absoluteConfigPath)
	}

	if strings.TrimSpace(dataDir) == "" {
		dataDir = strings.TrimSpace(os.Getenv("TXSTUDIO_DATA_DIR"))
	}
	if dataDir == "" && configPath == "" {
		dataDir, err = DefaultDataDir()
		if err != nil {
			return nil, err
		}
	}
	if dataDir != "" {
		dataDir, err = absolutePath(dataDir, workingDir)
		if err != nil {
			return nil, fmt.Errorf("解析数据目录失败: %w", err)
		}
		cfg.DataDir = dataDir
		cfg.Database.Path = filepath.Join(dataDir, "txstudio.db")
		cfg.Crypto.KeyFile = filepath.Join(dataDir, "secret.key")
		cfg.Cache.Path = filepath.Join(dataDir, "cache")
		cfg.Logging.Path = filepath.Join(dataDir, "logs", "txstudio.log")
	} else {
		cfg.Database.Path, err = absolutePath(cfg.Database.Path, configBaseDir)
		if err != nil {
			return nil, err
		}
		if cfg.Database.Path == "" {
			cfg.Database.Path = filepath.Join(configBaseDir, "data", "txstudio.db")
		}
		dataRoot := filepath.Dir(cfg.Database.Path)
		cfg.DataDir = dataRoot
		if cfg.Crypto.KeyFile == "" {
			cfg.Crypto.KeyFile = filepath.Join(dataRoot, "secret.key")
		} else {
			cfg.Crypto.KeyFile, err = absolutePath(cfg.Crypto.KeyFile, configBaseDir)
			if err != nil {
				return nil, err
			}
		}
		if cfg.Cache.Path == "" {
			cfg.Cache.Path = filepath.Join(dataRoot, "cache")
		} else {
			cfg.Cache.Path, err = absolutePath(cfg.Cache.Path, configBaseDir)
			if err != nil {
				return nil, err
			}
		}
		if cfg.Logging.Path == "" {
			cfg.Logging.Path = filepath.Join(dataRoot, "logs", "txstudio.log")
		} else {
			cfg.Logging.Path, err = absolutePath(cfg.Logging.Path, configBaseDir)
			if err != nil {
				return nil, err
			}
		}
	}

	// 环境变量均为可选高级覆盖项；最终二进制不依赖它们即可运行。
	if value := strings.TrimSpace(os.Getenv("TXSTUDIO_DB_PATH")); value != "" {
		cfg.Database.Path, err = absolutePath(value, workingDir)
		if err != nil {
			return nil, err
		}
	}
	if value := strings.TrimSpace(os.Getenv("TXSTUDIO_CACHE_DIR")); value != "" {
		cfg.Cache.Path, err = absolutePath(value, workingDir)
		if err != nil {
			return nil, err
		}
	}
	if value := strings.TrimSpace(os.Getenv("TXSTUDIO_LOG_PATH")); value != "" {
		cfg.Logging.Path, err = absolutePath(value, workingDir)
		if err != nil {
			return nil, err
		}
	}
	if value := strings.TrimSpace(os.Getenv("TXSTUDIO_AGENT_BASE_URL")); value != "" {
		cfg.Agent.BaseURL = value
	}
	cfg.Agent.APIKey = strings.TrimSpace(os.Getenv("TXSTUDIO_AGENT_API_KEY"))
	cfg.Crypto.AESKey = strings.TrimSpace(os.Getenv("TXSTUDIO_AES_KEY"))

	if cfg.Server.Port <= 0 || cfg.Server.Port > 65535 {
		cfg.Server.Port = 8080
	}
	if cfg.Server.Mode == "" {
		cfg.Server.Mode = "release"
	}
	if cfg.Agent.BaseURL == "" {
		cfg.Agent.BaseURL = defaultAgentBaseURL
	}
	if cfg.Logging.MaxSizeMB <= 0 {
		cfg.Logging.MaxSizeMB = 20
	}
	if cfg.Logging.MaxBackups <= 0 {
		cfg.Logging.MaxBackups = 10
	}
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return nil, fmt.Errorf("创建 TxStudio 数据目录失败: %w", err)
	}
	if cfg.Crypto.AESKey == "" {
		cfg.Crypto.AESKey, err = loadOrCreateLocalKey(cfg.Crypto.KeyFile)
		if err != nil {
			return nil, err
		}
	}
	decodedKey, decodeErr := hex.DecodeString(cfg.Crypto.AESKey)
	if decodeErr != nil || len(decodedKey) != 32 {
		return nil, fmt.Errorf("TXSTUDIO_AES_KEY 必须是 64 字符的 hex 字符串")
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
