---
name: txstudio-local-backend
description: TxStudio 本地单用户 Go 后端，统一提供 SQLite 持久化、API 凭证加密、VOD 代签、代理、缓存和静态前端托管。
---

# TxStudio 本地后端

## 运行

```bash
go run ./cmd/server -config config.yaml
```

服务仅监听 `127.0.0.1:8080`。

## 核心接口

- `/api/projects`：项目 CRUD
- `/api/projects/:id/canvas`：完整画布过程快照
- `/api/projects/:id/history`：生成历史与硬删除
- `/api/credentials`：加密 API 凭证
- `/api/vod/invoke`：腾讯云 VOD TC3 代签调用
- `/api/agent/chat`：智能 Agent 文本分析代理（通过 `TXSTUDIO_AGENT_API_KEY` 注入密钥）
- `/api/proxy`：JSON 格式通用代理
- `/proxy?url=`：画布兼容代理
- `/save-cache`、`/file/*`、`/list-files`：本地结果缓存
- `/health`、`/ping`：健康检查

## 本地数据

默认位于 `backend/data/`：

- `txstudio.db`：SQLite 数据库
- `secret.key`：AES-256-GCM 密钥
- `cache/`：生成结果本地缓存

这些文件均不应提交到 Git。
