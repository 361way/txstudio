# VodStudio SaaS 化后端设计

> 基于 src/ 现有单文件 React 应用，用 Gin 构建带认证鉴权 + 多租户隔离 + 套餐配额的 SaaS 平台后端。

## 1. 架构总览

```
浏览器（React 前端，渐进式改造）
  ↓ HTTPS  (Bearer JWT)
Gin API 网关
  ├─ auth        注册/登录/刷新/me
  ├─ tenants     租户/成员/邀请
  ├─ billing     套餐/订阅/用量
  ├─ projects    多项目 CRUD + 画布状态 + 历史上云
  ├─ assets      COS 临时上传 URL + 资产元数据
  ├─ credentials VOD/TokenHub AK/SK 加密存储
  └─ proxy       复用现有 Go 代理，注入租户鉴权 + 用量上报
  ↓
MySQL（共享库 + tenant_id 行级隔离）
  ↓
腾讯云 COS（资产，按 tenant/{tenantId}/ 前缀隔离）
```

## 2. 关键决策

| 维度 | 选择 |
|------|------|
| 部署 | 自有云服务器，自管 MySQL |
| 协作 | 账号体系 + 个人项目隔离（协作后置） |
| 认证 | 账号密码 + JWT（access 15m / refresh 7d） |
| SaaS | 多租户隔离 + 套餐/配额/用量统计 |
| 前端 | 渐进式：localStorage 与 API 双写，优先 API，失败降级本地 |
| 资产 | 腾讯云 COS，按 tenant 前缀隔离，后端签发临时上传 URL |
| 凭证 | 后端托管，AES-GCM 加密入库，代理调用时解密代签 |

## 3. 数据模型（10 张核心表）

```
tenants            租户/组织          id, name, slug, plan_id, status, created_at
users              用户              id, tenant_id, email, password_hash, role, status
plans              套餐定义          id, code, name, quotas(json), price_cents
subscriptions      订阅              tenant_id, plan_id, status, period_start, period_end
usage_records      用量记录          id, tenant_id, user_id, type, count, date
projects           项目/画布         id, tenant_id, owner_id, name, cover_url, status, updated_at
project_snapshots  画布快照          id, project_id, data(json), version, created_at
project_history    生成历史          id, project_id, type, url, prompt, meta(json), created_at
assets             资产元数据        id, tenant_id, project_id, cos_key, mime, size, width, height
credentials        加密凭证          id, tenant_id, provider, encrypted_data, created_at
```

租户隔离策略：所有业务表含 `tenant_id`，中间件从 JWT 注入，GORM 查询自动追加 `WHERE tenant_id = ?`。

## 4. API 设计

### 认证（公开）
- `POST /api/auth/register`   注册（自动创建租户）
- `POST /api/auth/login`      登录，返回 access + refresh
- `POST /api/auth/refresh`    刷新 access
- `GET  /api/auth/me`         当前用户信息

### 租户管理
- `GET  /api/tenants/me`             当前租户信息
- `GET  /api/tenants/me/members`     成员列表
- `POST /api/tenants/me/members`     邀请成员
- `PUT  /api/tenants/me/members/:id` 修改成员角色

### 套餐与用量
- `GET  /api/billing/plans`                套餐列表
- `GET  /api/billing/subscription`         当前订阅
- `POST /api/billing/subscribe`            订阅/切换套餐
- `GET  /api/billing/usage`                用量统计（按日/月）

### 项目
- `GET    /api/projects`                   项目列表
- `POST   /api/projects`                   创建项目
- `GET    /api/projects/:id`               项目详情
- `PUT    /api/projects/:id`               更新（名称等）
- `DELETE /api/projects/:id`               删除
- `PUT    /api/projects/:id/canvas`        保存画布状态（nodes+connections）
- `GET    /api/projects/:id/canvas`        读取画布状态
- `GET    /api/projects/:id/history`       历史记录列表
- `POST   /api/projects/:id/history`       新增历史记录

### 资产
- `POST /api/assets/upload-url`    获取 COS 临时上传 URL（指定 mime/size）
- `POST /api/assets`               登记资产元数据
- `GET  /api/assets/:id`           获取资产访问 URL

### 凭证
- `GET    /api/credentials`        当前租户凭证列表（不返回明文）
- `POST   /api/credentials`        保存/更新凭证（VOD SecretId/Key/SubAppId、TokenHub key）
- `DELETE /api/credentials/:id`    删除凭证

### 代理（复用现有，加鉴权）
- `POST /api/proxy`               通用 CORS 代理（需登录 + 配额）
- `POST /api/cos-put`             COS PUT 上传代理（需登录 + 配额）
- `POST /api/save-cache`          保存资产到 COS（替代本地缓存）

## 5. 认证流程

```
注册 → 创建 tenant + owner user → 返回 tokens
登录 → 校验密码 → 签发 access(15m) + refresh(7d)
请求 → Authorization: Bearer <access> → 中间件校验 → 注入 user/tenant 到 context
刷新 → POST refresh token → 签发新 access（refresh 可滚动续期）
```

密码用 bcrypt 哈希；JWT 用 HS256，密钥从配置读取。

## 6. 配额与用量

套餐 quotas JSON 示例：
```json
{ "daily_video_gen": 50, "daily_image_gen": 200, "storage_mb": 5120, "max_projects": 20 }
```

拦截链路：请求代理/生成接口 → quota 中间件查当日用量 → 超限返回 429 → 通过后执行 → 记录 usage_record。

## 7. 凭证安全

- 前端提交 AK/SK → 后端 AES-256-GCM 加密（密钥从配置）→ 存 credentials 表
- 代理调用 VOD API 时：取出凭证 → 解密 → 代签名 → 不向前端暴露明文
- 前端不再持有 AK/SK，只持 JWT，从根本上解决密钥泄露风险

## 8. 前端改造（渐进式）

新增 `src/api/` 封装层，统一注入 token、处理刷新、降级逻辑：
- `src/api/client.js`    — fetch 封装 + token + 401 自动刷新
- `src/api/auth.js`      — 认证 API
- `src/api/project.js`   — 项目 API
- `src/api/asset.js`     — 资产 API
- `src/pages/Login.jsx`  — 登录/注册页
- 改造 App.jsx localStorage 读写为 API 优先 + 本地降级

## 9. 目录结构

```
backend/
├── cmd/server/main.go          # 入口
├── internal/
│   ├── app/                    # 应用初始化、配置、DB、路由
│   ├── model/                  # GORM 模型
│   ├── middleware/             # JWT/租户/CORS/配额
│   ├── handler/                # HTTP handler
│   └── service/                # JWT/Crypto/COS 业务服务
├── migrations/001_init.sql
├── go.mod
├── config.yaml.example
└── README.md
```
