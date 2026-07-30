package handler

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// LocalServiceHandler 提供旧独立代理进程中的本地缓存能力，统一由 8080 后端承载。
type LocalServiceHandler struct {
	cacheRoot string
	mu        sync.RWMutex
	config    map[string]any
}

var safePathSegment = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func NewLocalServiceHandler(cacheRoot string) (*LocalServiceHandler, error) {
	root, err := filepath.Abs(cacheRoot)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	return &LocalServiceHandler{
		cacheRoot: root,
		config: map[string]any{
			"save_path":          root,
			"image_save_path":    filepath.Join(root, "history"),
			"video_save_path":    filepath.Join(root, "history"),
			"convert_png_to_jpg": false,
			"jpg_quality":        95,
			"pil_available":      false,
		},
	}, nil
}

func (h *LocalServiceHandler) Ping(c *gin.Context) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	payload := gin.H{"status": "ok", "time": time.Now().UTC().Format(time.RFC3339Nano)}
	for key, value := range h.config {
		payload[key] = value
	}
	c.JSON(http.StatusOK, payload)
}

func (h *LocalServiceHandler) Config(c *gin.Context) {
	if c.Request.Method == http.MethodPost {
		var patch map[string]any
		if err := c.ShouldBindJSON(&patch); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "配置格式无效"})
			return
		}
		h.mu.Lock()
		for key, value := range patch {
			h.config[key] = value
		}
		h.mu.Unlock()
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"success": true, "config": h.config})
}

func (h *LocalServiceHandler) ListFiles(c *gin.Context) {
	files := make([]string, 0)
	_ = filepath.WalkDir(h.cacheRoot, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		if rel, relErr := filepath.Rel(h.cacheRoot, path); relErr == nil {
			files = append(files, filepath.ToSlash(rel))
		}
		return nil
	})
	c.JSON(http.StatusOK, gin.H{"files": files})
}

type saveCacheReq struct {
	ID       string `json:"id"`
	Content  string `json:"content" binding:"required"`
	Category string `json:"category"`
	Ext      string `json:"ext"`
	Type     string `json:"type"`
}

func (h *LocalServiceHandler) SaveCache(c *gin.Context) {
	var req saveCacheReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缓存内容无效"})
		return
	}
	category := sanitizeCacheSegment(req.Category, "history")
	id := sanitizeCacheSegment(req.ID, fmt.Sprintf("cache-%d", time.Now().UnixMilli()))
	ext := sanitizeCacheSegment(strings.TrimPrefix(req.Ext, "."), "jpg")
	if ext == "jpg" && req.Type == "video" {
		ext = "mp4"
	}
	content, err := decodeCacheContent(req.Content)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缓存内容解码失败"})
		return
	}
	relPath := filepath.ToSlash(filepath.Join(category, id+"."+ext))
	outputPath := filepath.Join(h.cacheRoot, filepath.FromSlash(relPath))
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o700); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "创建缓存目录失败"})
		return
	}
	if err := os.WriteFile(outputPath, content, 0o600); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "保存缓存失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"url":     "/file/" + encodeCachePath(relPath),
		"path":    outputPath,
		"relPath": relPath,
	})
}

func (h *LocalServiceHandler) File(c *gin.Context) {
	rel, err := url.PathUnescape(strings.TrimPrefix(c.Param("path"), "/"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件路径无效"})
		return
	}
	target := filepath.Clean(filepath.Join(h.cacheRoot, filepath.FromSlash(rel)))
	if target != h.cacheRoot && !strings.HasPrefix(target, h.cacheRoot+string(os.PathSeparator)) {
		c.JSON(http.StatusForbidden, gin.H{"error": "禁止访问"})
		return
	}
	c.File(target)
}

func sanitizeCacheSegment(value, fallback string) string {
	raw := strings.ReplaceAll(strings.ReplaceAll(value, "\\", "-"), "/", "-")
	safe := strings.Trim(safePathSegment.ReplaceAllString(raw, "-"), "-")
	if len(safe) > 120 {
		safe = safe[:120]
	}
	if safe == "" {
		return fallback
	}
	return safe
}

func decodeCacheContent(content string) ([]byte, error) {
	if !strings.HasPrefix(content, "data:") {
		return []byte(content), nil
	}
	parts := strings.SplitN(content, ",", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid data url")
	}
	if strings.Contains(parts[0], ";base64") {
		return base64.StdEncoding.DecodeString(parts[1])
	}
	decoded, err := url.QueryUnescape(parts[1])
	return []byte(decoded), err
}

func encodeCachePath(rel string) string {
	parts := strings.Split(filepath.ToSlash(rel), "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}
