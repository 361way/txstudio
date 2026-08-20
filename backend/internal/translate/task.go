package translate

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// handleTaskResult 返回异步任务结果(前端轮询 GET /api/translate/tasks/:runId/result)。
func (a *TranslateApp) handleTaskResult(c *gin.Context) {
	runID := c.Param("runId")
	if runID == "" {
		Fail(c, http.StatusBadRequest, "缺少 runId")
		return
	}
	// 限制 runID 只允许安全字符,防路径穿越
	for _, r := range runID {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_') {
			Fail(c, http.StatusBadRequest, "runId 无效")
			return
		}
	}
	path := filepath.Join(taskDir(), runID+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		// 未就绪
		c.JSON(http.StatusOK, gin.H{"ready": false})
		return
	}
	c.Header("Content-Type", "application/json")
	c.Writer.WriteHeader(http.StatusOK)
	_, _ = c.Writer.Write(data)
}

// handleTaskLog 返回异步任务的运行日志(前端轮询 GET /api/translate/tasks/:runId/log)。
// 日志以行写入 taskDir()/<runId>.log,便于在生成中实时监测任务进度。
func (a *TranslateApp) handleTaskLog(c *gin.Context) {
	runID := c.Param("runId")
	if runID == "" {
		Fail(c, http.StatusBadRequest, "缺少 runId")
		return
	}
	for _, r := range runID {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_') {
			Fail(c, http.StatusBadRequest, "runId 无效")
			return
		}
	}
	data, err := os.ReadFile(filepath.Join(taskDir(), runID+".log"))
	if err != nil {
		// 还没有日志
		OK(c, gin.H{"runId": runID, "logs": []string{}})
		return
	}
	raw := strings.TrimRight(string(data), "\n")
	var lines []string
	if raw != "" {
		lines = strings.Split(raw, "\n")
	}
	OK(c, gin.H{"runId": runID, "logs": lines})
}

// appendTaskLog 向任务日志文件追加一行(同时输出到服务日志),供前端轮询展示。
// startTaskCleaner 定时清理过期的视频译制任务结果与日志，避免临时目录持续增长。
func startTaskCleaner() {
	go func() {
		for {
			time.Sleep(6 * time.Hour)
			entries, err := os.ReadDir(taskDir())
			if err != nil {
				continue
			}
			cutoff := time.Now().Add(-24 * time.Hour)
			for _, entry := range entries {
				info, err := entry.Info()
				if err == nil && info.ModTime().Before(cutoff) {
					_ = os.Remove(filepath.Join(taskDir(), entry.Name()))
				}
			}
		}
	}()
}

func appendTaskLog(runID, format string, args ...any) {
	line := fmt.Sprintf("[%s] %s", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
	log.Printf("[translate/task] %s %s", runID, line)
	if err := os.MkdirAll(taskDir(), 0o700); err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(taskDir(), runID+".log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.WriteString(line + "\n")
}
