package app

import (
	"fmt"
	"io"
	"log"
	"os"
	"sync/atomic"
	"time"

	"cnb.cool/txcloud/txstudio/backend/internal/service"
	"github.com/gin-gonic/gin"
)

var requestSequence atomic.Uint64

// cstZone 为东八区（UTC+8），统一作为日志时间戳时区。
var cstZone = time.FixedZone("CST", 8*3600)

// timestampWriter 在每条日志前添加东八区时间戳。
type timestampWriter struct {
	w    io.Writer
	zone *time.Location
}

func (t *timestampWriter) Write(p []byte) (int, error) {
	ts := time.Now().In(t.zone).Format("2006-01-02 15:04:05")
	line := fmt.Sprintf("[%s +08:00] %s", ts, p)
	return t.w.Write([]byte(line))
}

func configureApplicationLog(cfg LoggingConfig) error {
	writer, err := service.NewRotatingLogWriter(cfg.Path, cfg.MaxSizeMB, cfg.MaxBackups)
	if err != nil {
		return err
	}
	base := io.MultiWriter(os.Stdout, writer)
	output := &timestampWriter{w: base, zone: cstZone}
	log.SetOutput(output)
	log.SetFlags(0)
	gin.DefaultWriter = output
	gin.DefaultErrorWriter = output
	return nil
}

// requestLogMiddleware 只记录方法、路由、状态和耗时，不记录查询串、请求体或鉴权信息。
func requestLogMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		startedAt := time.Now()
		requestID := fmt.Sprintf("%x-%x", startedAt.UnixMilli(), requestSequence.Add(1))
		c.Header("X-Request-ID", requestID)
		c.Set("request_id", requestID)
		c.Next()
		log.Printf("[http] request_id=%s method=%s path=%s status=%d duration_ms=%d", requestID, c.Request.Method, c.Request.URL.Path, c.Writer.Status(), time.Since(startedAt).Milliseconds())
	}
}
