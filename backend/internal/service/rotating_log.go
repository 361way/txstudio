package service

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
)

// RotatingLogWriter 是轻量本地日志轮转器，不记录请求体或凭证内容。
type RotatingLogWriter struct {
	mu         sync.Mutex
	path       string
	maxBytes   int64
	maxBackups int
	file       *os.File
}

func NewRotatingLogWriter(path string, maxSizeMB, maxBackups int) (*RotatingLogWriter, error) {
	if maxSizeMB <= 0 {
		maxSizeMB = 20
	}
	if maxBackups <= 0 {
		maxBackups = 10
	}
	path = filepath.Clean(path)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("创建日志目录失败: %w", err)
	}
	writer := &RotatingLogWriter{path: path, maxBytes: int64(maxSizeMB) * 1024 * 1024, maxBackups: maxBackups}
	if err := writer.open(); err != nil {
		return nil, err
	}
	return writer, nil
}

func (w *RotatingLogWriter) open() error {
	file, err := os.OpenFile(w.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("打开日志文件失败: %w", err)
	}
	w.file = file
	return nil
}

func (w *RotatingLogWriter) rotate(incoming int) error {
	info, err := w.file.Stat()
	if err != nil || info.Size()+int64(incoming) <= w.maxBytes {
		return err
	}
	if err := w.file.Close(); err != nil {
		return err
	}
	_ = os.Remove(fmt.Sprintf("%s.%d", w.path, w.maxBackups))
	for index := w.maxBackups - 1; index >= 1; index-- {
		oldPath := fmt.Sprintf("%s.%d", w.path, index)
		newPath := fmt.Sprintf("%s.%d", w.path, index+1)
		_ = os.Rename(oldPath, newPath)
	}
	if err := os.Rename(w.path, w.path+".1"); err != nil && !os.IsNotExist(err) {
		return err
	}
	return w.open()
}

func (w *RotatingLogWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := w.rotate(len(data)); err != nil {
		return 0, err
	}
	return w.file.Write(data)
}

var _ io.Writer = (*RotatingLogWriter)(nil)
