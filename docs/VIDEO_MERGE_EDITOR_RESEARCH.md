---
name: 智能分镜视频片段「一键合并 + 在线编辑」实现研究
description: >
  研究在 vodstudio（基于 src/App.jsx 的超大单文件 React 应用）中，如何把智能分镜节点
  生成的所有视频片段一键合并成一条连续成片，并提供时间轴式在线编辑（排序 / 裁剪 / 转场 /
  字幕 / 配乐）。本文给出现状盘点、技术约束、两条主路径对比、推荐方案与分阶段落地计划，
  供 AI 与开发者快速理解模块职责与改造范围。
module: storyboard / video-merge-editor
status: implemented（路径 B｜VOD ComposeMedia 云端合成，完整编辑器已落地）
owner: vodstudio
updated: 2026-05-31
related_files:
  - src/App.jsx          # 分镜节点「合并」入口、openVideoEditorForNode / composeStoryboardVideos、成片回填
  - src/VideoEditor.jsx  # 在线编辑器组件（时间轴/排序/裁剪/转场/字幕/配乐/预览/进度）
  - src/vodAdapter.js    # runVodComposePipeline（ComposeMedia 云端合成）+ renderCaptionToPngBlob
  - vite.config.js       # vite-plugin-singlefile 单文件打包（关键约束）
  - package.json         # 依赖清单（未新增任何视频处理库）
---

# 智能分镜视频片段「一键合并 + 在线编辑」实现研究

> 实现状态（2026-05-31）：已按「路径 B｜腾讯云 VOD ComposeMedia 云端合成」落地完整编辑器，
> 支持 片段拖拽排序 / 裁剪(in-out) / 转场 / 字幕 / 配乐 / 预览 / 成片下载与回填。
> 入口：分镜「视频」模式节点工具栏新增紫色「合并」按钮 → 打开 `VideoEditor` →
> 编辑后「一键合成成片」走 `runVodComposePipeline`（复用现有 VOD 签名/上传/轮询/CORS 代理）。
> 前置条件：需启动本地转发服务 `node proxy-server.mjs`，并在设置中配置 VOD 凭据。

## 一、目标

把「智能分镜」节点中所有已生成的视频片段（`shot.video_url`），按片段顺序**一键合并**成一条连续成片，并提供一个**在线编辑器**：至少支持片段排序、裁剪(trim)，进阶支持转场、字幕、配乐。

## 二、现状盘点（探查结论）

### 2.1 视频片段数据
- 镜头数组：`node.settings.shots`（`App.jsx:2255 / 22564`）。
- 视频结果主字段：`shot.video_url`（兜底 `shot.output_url`）。视频模式单个 shot 只存一个视频 URL（图片模式才有 `output_images[]`）。
- 回填点：通用轮询 `App.jsx:15001/15045/15214/19896`；腾讯云 VOD 路径 `App.jsx:17317-17325`。
- 视频形态：以**远程 HTTP(S) URL** 为主（第三方 API / 腾讯云 VOD 临时 `myqcloud.com` URL），也兼容 `data:`(base64) 与 `blob:`。
- 排序依据：**`shots` 数组的物理顺序**（`scene_index` 仅创建时赋值，重排后不重写，不可靠）。

### 2.2 已有能力（可复用）
- **批量打包下载**：`buildStoryboardDownloadItems`(`App.jsx:27078`) + `handleStoryboardBatchDownload`(`App.jsx:27154`)，用 JSZip 把各片段 fetch 成 blob 打成 ZIP。注意：**只是打包，不是合并**。
- **取片段 blob**：`toBlob`(`App.jsx:27166`) 已能处理远程 / data / blob 三种 URL。
- **视频解码抽帧**：`extractKeyFrames`(`App.jsx:4514`) 用 `<video>`+`<canvas>`+`currentTime` seek 抽帧 —— 可直接用来生成时间轴轨道缩略图。
- **播放器内核**：`ResolvedVideo`(`App.jsx:5008`) 带原生 `controls`，可作预览播放器。
- **片段重排**：上移/下移按钮交换数组元素(`App.jsx:33787-33827`)。
- **腾讯云 VOD 适配器**：`vodAdapter.js` 已实现 上传(`uploadImageToVod` 支持 mp4) → 生成 → 轮询(`pollVodTask`) → 抽取结果 URL，并自带 TC3 签名 + CORS 代理(`wrapProxy`)。

### 2.3 缺口（需从零新增）
- ❌ 无任何视频合并 / 拼接 / 成片能力。
- ❌ 无 timeline / track 编辑 UI（现有 `track` 全是 CSS 滚动条样式）。
- ❌ 无裁剪 / 转场 / 字幕 / 混音（`bgm`、`音频音效` 仅是 LLM 脚本文字字段，无音轨）。
- ❌ 未引入任何客户端视频处理库（package.json 仅 jszip/file-saver/openai/react 等）。

## 三、关键技术约束（决定方案选型）

1. **单文件打包**：`vite.config.js` 用 `viteSingleFile()`，全部 JS/CSS/资源内联进一个 `dist/index.html`。
   - ffmpeg.wasm 需独立加载 `.wasm` + worker 脚本，且依赖 `SharedArrayBuffer`（要求页面带 `COOP/COEP` 响应头）。这与「单文件、纯静态、可能 file:// 或无自定义响应头部署」**强冲突**。
2. **无后端**：当前是纯前端 SPA + 本地代理(proxy-server)。重计算只能放浏览器或第三方云。
3. **已具备腾讯云 VOD 全套上传/任务基础设施** —— 云端方案的现成跳板。

## 四、两条主路径对比

### 路径 A：客户端 ffmpeg.wasm 本地合并
- 思路：引入 `@ffmpeg/ffmpeg` + `@ffmpeg/util`，按 `shots` 顺序把 `video_url` fetch 成 blob，用 concat demuxer 拼接为单 mp4；裁剪用 `-ss/-t`。
- 优点：纯前端、零后端成本、数据不出本地、可离线。
- 缺点：
  - **与 `vite-plugin-singlefile` 冲突**（wasm/worker 无法内联，需改打包策略或单独托管 core 文件）。
  - 需 `SharedArrayBuffer` → 部署需配 COOP/COEP 头（CloudBase/静态托管需确认支持；单 HTML 直开 file:// 不可用）。
  - 核心包体积大（~25MB+），首次加载慢；大视频内存吃紧；异构编码片段需先统一转码。

### 路径 B：腾讯云 VOD 云端拼接（推荐）
- 思路：各 `video_url` 经 `uploadImageToVod` 上传得 `FileId` → 调 VOD 视频拼接/视频编辑任务（需新增 API 封装）→ `pollVodTask` 轮询拿成片 URL → 回填分镜节点。
- 优点：复用现有 VOD 基建（签名/代理/上传/轮询）；性能与编码兼容性由云端保证；可顺带做转场/字幕/混音；不破坏单文件打包。
- 缺点：依赖 VOD 凭据与上传带宽；需对接 VOD 视频编辑 API（如 EditMedia/拼接任务）；离线不可用。

### 选型建议
- 项目是**单文件 + 无后端 + 已有 VOD**，**推荐路径 B（云端拼接）做"一键合并成片"**，工程冲突最小、复用最多。
- 「在线编辑」的**轻量交互（排序、裁剪点选择、转场/字幕参数）放前端**，把编辑结果组织成一份"编辑指令(EDL)"，再交给 VOD 云端渲染出片；前端用 `ResolvedVideo` 预览、`extractKeyFrames` 出轨道缩略图。
- 若坚持纯前端离线合并，再评估路径 A，并需先解决单文件打包/COOP-COEP 部署问题。

## 五、推荐落地计划（分阶段，路径 B 为主）

### 阶段 0：编辑数据模型
- 在 `node.settings` 增加 `videoEdit` 结构：
  `{ clips: [{ shotId, srcUrl, in, out, transition, caption }], bgm, mergedVideoUrl, mergedStatus }`。
- `clips` 顺序 = 成片顺序，初始由 `shots` 顺序生成。

### 阶段 1：一键合并（MVP，先不裁剪）
- `vodAdapter.js` 新增：`uploadVideosToVod(urls)`（复用 `uploadImageToVod`）+ `createVodConcatTask(fileIds)` + 轮询。
- `App.jsx` 在批量下载按钮区(`App.jsx:31682-31739`)旁加「一键合并」按钮，编排：取片段→上传→拼接→轮询→把成片 URL 写入 `node.settings.mergedVideoUrl`，用 Lightbox(`ResolvedVideo`)播放。
- 回填模式参照 VOD 现有回填(`App.jsx:17317`)。

### 阶段 2：在线编辑器面板
- 新增分镜「编辑成片」面板（抽屉/弹窗）：
  - 片段轨道：每片段一格缩略图（`extractKeyFrames` 生成），支持**拖拽排序**（升级现有上下移逻辑 `App.jsx:33791`）。
  - 裁剪：每片段双滑块选 `in/out`，预览用 `ResolvedVideo` + `currentTime` seek。
  - 预览：顺序播放各 clip（前端串播）或合并后整片播放。

### 阶段 3：进阶编辑（转场/字幕/配乐）
- 把转场/字幕/BGM 作为 EDL 参数，交 VOD 视频编辑任务渲染。
- 字幕可复用 shot 的 `dialogue`/脚本字段自动预填。

## 六、关键改动位置清单
| 改动 | 位置 |
|---|---|
| 新增 VOD 拼接/编辑 API | `src/vodAdapter.js`（复用 `callVodApi`/`signVodRequest`/`pollVodTask`/`uploadImageToVod`） |
| 取片段（按数组顺序） | 复用 `buildStoryboardDownloadItems` `App.jsx:27078` + `toBlob` `App.jsx:27166` |
| 「一键合并」按钮 UI | 批量下载按钮区 `App.jsx:31682-31739` 旁 |
| 合并编排 + 回填 | 新增函数，参照 VOD 回填 `App.jsx:17317` |
| 成片播放 | 复用 `ResolvedVideo` `App.jsx:5008` / Lightbox `App.jsx:5007` |
| 轨道缩略图 | 复用 `extractKeyFrames` `App.jsx:4514` |
| 片段拖拽排序 | 升级 `App.jsx:33787-33827` |
| 编辑数据模型 | `node.settings.videoEdit`（新增） |

## 七、风险与待确认
- **VOD 是否开通"视频编辑/拼接"能力、对应 API 与计费**（路径 B 前置条件）。
- 各片段分辨率/帧率/编码是否一致（不一致云端拼接前需转码统一）。
- 若选路径 A：需解决 `vite-plugin-singlefile` 与 wasm/worker、`SharedArrayBuffer` + COOP/COEP 部署。
- 大量片段上传的带宽与耗时（可加进度反馈，复用现有 toast/进度模式）。

## 八、实现说明（已落地）

### 8.1 合成引擎 `src/vodAdapter.js`
- `runVodComposePipeline(plan, ctx)`：端到端云端合成。
  1. 把每个片段 `src`（VOD 临时 URL / dataURL / Blob）上传得 `FileId`（FileId 形态直接复用，带缓存去重）。
  2. 字幕用 `renderCaptionToPngBlob` 渲染成透明 PNG → 上传为 `Sticker` 贴纸轨。
  3. 组装 `ComposeMedia` 的 `Tracks`：视频轨（`VideoItem` + 片段间 `TransitionItem`）、贴纸轨（字幕）、音频轨（配乐 `AudioItem`，`AudioOperations` 控音量）。
  4. 裁剪：`VideoItem.SourceMediaStartTime`(=in) + `Duration`(=out-in)。
  5. `callVodApi('ComposeMedia', body)` → `TaskId` → `pollVodTask` 轮询 → 取 `ComposeMediaTask.Output.MediaUrl/FileId`。
- `VOD_TRANSITION_TYPES`：转场枚举（淡入淡出/淡出后淡入/上下左右滑）。
- 扩展点：`extractVodResultUrls` / `pollVodTask` / `mimeToExt`(新增音视频扩展名) 已识别 `ComposeMediaTask`。

### 8.2 编辑器组件 `src/VideoEditor.jsx`（自包含、零新增依赖）
- 时间轴轨道：`<video>` 缩略图、HTML5 拖拽排序、点击选中、删除片段、转场标记。
- 裁剪：预览播放器 + 进度条 +「设入点/设出点」+ 数值输入；预览仅在 in→out 区间循环。
- 属性面板：转场（与上一片段）、字幕（文字 + 颜色）。
- 底栏：画布比例、配乐上传与音量、输出文件名、「一键合成成片」按钮 + 进度条；成片后内置预览与「下载成片」。

### 8.3 App.jsx 集成
- 入口①（节点级）：分镜「视频」模式节点工具栏新增紫色「合并」按钮（批量按钮组内）。
- 入口②（素材库级·新增）：左侧栏「分镜」素材面板「视频」tab 支持多选已生成视频片段后合并。
  - 多选状态 `storyboardSelection`（按点击顺序的 id 数组）；卡片右上角复选框、头部「合并(N)」按钮 + 「全选/清空」。
  - `openVideoEditorForSelectedAssets()`：把所选 `storyboardVideoAssets` 转为 `{id,srcUrl,label,caption}` clips，画布默认 16:9（跨节点比例未知，编辑器内可调），`nodeId=null`。
  - `composeStoryboardVideos` 在 `nodeId=null` 时不回填节点，仅在编辑器内预览/下载并提示成功。
- `openVideoEditorForNode(node)`：按 `shots` 物理顺序收集 `video_url`，字幕预填 `shot.dialogue`，按 `node.settings.ratio` 推导画布尺寸。
- `composeStoryboardVideos(plan,{onStage})`：构建 VOD 凭据/代理 ctx（先 ping `proxy-server`）→ 调 `runVodComposePipeline` → 成片回填 `node.settings.mergedVideo = { url, taskId, time }`。
- 状态：`videoEditor { open, nodeId, clips, canvasSize }`；组件在主返回 JSX 中渲染（自带 `createPortal`）。

### 8.4 后续可增强
- 字幕用 VOD 原生文本轨/更丰富排版；转场枚举对照官方最新支持列表校准。
- 成片在画布节点内回显（目前仅写入 `settings.mergedVideo` + 编辑器内预览/下载）。
- 大批量片段并发上传、断点续传与失败重试。
