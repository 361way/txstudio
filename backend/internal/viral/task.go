package viral

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// handleTaskResult 返回异步任务结果(前端轮询 GET /api/viral/tasks/:runId/result)。
// 与 content-studio 的 GET /api/logs/:runId/result 对齐。
func (a *ViralApp) handleTaskResult(c *gin.Context) {
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

// handleTaskLog 返回异步任务的运行日志(前端轮询 GET /api/viral/tasks/:runId/log)。
// 日志以行写入 taskDir()/<runId>.log,便于在生成中实时监测任务进度。
func (a *ViralApp) handleTaskLog(c *gin.Context) {
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
func appendTaskLog(runID, format string, args ...any) {
	line := fmt.Sprintf("[%s] %s", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
	log.Printf("[viral/task] %s %s", runID, line)
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

// ------------------------- 任务元数据持久化(重启恢复) -------------------------

// cloneTaskMeta 记录一个进行中的 MPS CloneViral 任务的持久化元数据。
// 进程重启后据此恢复轮询,避免"MPS 云端还在跑、本地结果永远拿不到"。
// 注意:meta 中绝不落密钥,只存任务标识与请求参数;凭证重启后重新从凭证库读取。
type cloneTaskMeta struct {
	RunID     string       `json:"runId"`
	TaskID    string       `json:"taskId"`
	CreatedAt time.Time    `json:"createdAt"`
	Request   cloneRequest `json:"request"`
}

// writeTaskMeta 持久化任务元数据(创建 MPS 任务成功后立即调用)。
func writeTaskMeta(meta cloneTaskMeta) error {
	if err := os.MkdirAll(taskDir(), 0o700); err != nil {
		return err
	}
	payload, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(taskDir(), meta.RunID+".meta.json"), payload, 0o600)
}

// loadTaskMetas 读取所有持久化的任务元数据(用于启动恢复)。
func loadTaskMetas() []cloneTaskMeta {
	entries, err := os.ReadDir(taskDir())
	if err != nil {
		return nil
	}
	var metas []cloneTaskMeta
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".meta.json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(taskDir(), entry.Name()))
		if err != nil {
			continue
		}
		var meta cloneTaskMeta
		if err := json.Unmarshal(data, &meta); err != nil || meta.RunID == "" || meta.TaskID == "" {
			continue
		}
		metas = append(metas, meta)
	}
	return metas
}

// removeTaskMeta 删除任务元数据(任务到达终态后调用,避免重复恢复)。
func removeTaskMeta(runID string) {
	_ = os.Remove(filepath.Join(taskDir(), runID+".meta.json"))
}

// taskHasResult 判断任务是否已写出结果/错误文件(已有则无需恢复)。
func taskHasResult(runID string) bool {
	_, err := os.Stat(filepath.Join(taskDir(), runID+".json"))
	return err == nil
}

// startTaskCleaner 定时清理过期的任务结果文件(默认 1 天前)。
func startTaskCleaner() {
	go func() {
		for {
			time.Sleep(6 * time.Hour)
			dir := taskDir()
			entries, err := os.ReadDir(dir)
			if err != nil {
				continue
			}
			cutoff := time.Now().Add(-24 * time.Hour)
			for _, entry := range entries {
				info, err := entry.Info()
				if err != nil {
					continue
				}
				if info.ModTime().Before(cutoff) {
					_ = os.Remove(filepath.Join(dir, entry.Name()))
				}
			}
		}
	}()
}
