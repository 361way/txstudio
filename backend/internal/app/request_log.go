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

func configureApplicationLog(cfg LoggingConfig) error {
	writer, err := service.NewRotatingLogWriter(cfg.Path, cfg.MaxSizeMB, cfg.MaxBackups)
	if err != nil {
		return err
	}
	output := io.MultiWriter(os.Stdout, writer)
	log.SetOutput(output)
	log.SetFlags(log.Ldate | log.Ltime | log.LUTC)
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
