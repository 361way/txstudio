# TxStudio

TxStudio 是一个本地单用户 AI 图片、视频与节点画布工作台。项目由 React/Vite 前端和单一 Go 后端组成；项目、画布过程、生成历史和加密 API 凭证统一保存在本地 SQLite。

## 当前能力

- 图片生成与参考图上传
- 视频生成（首尾帧、多图模式）
- AI 画布：小说输入、角色/场景提取、分镜、生图、生视频、AI 对话
- 场景化能力：电商助手、AI 编辑、画质提升、版权保护
- 腾讯云 MPS AI 换装：模特图 + 服装图、WAND 1.0 模型、1K/2K/4K 输出
- 腾讯云 MPS 图片水印智能擦除：COS 输入转存、文字水印编排 `ScheduleId=30000`
- 腾讯云 MPS 老照片清晰修复：基于公开的超分辨率图像增强能力提升清晰度
- 本地项目、完整画布过程和生成历史持久化
- 全局 API 设置：TokenHub/OpenAI 兼容接口、腾讯云 VOD
- 本地缓存与通用 HTTP 代理

## 技术结构

```text
React/Vite (:5173)
        │ /api + 本地代理接口
        ▼
Go/Gin (:8080)
  ├─ SQLite: backend/data/txstudio.db
  ├─ 加密密钥: backend/data/secret.key
  ├─ 本地缓存: backend/data/cache/
  ├─ VOD TC3 代签
  └─ 前端静态文件嵌入
```

详细说明见 `docs/ARCHITECTURE.md`。

## 本地开发

环境要求：Node.js 18+、Go 1.23+。

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8080`

应用为本地单用户模式，无需登录。API 凭证在页面右上角“API 设置”中配置。

## 构建

```bash
npm run build
```

该命令会构建 `dist/index.html`，并自动同步到 `backend/frontend/dist/index.html` 供 Go `embed` 使用。

构建本地可执行文件：

```bash
cd backend
go build -o txstudio ./cmd/server
./txstudio -config config.yaml
```

## 数据与安全

- API Secret 使用 AES-256-GCM 加密后写入 SQLite。
- AES 密钥首次启动时自动生成到 `backend/data/secret.key`。
- `backend/data/` 已被 Git 忽略，不应提交数据库、密钥或缓存文件。
- 通用代理拒绝访问环回、私网和未指定地址，降低 SSRF 风险。
- 删除项目会同步硬删除画布快照和生成历史。

## 目录说明

```text
src/                     当前前端源码
backend/                 当前 Go 后端与 SQLite 数据目录
backend/frontend/dist/   Go 内嵌的前端构建产物
docs/                    当前架构说明
bak/                     历史参考、旧实现和研究材料，不参与构建运行
```

## 历史归档

`bak/` 中包括旧参考页面、training docs、历史架构图、独立 9527 代理、SaaS 登录/配额代码和已被场景化能力替代的模板库。归档内容仅供追溯，不应被当前源码引用。
