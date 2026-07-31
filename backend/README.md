---
name: txstudio-local-backend
description: TxStudio 本地单用户 Go 后端，统一提供 SQLite 持久化、API 凭证加密、VOD 代签、代理、缓存和静态前端托管。
---

# TxStudio 本地后端

## 运行

开发模式可使用可选 YAML 配置：

```bash
go run ./cmd/server -config config.yaml -open=false
```

发布二进制无需配置文件：

```bash
./txstudio
```

服务仅监听 `127.0.0.1:8080`，默认自动打开浏览器。数据库、密钥、缓存和日志会在操作系统用户配置目录下自动创建，也可通过 `-data-dir` 覆盖。

## 核心接口

- `/api/projects`：项目 CRUD
- `/api/projects/:id/canvas`：完整画布过程快照
- `/api/projects/:id/history`：生成历史与硬删除
- `/api/credentials`：加密 API 凭证
- `/api/vod/invoke`：腾讯云 VOD TC3 代签调用
- `/api/generation-jobs`：统一生成任务、素材索引和阶段事件的查询与管理
- `/api/image-templates`：自定义图像模板完整配置的列表、新增、编辑和删除
- `/api/agent/chat`：智能 Agent 文本分析代理（优先使用页面保存到 SQLite 的加密 TokenHub 凭证）
- `/api/proxy`：JSON 格式通用代理
- `/proxy?url=`：画布兼容代理
- `/save-cache`、`/file/*`、`/list-files`：本地结果缓存
- `/health`、`/ping`：健康检查

## 本地数据

发布二进制默认使用操作系统用户配置目录：

- `txstudio.db`：纯 Go SQLite 数据库
- `secret.key`：AES-256-GCM 密钥
- `cache/`：生成结果本地缓存
- `logs/`：轮转技术日志

使用 `-data-dir` 可以指定便携数据目录。这些运行数据不会打入二进制，也不应提交到 Git。
