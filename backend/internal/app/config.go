package app

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v2"
)

// Config 后端全量配置
type Config struct {
	Server  ServerConfig  `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	JWT     JWTConfig     `yaml:"jwt"`
	Crypto  CryptoConfig  `yaml:"crypto"`
	COS     COSConfig     `yaml:"cos"`
}

type ServerConfig struct {
	Port int    `yaml:"port"`
	Mode string `yaml:"mode"`
}

type DatabaseConfig struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
	DBName   string `yaml:"dbname"`
	Charset  string `yaml:"charset"`
}

func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=%s&parseTime=True&loc=Local",
		d.User, d.Password, d.Host, d.Port, d.DBName, d.Charset)
}

type JWTConfig struct {
	Secret     string        `yaml:"secret"`
	AccessTTL  time.Duration `yaml:"access_ttl"`
	RefreshTTL time.Duration `yaml:"refresh_ttl"`
}

type CryptoConfig struct {
	AESKey string `yaml:"aes_key"` // 32 字节 hex
}

type COSConfig struct {
	SecretID    string        `yaml:"secret_id"`
	SecretKey   string        `yaml:"secret_key"`
	Region      string        `yaml:"region"`
	Bucket      string        `yaml:"bucket"`
	COSPrefix   string        `yaml:"cos_prefix"`
	PresignTTL  time.Duration `yaml:"presign_ttl"`
}

// LoadConfig 从指定路径加载 YAML 配置，环境变量可覆盖敏感字段
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取配置文件失败: %w", err)
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("解析配置文件失败: %w", err)
	}

	// 环境变量覆盖（部署时便于注入密钥，符合安全规则 secrets-env-only）
	if v := os.Getenv("VODSTUDIO_DB_PASSWORD"); v != "" {
		cfg.Database.Password = v
	}
	if v := os.Getenv("VODSTUDIO_JWT_SECRET"); v != "" {
		cfg.JWT.Secret = v
	}
	if v := os.Getenv("VODSTUDIO_AES_KEY"); v != "" {
		cfg.Crypto.AESKey = v
	}
	if v := os.Getenv("VODSTUDIO_COS_SECRET_ID"); v != "" {
		cfg.COS.SecretID = v
	}
	if v := os.Getenv("VODSTUDIO_COS_SECRET_KEY"); v != "" {
		cfg.COS.SecretKey = v
	}

	// 校验必填项
	if cfg.JWT.Secret == "" {
		return nil, fmt.Errorf("jwt.secret 不能为空")
	}
	if cfg.Crypto.AESKey == "" || len(cfg.Crypto.AESKey) != 64 {
		return nil, fmt.Errorf("crypto.aes_key 必须为 64 字符的 hex 字符串 (32字节)")
	}
	if cfg.Database.Host == "" {
		cfg.Database.Host = "127.0.0.1"
	}
	if cfg.Database.Port == 0 {
		cfg.Database.Port = 3306
	}
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.JWT.AccessTTL == 0 {
		cfg.JWT.AccessTTL = 15 * time.Minute
	}
	if cfg.JWT.RefreshTTL == 0 {
		cfg.JWT.RefreshTTL = 168 * time.Hour
	}
	if cfg.COS.PresignTTL == 0 {
		cfg.COS.PresignTTL = 10 * time.Minute
	}
	return &cfg, nil
}
