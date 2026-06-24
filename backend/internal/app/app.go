package app

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/vodstudio/backend/frontend"
	"github.com/vodstudio/backend/internal/handler"
	"github.com/vodstudio/backend/internal/middleware"
	"github.com/vodstudio/backend/internal/model"
	"github.com/vodstudio/backend/internal/service"
	"gorm.io/gorm"
)

// App 应用容器
type App struct {
	Config *Config
	DB     *gorm.DB
	JWT    *service.JWTService
	Crypto *service.CryptoService
	COS    *service.COSService
	Router *gin.Engine
}

// NewApp 初始化应用
func NewApp(cfg *Config) (*App, error) {
	db, err := NewDB(cfg.Database)
	if err != nil {
		return nil, err
	}
	if err := model.AutoMigrateAll(db); err != nil {
		return nil, err
	}
	if err := model.SeedPlans(db); err != nil {
		log.Printf("[warn] 种子套餐写入失败: %v", err)
	}

	jwtSvc := service.NewJWTService(cfg.JWT.Secret, cfg.JWT.AccessTTL, cfg.JWT.RefreshTTL)
	cryptoSvc, err := service.NewCryptoService(cfg.Crypto.AESKey)
	if err != nil {
		return nil, err
	}

	var cosSvc *service.COSService
	if cfg.COS.SecretID != "" && cfg.COS.Bucket != "" {
		cosSvc, err = service.NewCOSService(
			cfg.COS.SecretID, cfg.COS.SecretKey, cfg.COS.Region,
			cfg.COS.Bucket, cfg.COS.COSPrefix, cfg.COS.PresignTTL,
		)
		if err != nil {
			log.Printf("[warn] COS 初始化失败（资产功能不可用）: %v", err)
		}
	}

	gin.SetMode(cfg.Server.Mode)
	r := gin.Default()

	a := &App{Config: cfg, DB: db, JWT: jwtSvc, Crypto: cryptoSvc, COS: cosSvc, Router: r}
	a.registerRoutes()
	return a, nil
}

// Run 启动 HTTP 服务
func (a *App) Run() error {
	addr := fmt.Sprintf(":%d", a.Config.Server.Port)
	log.Printf("[server] VodStudio SaaS 后端启动: http://0.0.0.0%s", addr)
	return a.Router.Run(addr)
}

func (a *App) registerRoutes() {
	r := a.Router

	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"*"},
		ExposeHeaders:    []string{"*"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "service": "vodstudio-saas"})
	})

	authH := &handler.AuthHandler{DB: a.DB, JWT: a.JWT}
	projectH := &handler.ProjectHandler{DB: a.DB}
	credH := &handler.CredentialHandler{DB: a.DB, Crypto: a.Crypto}
	assetH := &handler.AssetHandler{DB: a.DB, COS: a.COS}
	billingH := &handler.BillingHandler{DB: a.DB}
	proxyH := handler.NewProxyHandler()

	api := r.Group("/api")
	{
		auth := api.Group("/auth")
		{
			auth.POST("/register", authH.Register)
			auth.POST("/login", authH.Login)
			auth.POST("/refresh", authH.Refresh)
		}

		authed := api.Group("")
		authed.Use(middleware.AuthRequired(a.JWT))
		{
			authed.GET("/auth/me", authH.Me)

			billing := authed.Group("/billing")
			{
				billing.GET("/plans", billingH.Plans)
				billing.GET("/subscription", billingH.Subscription)
				billing.POST("/subscribe", billingH.Subscribe)
				billing.GET("/usage", billingH.Usage)
			}

			projects := authed.Group("/projects")
			{
				projects.GET("", projectH.List)
				projects.POST("", projectH.Create)
				projects.GET("/:id", projectH.Get)
				projects.PUT("/:id", projectH.Update)
				projects.DELETE("/:id", projectH.Delete)
				projects.PUT("/:id/canvas", projectH.SaveCanvas)
				projects.GET("/:id/canvas", projectH.GetCanvas)
				projects.GET("/:id/history", projectH.ListHistory)
				projects.POST("/:id/history", projectH.CreateHistory)
			}

			assets := authed.Group("/assets")
			{
				assets.POST("/upload-url", assetH.UploadURL)
				assets.POST("", assetH.Register)
				assets.GET("/:id", assetH.Get)
			}

			creds := authed.Group("/credentials")
			{
				creds.GET("", credH.List)
				creds.POST("", credH.Save)
				creds.DELETE("/:id", credH.Delete)
			}

			proxyGroup := authed.Group("")
			proxyGroup.Use(middleware.QuotaCheck(a.DB, "proxy"))
			{
				proxyGroup.POST("/proxy", proxyH.Proxy)
				proxyGroup.POST("/cos-put", proxyH.COSPut)
			}
		}
	}

	// 前端静态文件托管（内嵌 embed，无需外部文件）
	// SPA fallback：所有非 /api、非 /health 的 GET 请求都返回 index.html
	r.NoRoute(func(c *gin.Context) {
		if len(c.Request.URL.Path) >= 4 && c.Request.URL.Path[:4] == "/api" {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", frontend.IndexHTML)
	})
}
