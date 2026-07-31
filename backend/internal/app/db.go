package app

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// NewDB 建立本地 SQLite 连接。WAL 模式允许界面读取与后台保存并发进行。
func NewDB(cfg DatabaseConfig) (*gorm.DB, error) {
	path := filepath.Clean(cfg.Path)
	if dir := filepath.Dir(path); dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, fmt.Errorf("创建数据库目录失败: %w", err)
		}
	}

	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite 数据库失败: %w", err)
	}
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
	} {
		if result := db.Exec(pragma); result.Error != nil {
			return nil, fmt.Errorf("配置 SQLite 失败: %w", result.Error)
		}
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	// SQLite 单写者模型下限制连接数，避免写锁竞争。
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetMaxOpenConns(1)

	log.Printf("[db] SQLite 已连接: %s", path)
	return db, nil
}
