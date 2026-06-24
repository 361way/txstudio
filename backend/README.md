# VodStudio SaaS 后端

基于 Gin 的 SaaS 化后端，提供认证鉴权、多租户隔离、套餐配额、项目/画布云端持久化、资产 COS 存储、凭证加密托管、CORS 代理。

## 快速开始

### 1. 准备 MySQL

```bash
mysql -u root -p -e "CREATE DATABASE vodstudio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'vodstudio'@'%' IDENTIFIED BY 'changeme'; GRANT ALL ON vodstudio.* TO 'vodstudio'@'%'; FLUSH PRIVILEGES;"
```

### 2. 配置

```bash
cp config.yaml.example config.yaml
# 编辑 config.yaml，填入数据库密码、JWT secret、AES key、COS 配置
```

生成随机密钥：
```bash
# JWT secret (64 字符)
openssl rand -hex 32

# AES key (32 字节 = 64 hex 字符)
openssl rand -hex 32
```

### 3. 启动

```bash
cd backend
go mod tidy
go run cmd/server/main.go -config config.yaml
```

首次启动会自动建表并写入默认套餐（free/pro/enterprise）。

### 4. 验证

```bash
# 健康检查
curl http://localhost:8080/health

# 注册
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"123456","display_name":"测试用户"}'

# 登录
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"123456"}'

# 用返回的 access_token 调用业务接口
curl http://localhost:8080/api/auth/me \
  -H "Authorization: Bearer <access_token>"
```

## API 概览

| 模块 | 方法 | 路径 | 鉴权 |
|------|------|------|------|
| 认证 | POST | /api/auth/register | 否 |
| 认证 | POST | /api/auth/login | 否 |
| 认证 | POST | /api/auth/refresh | 否 |
| 认证 | GET | /api/auth/me | 是 |
| 套餐 | GET | /api/billing/plans | 是 |
| 订阅 | GET | /api/billing/subscription | 是 |
| 订阅 | POST | /api/billing/subscribe | 是 |
| 用量 | GET | /api/billing/usage | 是 |
| 项目 | GET/POST | /api/projects | 是 |
| 项目 | GET/PUT/DELETE | /api/projects/:id | 是 |
| 画布 | GET/PUT | /api/projects/:id/canvas | 是 |
| 历史 | GET/POST | /api/projects/:id/history | 是 |
| 资产 | POST | /api/assets/upload-url | 是 |
| 资产 | POST | /api/assets | 是 |
| 资产 | GET | /api/assets/:id | 是 |
| 凭证 | GET/POST/DELETE | /api/credentials[/:id] | 是 |
| 代理 | POST | /api/proxy | 是+配额 |
| 代理 | POST | /api/cos-put | 是+配额 |

## 安全要点

- **密码**：bcrypt 哈希存储
- **JWT**：HS256，access 15m / refresh 7d，密钥从配置或环境变量读取
- **凭证**：VOD/TokenHub AK/SK 用 AES-256-GCM 加密入库，前端不再持有明文
- **租户隔离**：所有业务表含 tenant_id，查询自动按租户过滤
- **SSRF 防护**：代理禁止访问内网地址
- **配额**：代理请求按日配额拦截，超限返回 429

## 目录结构

```
backend/
├── cmd/server/main.go          # 入口
├── internal/
│   ├── app/                    # 配置、DB、应用容器、路由
│   ├── model/                  # GORM 模型（10 张表）
│   ├── middleware/             # JWT 鉴权、配额检查
│   ├── handler/                # HTTP handler（auth/project/credential/asset/billing/proxy）
│   └── service/                # JWT、AES 加密、COS 服务
├── config.yaml.example
├── go.mod
├── DESIGN.md                   # 详细设计文档
└── README.md
```

## 前端集成

前端改造见 `src/api/` 封装层：
- `src/api/client.js` — fetch 封装 + token 注入 + 401 自动刷新 + 降级本地
- `src/api/auth.js` — 认证 API
- `src/api/project.js` — 项目/画布/历史 API
- `src/api/asset.js` — 资产上传 API
- `src/pages/Login.jsx` — 登录/注册页

改造策略：渐进式双写，localStorage 与 API 并行，优先 API，失败降级本地。
