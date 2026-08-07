package app

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"cnb.cool/txcloud/txstudio/backend/frontend"
	"cnb.cool/txcloud/txstudio/backend/internal/handler"
	"cnb.cool/txcloud/txstudio/backend/internal/model"
	"cnb.cool/txcloud/txstudio/backend/internal/seed"
	"cnb.cool/txcloud/txstudio/backend/internal/service"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type App struct {
	Config *Config
	DB     *gorm.DB
	Crypto *service.CryptoService
	Router *gin.Engine
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
	log.Printf("[server] TxStudio 本地服务启动: http://%s", addr)
	return a.Router.Run(addr)
}

func (a *App) registerRoutes() error {
	router := a.Router
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:5173", "http://127.0.0.1:5173"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"*"},
		ExposeHeaders:    []string{"*"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	projectHandler := &handler.ProjectHandler{DB: a.DB}
	generationHandler := &handler.GenerationHandler{DB: a.DB}
	imageTemplateHandler := &handler.ImageTemplateHandler{DB: a.DB}
	credentialHandler := &handler.CredentialHandler{DB: a.DB, Crypto: a.Crypto}
	proxyHandler := handler.NewProxyHandler(a.DB, a.Crypto)
	vodHandler := handler.NewVODInvokeHandler(a.DB, a.Crypto)
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
			generationJobs.GET("", generationHandler.List)
			generationJobs.POST("", generationHandler.Create)
			generationJobs.GET("/:id", generationHandler.Get)
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
