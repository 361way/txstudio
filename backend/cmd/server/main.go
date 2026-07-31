package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"os/exec"
	"runtime"
	"time"

	"cnb.cool/txcloud/txstudio/backend/internal/app"
)

var (
	version   = "dev"
	commit    = "unknown"
	buildTime = "unknown"
)

func openBrowser(url string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", url)
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		command = exec.Command("xdg-open", url)
	}
	return command.Start()
}

func openBrowserWhenReady(address, url string) {
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		connection, err := net.DialTimeout("tcp", address, 300*time.Millisecond)
		if err == nil {
			_ = connection.Close()
			if err := openBrowser(url); err != nil {
				log.Printf("[browser] 无法自动打开浏览器，请手动访问 %s: %v", url, err)
			}
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	log.Printf("[browser] 服务未在预期时间内就绪，请手动访问 %s", url)
}

func main() {
	configPath := flag.String("config", "", "可选 YAML 配置文件路径")
	dataDir := flag.String("data-dir", "", "可选数据目录；默认使用操作系统用户配置目录")
	port := flag.Int("port", 0, "服务端口；默认 8080")
	openUI := flag.Bool("open", true, "启动后自动打开浏览器")
	showVersion := flag.Bool("version", false, "显示版本信息后退出")
	flag.Parse()

	if *showVersion {
		fmt.Printf("TxStudio %s (%s, %s)\n", version, commit, buildTime)
		return
	}

	cfg, err := app.LoadConfig(*configPath, *dataDir)
	if err != nil {
		log.Fatalf("[fatal] 加载配置失败: %v", err)
	}
	if *port > 0 {
		if *port > 65535 {
			log.Fatalf("[fatal] 端口必须在 1-65535 之间")
		}
		cfg.Server.Port = *port
	}

	a, err := app.NewApp(cfg)
	if err != nil {
		log.Fatalf("[fatal] 初始化应用失败: %v", err)
	}

	address := fmt.Sprintf("127.0.0.1:%d", cfg.Server.Port)
	url := "http://" + address
	log.Printf("[server] TxStudio %s", version)
	log.Printf("[server] 数据目录: %s", cfg.DataDir)
	if *openUI {
		go openBrowserWhenReady(address, url)
	}
	if err := a.Run(); err != nil {
		log.Fatalf("[fatal] 服务启动失败: %v", err)
	}
}
