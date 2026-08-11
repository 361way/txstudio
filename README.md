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
- 自定义图像模板：完整生成参数配置、SQLite 持久化、跨浏览器新增/编辑/复制/删除
- 本地项目、完整画布过程和生成历史持久化
- 全局 API 设置：TokenHub/OpenAI 兼容接口、腾讯云 VOD
- 本地缓存与通用 HTTP 代理

## 技术结构

```text
开发期 React/Vite (:5173)
        │ /api + 本地代理接口
        ▼
Go/Gin (:8080)
  ├─ 纯 Go SQLite: 用户数据目录/txstudio.db
  ├─ 加密密钥: 用户数据目录/secret.key
  ├─ 本地缓存: 用户数据目录/cache/
  ├─ VOD TC3 代签
  └─ 发布时完整前端内嵌到单个二进制
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

## 单二进制发布

构建当前操作系统和 CPU 架构的独立可执行文件：

```bash
npm run build:binary
```

产物只有一个文件：

```text
release/txstudio       # macOS / Linux
release/txstudio.exe   # Windows
```

发布后的二进制已内嵌完整前端，并使用纯 Go SQLite。目标机器运行时不需要安装 Node.js、Go、CGO、SQLite、YAML 配置或其他动态库：

```bash
./txstudio
```

服务默认监听 `127.0.0.1:8080` 并自动打开浏览器。首次运行会在操作系统用户配置目录创建数据库、密钥、缓存和日志：

- macOS：`~/Library/Application Support/TxStudio/`
- Windows：`%AppData%\\TxStudio\\`
- Linux：`$XDG_CONFIG_HOME/TxStudio/` 或 `~/.config/TxStudio/`

运行参数均为可选：

```bash
./txstudio -data-dir ./txstudio-data -port 8080 -open=false
./txstudio -config /path/to/config.yaml
./txstudio -version
```

在空目录和空环境中验证发布文件：

```bash
npm run test:standalone
```

交叉编译时可设置标准 `GOOS`、`GOARCH`，例如：

```bash
GOOS=windows GOARCH=amd64 npm run build:binary
```

不同操作系统和 CPU 架构需要分别构建对应二进制；每个目标的发布内容仍只有一个可执行文件。

`npm run build` 仅构建并同步内嵌前端，供开发调试使用。

## 数据与安全

- API Secret 使用 AES-256-GCM 加密后写入 SQLite。
- AES 密钥首次启动时自动生成到用户数据目录的 `secret.key`。
- 用户数据目录不属于发布文件，不应提交数据库、密钥、缓存或日志。
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
