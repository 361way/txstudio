#!/bin/bash
# VodStudio SaaS 一体化构建脚本
# 产出：单个二进制（内嵌前端）+ config.yaml
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

echo "==> 1/3 构建前端..."
cd "$ROOT_DIR"
npm run build

echo "==> 2/3 复制前端产物到后端 embed 目录..."
cp dist/index.html "$BACKEND_DIR/frontend/dist/index.html"

echo "==> 3/3 编译后端（内嵌前端）..."
cd "$BACKEND_DIR"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o vodstudio-server cmd/server/main.go

echo ""
echo "构建完成！部署只需以下文件："
echo "  1. $BACKEND_DIR/vodstudio-server  (含前端的二进制)"
echo "  2. $BACKEND_DIR/config.yaml        (配置文件)"
echo ""
echo "运行：./vodstudio-server -config config.yaml"
