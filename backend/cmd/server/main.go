package main

import (
	"flag"
	"log"

	"github.com/vodstudio/backend/internal/app"
)

func main() {
	configPath := flag.String("config", "config.yaml", "配置文件路径")
	flag.Parse()

	cfg, err := app.LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("[fatal] 加载配置失败: %v", err)
	}

	a, err := app.NewApp(cfg)
	if err != nil {
		log.Fatalf("[fatal] 初始化应用失败: %v", err)
	}

	if err := a.Run(); err != nil {
		log.Fatalf("[fatal] 服务启动失败: %v", err)
	}
}
