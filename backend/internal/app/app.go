package app

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"cnb.cool/txcloud/txstudio/backend/frontend"
	"cnb.cool/txcloud/txstudio/backend/internal/handler"
	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"cnb.cool/txcloud/txstudio/backend/internal/seed"
	"cnb.cool/txcloud/txstudio/backend/internal/service"
	"cnb.cool/txcloud/txstudio/backend/internal/translate"
	"cnb.cool/txcloud/txstudio/backend/internal/viral"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type App struct {
	Config            *Config
	DB                *gorm.DB
	Crypto            *service.CryptoService
	Router            *gin.Engine
	GenerationHandler *handler.GenerationHandler
}

func NewApp(cfg *Config) (*App, error) {
	if err := configureApplicationLog(cfg.Logging); err != nil {
		return nil, err
	}
	db, err := NewDB(cfg.Database)
	if err != nil {
		return nil, err
	}
	if err := model.AutoMigrateAll(db); err != nil {
		return nil, err
	}
	if err := seed.EnsureSystemImageTemplates(db); err != nil {
		return nil, err
	}
	if err := seed.EnsureSystemTemplateAssets(cfg.Cache.Path); err != nil {
		return nil, err
	}
	cryptoSvc, err := service.NewCryptoService(cfg.Crypto.AESKey)
	if err != nil {
		return nil, err
	}

	gin.SetMode(cfg.Server.Mode)
	router := gin.New()
	router.Use(gin.Recovery(), requestLogMiddleware())
	app := &App{Config: cfg, DB: db, Crypto: cryptoSvc, Router: router}
	if err := app.registerRoutes(); err != nil {
		return nil, err
	}
	return app, nil
}

func (a *App) Run() error {
	addr := fmt.Sprintf("127.0.0.1:%d", a.Config.Server.Port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	return a.Serve(listener)
}

// Serve 使用已成功绑定的监听器启动服务，避免端口被旧进程占用时误打开其他服务页面。
func (a *App) Serve(listener net.Listener) error {
	log.Printf("[server] TxStudio 本地服务启动: http://%s", listener.Addr().String())
	a.GenerationHandler.StartCloudSyncLoop()
	return a.Router.RunListener(listener)
}

func isAllowedLocalUIOrigin(origin string, serverPort int) bool {
	parsed, err := url.Parse(strings.TrimSpace(origin))
	if err != nil || parsed.Scheme != "http" || parsed.User != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "localhost" && host != "127.0.0.1" {
		return false
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil || port <= 0 || port > 65535 {
		return false
	}
	// 仅允许当前单二进制自身的同源页面；开发服务器来源仅在 debug 模式下启用。
	return port == serverPort
}

func localCORSConfig(serverPort int, mode string) cors.Config {
	return cors.Config{
		AllowOriginFunc: func(origin string) bool {
			if isAllowedLocalUIOrigin(origin, serverPort) {
				return true
			}
			return strings.EqualFold(mode, gin.DebugMode) && isAllowedLocalUIOrigin(origin, 5173)
		},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"*"},
		ExposeHeaders:    []string{"*"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}
}

func (a *App) registerRoutes() error {
	router := a.Router
	router.Use(cors.New(localCORSConfig(a.Config.Server.Port, a.Config.Server.Mode)))

	projectHandler := &handler.ProjectHandler{DB: a.DB}
	imageTemplateHandler := &handler.ImageTemplateHandler{DB: a.DB}
	credentialHandler := &handler.CredentialHandler{DB: a.DB, Crypto: a.Crypto}
	proxyHandler := handler.NewProxyHandler(a.DB, a.Crypto)
	vodHandler := handler.NewVODInvokeHandler(a.DB, a.Crypto)
	generationHandler := &handler.GenerationHandler{DB: a.DB, VOD: vodHandler}
	a.GenerationHandler = generationHandler
	mpsHandler := handler.NewMPSInvokeHandler(a.DB, a.Crypto)
	agentChatHandler := handler.NewAgentChatHandler(a.DB, a.Crypto, a.Config.Agent.APIKey, a.Config.Agent.BaseURL)
	mpsAssetHandler := &handler.MPSAssetHandler{DB: a.DB, Crypto: a.Crypto}
	localHandler, err := handler.NewLocalServiceHandler(a.Config.Cache.Path)
	if err != nil {
		return fmt.Errorf("初始化本地缓存失败: %w", err)
	}

	// 本地服务兼容接口：替代历史上的 9527 独立代理进程。
	router.GET("/health", localHandler.Ping)
	router.GET("/ping", localHandler.Ping)
	router.GET("/config", localHandler.Config)
	router.POST("/config", localHandler.Config)
	router.GET("/list-files", localHandler.ListFiles)
	router.POST("/save-cache", localHandler.SaveCache)
	router.GET("/file/*path", localHandler.File)
	router.Any("/proxy", proxyHandler.QueryProxy)

	api := router.Group("/api")
	{
		projects := api.Group("/projects")
		{
			projects.GET("", projectHandler.List)
			projects.POST("", projectHandler.Create)
			projects.GET("/:id", projectHandler.Get)
			projects.PUT("/:id", projectHandler.Update)
			projects.DELETE("/:id", projectHandler.Delete)
			projects.PUT("/:id/canvas", projectHandler.SaveCanvas)
			projects.GET("/:id/canvas", projectHandler.GetCanvas)
			projects.GET("/:id/history", projectHandler.ListHistory)
			projects.POST("/:id/history", projectHandler.CreateHistory)
			projects.PUT("/:id/history", projectHandler.ReplaceHistory)
			projects.DELETE("/:id/history", projectHandler.DeleteHistory)
		}

		credentials := api.Group("/credentials")
		{
			credentials.GET("", credentialHandler.List)
			credentials.POST("", credentialHandler.Save)
			credentials.DELETE("/:id", credentialHandler.Delete)
		}

		generationJobs := api.Group("/generation-jobs")
		{
			generationJobs.GET("/assets", generationHandler.ListAssets)
			generationJobs.POST("/sync", generationHandler.SyncPending)
			generationJobs.POST("/import-vod-task", generationHandler.ImportVODTask)
			generationJobs.GET("", generationHandler.List)
			generationJobs.POST("", generationHandler.Create)
			generationJobs.GET("/:id", generationHandler.Get)
			generationJobs.POST("/:id/sync", generationHandler.Sync)
			generationJobs.PUT("/:id", generationHandler.Update)
			generationJobs.DELETE("/:id", generationHandler.Delete)
		}

		imageTemplates := api.Group("/image-templates")
		{
			imageTemplates.GET("", imageTemplateHandler.List)
			imageTemplates.POST("", imageTemplateHandler.Create)
			imageTemplates.PUT("/:id", imageTemplateHandler.Update)
			imageTemplates.DELETE("/:id", imageTemplateHandler.Delete)
		}

		api.POST("/proxy", proxyHandler.Proxy)
		api.PUT("/cos-put", proxyHandler.COSPut)
		api.POST("/vod/invoke", vodHandler.Invoke)
		api.POST("/mps/invoke", mpsHandler.Invoke)
		api.POST("/agent/chat", agentChatHandler.Chat)
		api.POST("/mps/assets", mpsAssetHandler.Upload)
		api.POST("/mps/assets/from-url", mpsAssetHandler.UploadFromURL)
		api.GET("/mps/assets/output", mpsAssetHandler.Output)

		// 独立功能模块：不影响既有画布与项目路由。
		viral.Register(api, viral.NewViralApp(a.DB, a.Crypto))
		translate.Register(api, translate.NewTranslateApp(a.DB, a.Crypto))
	}

	router.NoRoute(func(c *gin.Context) {
		if len(c.Request.URL.Path) >= 4 && c.Request.URL.Path[:4] == "/api" {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		// 单文件首页不允许缓存，确保浏览器总能拿到最新前端构建。
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Header("Pragma", "no-cache")
		c.Header("Expires", "0")
		c.Data(http.StatusOK, "text/html; charset=utf-8", frontend.IndexHTML)
	})
	return nil
}
