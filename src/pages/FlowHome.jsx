/**
 * FlowHome —「txstudio empowers your success」本地统一工作台。
 *
 * 左侧边栏 + Hero + 输入卡片 + 底部功能标签。
 * 所有功能（图片 / 视频 / 画布 / 场景化能力）都在主区域中切换，
 * 点击侧边栏 / 底部标签只切换主区内容，绝不跳转到另一套界面。
 *
 * 主区路由（activeMode）：
 *   home       → Hero + 输入卡片 + 功能标签（落地态）
 *   image      → 内联 ImageTool（浅色）
 *   video      → 内联 VideoTool（浅色）
 *   canvas     → 内联 ProjectList（浅色）/ CanvasApp 编辑器（浅色，默认 light 主题，可在画布内切换）
 *
 * 本地单用户工作台：无登录门禁，API 设置由右上角全局入口统一提供。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    PanelLeft, LayoutGrid, ChevronDown,
    Paperclip, Star, ArrowUp, ArrowLeft, Settings,
    Image as ImageIcon, Video, Layout, Sparkles, MousePointer2,
    History, Users, MessageSquare, Download, UploadCloud, Home, Search,
    X, Check, Info, SlidersHorizontal, Loader2, Volume2, VolumeX, Play, Bot,
} from 'lucide-react';
import GlobalAPISettings from '../components/GlobalAPISettings';
import {
    VOD_IMAGE_MODEL_MATRIX,
    VOD_DEFAULT_IMAGE_MODEL_NAME,
    VOD_DEFAULT_IMAGE_MODEL_VERSION,
    VOD_VIDEO_MODEL_MATRIX,
    VOD_DEFAULT_VIDEO_MODEL_NAME,
    VOD_DEFAULT_VIDEO_MODEL_VERSION,
    VOD_VIDEO_RATIOS,
    runVodAigcPipeline,
} from '../vodAdapter';
import { getVodImageModelCapability } from '../data/vodImageModelCapabilities';
import i18n from '../i18n';
import ImageTool from './ImageTool';
import ImageTemplateHub from './ImageTemplateHub';
import VideoTool from './VideoTool';
import AIOutfitTool from './AIOutfitTool';
import WatermarkEraseTool from './WatermarkEraseTool';
import OldPhotoRestoreTool from './OldPhotoRestoreTool';
import ForegroundExtractionTool from './ForegroundExtractionTool';
import ChangeModelTool from './ChangeModelTool';
import AgentStudio from './AgentStudio';
import GenerationHistory from './GenerationHistory';
import ProjectList from './ProjectList';
import CanvasApp from '../App.jsx';
import {
    HOME_QUICK_INSPIRATIONS,
    IMAGE_INSPIRATION_CATEGORIES,
    IMAGE_INSPIRATIONS,
} from '../data/imageInspiration';

const t = (s) => (i18n.t ? i18n.t(s) : s);

// 统一工作台主要功能
const BASE_MODES = [
    { id: 'agent', label: '智能 Agent', icon: Bot },
    { id: 'image', label: '图像模版', icon: ImageIcon },
    { id: 'video', label: '视频', icon: Video },
    { id: 'canvas', label: '画布', icon: Layout },
    { id: 'scenario', label: '场景化能力', icon: Sparkles },
];

const SIDEBAR_MODES = [
    { id: 'home', label: '主页', icon: Home },
    ...BASE_MODES,
];

// 历史记录：暂无真实数据源（待接入后端项目/会话列表后填充）
const HISTORY = [];

// 生图可选模型列表（与图片工具保持一致，来源于 VOD_IMAGE_MODEL_MATRIX）
const IMAGE_MODELS = Object.keys(VOD_IMAGE_MODEL_MATRIX);
const VIDEO_MODELS = Object.keys(VOD_VIDEO_MODEL_MATRIX);
const HOME_REFERENCE_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_REFERENCE_LIMIT = 10;
const VIDEO_RESOLUTIONS = ['720P', '1080P', '2K', '4K'];
const KLING_EXTENDED_DURATIONS = Array.from({ length: 13 }, (_, index) => `${index + 3}s`);
const DEFAULT_VIDEO_DURATIONS = ['5s', '10s'];
const REFERENCE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const REFERENCE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
const HOME_PIPELINE_CONTEXT = {
    credentials: {},
    useProxy: true,
    localServerUrl: import.meta.env.DEV ? 'http://127.0.0.1:8080' : window.location.origin,
};
const IMAGE_STAGE_LABELS = {
    upload_start: '正在上传参考图',
    upload_done: '参考图上传完成',
    create_task: '正在创建图片任务',
    task_created: '图片任务已创建',
    polling: '正在生成图片',
    task_finish: '图片生成完成',
};
const VIDEO_STAGE_LABELS = {
    upload_start: '正在上传参考图',
    upload_done: '参考图上传完成',
    create_task: '正在创建视频任务',
    task_created: '视频任务已创建',
    polling: '正在生成视频',
    task_finish: '视频生成完成',
};

function defaultImageModelVersion(modelName) {
    const versions = VOD_IMAGE_MODEL_MATRIX[modelName] || [];
    return modelName === VOD_DEFAULT_IMAGE_MODEL_NAME && versions.includes(VOD_DEFAULT_IMAGE_MODEL_VERSION)
        ? VOD_DEFAULT_IMAGE_MODEL_VERSION
        : versions[0] || '';
}

function parseHomeVideoSubjectInfos(value) {
    return String(value || '')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [id, ...nameParts] = line.split(/[|,，]/).map((part) => part.trim());
            const name = nameParts.join('').trim();
            return id ? { Id: id, ...(name ? { Name: name } : {}) } : null;
        })
        .filter(Boolean);
}

const CAPABILITY_CATEGORIES = [
    { id: 'commerce', label: '电商助手' },
    { id: 'edit', label: 'AI 编辑' },
    { id: 'quality', label: '画质提升' },
    { id: 'copyright', label: '版权保护' },
    { id: 'all', label: '全部' },
];

const CAPABILITY_IMAGE_BASE = 'https://media-frame-1258344699.cos.ap-nanjing.tencentcos.cn/mps-saas/ui/light';

// 图片能力入口：复用 ImageTool，以模板形式带入能力名称、参考图数量和默认提示词。
const IMAGE_CAPABILITIES = [
    { id: 'change-clothes', category: 'commerce', name: 'AI 换装', description: '虚拟试衣 · 模特换装', image: 'change_clothe.png', refCount: 2, prompt: '保持人物身份、姿态和背景不变，将参考服装自然地穿到人物身上，保留真实面料纹理、褶皱、光影和遮挡关系。' },
    { id: 'change-model', category: 'commerce', name: 'AI 换模特', description: 'AI 虚拟模特 · 换体型', image: 'change_model.png', refCount: 2, prompt: '保持服装款式、材质和商品细节不变，将服装自然展示在参考模特身上，生成专业电商棚拍效果。' },
    { id: 'cutout', category: 'commerce', name: '智能抠图', description: '透明背景 · 精准分割', image: 'cutout.png', refCount: 1, prompt: '精准识别并提取图片主体，完整保留发丝、毛发和半透明边缘，移除原背景，输出干净的商品主体图。' },
    { id: 'foreground', category: 'commerce', name: '前景提取', description: '提取主体 · 前景分离', image: 'foreground.png', refCount: 1, prompt: '提取画面中的主要前景对象，保持主体边缘与原始细节完整，并将前景与背景清晰分离。' },
    { id: 'background-fusion', category: 'commerce', name: '背景融合', description: 'AI 换背景 · 商品图背景', image: 'bg_fusion.png', refCount: 2, prompt: '将商品自然融合到参考背景中，统一透视、比例、光线方向、色温、接触阴影与环境反射，生成真实电商场景图。' },
    { id: 'multi-view', category: 'commerce', name: '多视角生图', description: '旋转视角 · 多角度展示', image: 'multi_vision.png', refCount: 1, prompt: '根据商品参考图生成正面、侧面、背面和四分之三视角，保持商品结构、材质、颜色与标识一致。' },
    { id: 'image-suite', category: 'commerce', name: '套图生成', description: '批量海报 · 多主题广告图', image: 'suite.png', refCount: 1, prompt: '围绕参考商品生成一组视觉统一的电商套图，包含主图、细节图、场景图和促销海报，保持商品一致性。' },

    { id: 'erase', category: 'edit', name: '智能擦除', description: '去除文字 / 水印 / Logo', image: 'erase.png', refCount: 1, prompt: '自然移除图片中不需要的文字、水印、标识或对象，并根据周围纹理、光影和透视智能补全背景。' },
    { id: 'outpaint', category: 'edit', name: '图片扩图', description: '画布扩展 · 智能填充', image: 'padding.png', refCount: 1, prompt: '向画面四周自然扩展内容，延续原图构图、透视、光线、纹理和风格，不改变中心主体。' },
    { id: 'repaint', category: 'edit', name: '局部重绘', description: '自由重绘 · 在图上画选区', image: 'repaint.png', refCount: 1, prompt: '仅重绘指定区域，使新内容与原图的风格、光影、透视和边缘过渡自然一致，其他区域保持不变。' },
    { id: 'split', category: 'edit', name: '分镜拆图', description: '漫画宫格 · 分镜拆分', image: 'split.png', refCount: 1, prompt: '识别并拆分图片中的多个分镜或宫格，保持每个分镜的完整边界、原始比例和清晰度。' },
    { id: 'detection', category: 'edit', name: '目标检测', description: '定位物体 · 编辑前处理', image: 'detection.png', refCount: 1, prompt: '识别画面中的主要对象及其位置，突出目标边界与类别，为后续图片编辑提供准确的对象区域。' },
    { id: 'understand', category: 'edit', name: '图片理解', description: '看图回答 · 画面描述', image: 'comprehend.png', refCount: 1, prompt: '详细理解并描述参考图片中的主体、场景、构图、风格、文字、光影和关键视觉信息。' },

    { id: 'super-resolution', category: 'quality', name: '超分辨率', description: '高清放大 · 分辨率提升', image: 'superres.png', refCount: 1, prompt: '高清放大参考图片，恢复边缘、纹理和微小细节，减少锯齿与模糊，不改变原始内容和风格。' },
    { id: 'enhance', category: 'quality', name: '综合增强', description: '降噪 / 色彩 / 细节 / 低光', image: 'enhance.png', refCount: 1, prompt: '综合提升图片画质：智能降噪、改善低光、校正色彩、增强细节与清晰度，同时保持自然真实。' },
    { id: 'beauty', category: 'quality', name: '美颜美化', description: '磨皮 / 美白 / 滤镜叠加', image: 'beauty.png', refCount: 1, prompt: '自然优化人物肤色与面部细节，轻度磨皮、美白和色彩美化，保留真实皮肤纹理与人物身份。' },
    { id: 'restore', category: 'quality', name: '老照片修复', description: '清晰增强 · 细节恢复', image: 'fix.png', refCount: 1, prompt: '提升老照片的清晰度与细节表现，尽量保持原始构图、人物特征和自然质感。' },
    { id: 'compress', category: 'quality', name: '图片压缩', description: '格式转换 · 质量压缩 · 编码', image: 'encode.png', refCount: 1, prompt: '在尽可能保持视觉质量和关键细节的前提下优化图片，使画面干净清晰，适合网络和电商页面使用。' },

    { id: 'watermark-add', category: 'copyright', name: '添加盲水印', description: '不可见水印 · 版权标记', image: 'blind_watermark_add.png', refCount: 1, prompt: '在不影响图片视觉质量的前提下加入不可见的版权标记，用于内容归属与后续溯源。' },
    { id: 'watermark-extract', category: 'copyright', name: '提取盲水印', description: '提取隐藏水印 · 溯源验证', image: 'blind_watermark_extract.png', refCount: 1, prompt: '检测参考图片中的隐藏版权标记并提取可用于归属判断和溯源验证的信息。' },
];

function ScenarioCapabilityHub({ activeCategory, onCategoryChange, capabilities, onOpenCapability }) {
    return (
        <div className="mx-auto w-full max-w-[1240px] px-6 py-10 lg:px-10">
            <section aria-labelledby="scenario-capability-title">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#b68112]">
                            <span className="h-px w-7 bg-[#e2b849]" />
                            Scenario Studio
                        </div>
                        <h1 id="scenario-capability-title" className="text-[28px] font-semibold tracking-[-0.02em] text-[#1f2329]">
                            {t('场景化能力')}
                        </h1>
                        <p className="mt-2 text-[13px] text-gray-400">
                            {t('按业务场景选择能力，进入图片工具并自动载入对应预设')}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={t('场景化能力分类')}>
                        {CAPABILITY_CATEGORIES.map((category) => {
                            const active = activeCategory === category.id;
                            return (
                                <button
                                    key={category.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    onClick={() => onCategoryChange(category.id)}
                                    className={`rounded-full px-4 py-2 text-[13px] font-medium transition-all ${active
                                        ? 'bg-[#f4bd35] text-[#312300] shadow-[0_5px_16px_rgba(244,189,53,0.24)]'
                                        : 'text-gray-500 hover:bg-[#f4f4f5] hover:text-[#1f2329]'
                                        }`}
                                >
                                    {t(category.label)}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {capabilities.map((capability) => (
                        <button
                            key={capability.id}
                            type="button"
                            onClick={() => onOpenCapability(capability)}
                            className="group relative aspect-[1.08/1] overflow-hidden rounded-[15px] border border-[#e5e2d9] bg-[#f2f1eb] text-left shadow-[0_2px_8px_rgba(40,35,20,0.03)] transition-all duration-300 hover:-translate-y-1 hover:border-[#d5caa9] hover:shadow-[0_14px_34px_rgba(57,49,24,0.12)] focus:outline-none focus:ring-2 focus:ring-[#e4ae29] focus:ring-offset-2"
                        >
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(255,255,255,0.9),transparent_38%)]" />
                            <img
                                src={`${CAPABILITY_IMAGE_BASE}/${capability.image}?v=20260526-4`}
                                alt=""
                                loading="lazy"
                                onError={(event) => { event.currentTarget.style.display = 'none'; }}
                                className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]"
                            />
                            <div className="absolute inset-x-0 bottom-0 h-[42%] bg-gradient-to-t from-white via-white/95 to-transparent" />
                            <div className="absolute inset-x-3 bottom-3 rounded-[11px] border border-white/80 bg-white/90 px-3.5 py-3 shadow-[0_6px_18px_rgba(30,25,12,0.06)] backdrop-blur-md">
                                <div className="flex items-center justify-between gap-2">
                                    <h2 className="text-[15px] font-semibold text-[#28251f]">{t(capability.name)}</h2>
                                    <ArrowUp size={15} className="rotate-45 text-gray-300 transition-colors group-hover:text-[#b68112]" />
                                </div>
                                <p className="mt-1 truncate text-[11.5px] text-gray-400">{t(capability.description)}</p>
                            </div>
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}

function LegacyImageTemplateHub({ activeCategory, query, styles, onCategoryChange, onQueryChange, onApply }) {
    return (
        <div className="mx-auto w-full max-w-[1240px] px-6 py-10 lg:px-10">
            <section aria-labelledby="image-template-title">
                <div className="flex flex-col gap-5 border-b border-[#efede7] pb-7 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#b68112]">
                            <span className="h-px w-7 bg-[#e2b849]" />
                            Image Templates
                        </div>
                        <h1 id="image-template-title" className="text-[28px] font-semibold tracking-[-0.02em] text-[#1f2329]">{t('图像模版')}</h1>
                        <p className="mt-2 text-[13px] text-gray-400">{t('选择灵感样式，自动带入对应提示词后继续创作。')}</p>
                    </div>
                    <label className="flex w-full items-center gap-2 rounded-xl border border-[#e8e5dd] bg-[#fafaf8] px-3 py-2.5 text-gray-400 transition focus-within:border-[#d9b354] focus-within:bg-white lg:w-[300px]">
                        <Search size={15} />
                        <input
                            value={query}
                            onChange={(event) => onQueryChange(event.target.value)}
                            placeholder={t('搜索模版、风格或提示词')}
                            className="w-full bg-transparent text-[12px] text-[#292722] outline-none placeholder:text-gray-400"
                        />
                    </label>
                </div>

                <div className="mt-5 flex gap-1 overflow-x-auto no-scrollbar" role="tablist" aria-label={t('图像模版分类')}>
                    {IMAGE_INSPIRATION_CATEGORIES.map((category) => {
                        const active = activeCategory === category.id;
                        return (
                            <button
                                key={category.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => onCategoryChange(category.id)}
                                className={`whitespace-nowrap rounded-full px-3.5 py-2 text-[12px] transition ${active
                                    ? 'bg-[#f6e7b4] font-medium text-[#604914] shadow-[0_3px_10px_rgba(197,139,21,0.12)]'
                                    : 'text-gray-500 hover:bg-[#f5f4f1] hover:text-[#292722]'
                                    }`}
                            >
                                {t(category.label)}
                            </button>
                        );
                    })}
                </div>

                <div className="mt-7">
                    {styles.length ? (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {styles.map((style) => (
                                <button
                                    key={style.id}
                                    type="button"
                                    onClick={() => onApply(style)}
                                    className="group relative flex min-h-[190px] overflow-hidden rounded-2xl border border-[#e9e5db] bg-white p-5 text-left shadow-[0_3px_12px_rgba(45,37,17,0.035)] transition-all hover:-translate-y-0.5 hover:border-[#d9c991] hover:shadow-[0_15px_34px_rgba(57,49,24,0.11)] focus:outline-none focus:ring-2 focus:ring-[#e4ae29] focus:ring-offset-2"
                                >
                                    <span className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${style.accent}`} />
                                    <span className={`absolute -right-8 -top-10 h-28 w-28 rounded-full bg-gradient-to-br opacity-15 blur-2xl ${style.accent}`} />
                                    <span className="relative flex min-w-0 flex-1 flex-col">
                                        <span className="flex items-start justify-between gap-3">
                                            <span>
                                                <span className="block text-[16px] font-semibold text-[#292722]">{t(style.name)}</span>
                                                <span className="mt-1 block text-[11.5px] font-medium text-[#aa8750]">{t(style.description)}</span>
                                            </span>
                                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f8efcf] text-[#a97710] transition group-hover:bg-[#edc663] group-hover:text-[#4e3706]">
                                                <ArrowUp size={15} className="rotate-45" />
                                            </span>
                                        </span>
                                        <span className="mt-5 line-clamp-4 text-[12px] leading-5 text-gray-400">{t(style.prompt)}</span>
                                        <span className="mt-auto pt-5 text-[11px] font-medium text-[#81765c]">{t('应用模版并开始创作')}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-dashed border-[#e6e1d5] py-16 text-center text-[13px] text-gray-400">{t('没有找到匹配的图像模版')}</div>
                    )}
                </div>
            </section>
        </div>
    );
}

export default function FlowHome() {
    const [activeMode, setActiveMode] = useState('home');
    const [text, setText] = useState('');
    // 画布：当前打开的项目（null = 项目列表态）
    const [currentProject, setCurrentProject] = useState(null);
    // 模板：应用到图片/视频工具
    const [appliedTemplate, setAppliedTemplate] = useState(null);
    // 首页输入卡片：当前选中的生图模型（与图片工具的模型列表一致）
    const [imageModel, setImageModel] = useState(
        IMAGE_MODELS.includes(VOD_DEFAULT_IMAGE_MODEL_NAME) ? VOD_DEFAULT_IMAGE_MODEL_NAME : IMAGE_MODELS[0]
    );
    const [imageModelVersion, setImageModelVersion] = useState(() => defaultImageModelVersion(
        IMAGE_MODELS.includes(VOD_DEFAULT_IMAGE_MODEL_NAME) ? VOD_DEFAULT_IMAGE_MODEL_NAME : IMAGE_MODELS[0]
    ));
    const [homeGenerationType, setHomeGenerationType] = useState('image');
    const [videoModel, setVideoModel] = useState(VOD_DEFAULT_VIDEO_MODEL_NAME);
    const [videoModelVersion, setVideoModelVersion] = useState(VOD_DEFAULT_VIDEO_MODEL_VERSION);
    const [homeVideoResolution, setHomeVideoResolution] = useState('1080P');
    const [homeVideoDuration, setHomeVideoDuration] = useState('5s');
    const [homeVideoAudio, setHomeVideoAudio] = useState(true);
    const [homeVideoSubjectText, setHomeVideoSubjectText] = useState('');
    const [homeImageLoading, setHomeImageLoading] = useState(false);
    const [homeImageStage, setHomeImageStage] = useState('');
    const [homeImageResults, setHomeImageResults] = useState([]);
    const [homeVideoLoading, setHomeVideoLoading] = useState(false);
    const [homeVideoStage, setHomeVideoStage] = useState('');
    const [homeVideoResults, setHomeVideoResults] = useState([]);
    const [homeReferenceImages, setHomeReferenceImages] = useState([]);
    const [homeAspectRatio, setHomeAspectRatio] = useState('16:9');
    const [homeResolution, setHomeResolution] = useState('1K');
    const [homeEnhancePrompt, setHomeEnhancePrompt] = useState(true);
    const [homeStorageMode, setHomeStorageMode] = useState(() => {
        try {
            return localStorage.getItem('txstudio_aigc_storage_mode') === 'Permanent' ? 'Permanent' : 'Temporary';
        } catch {
            return 'Temporary';
        }
    });
    const [homeParameterOpen, setHomeParameterOpen] = useState(null);
    const [homeParameterError, setHomeParameterError] = useState('');
    const homeReferenceInputRef = useRef(null);
    const [modelOpen, setModelOpen] = useState(false);
    const [quickInspirationOpen, setQuickInspirationOpen] = useState(false);
    const [styleCategory, setStyleCategory] = useState('all');
    const [styleQuery, setStyleQuery] = useState('');
    const [imageTemplateMode, setImageTemplateMode] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [capabilityCategory, setCapabilityCategory] = useState('commerce');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [canvasToolsOpen, setCanvasToolsOpen] = useState(true);
    const [canvasUiState, setCanvasUiState] = useState({
        activeTool: 'select',
        historyOpen: false,
        charactersOpen: false,
        storyboardAssetsOpen: false,
        isChatOpen: false,
    });
    const canvasActionsRef = useRef(null);

    const MODES = BASE_MODES;
    const homeModelCapability = getVodImageModelCapability(imageModel, imageModelVersion);
    const homeModelVersions = VOD_IMAGE_MODEL_MATRIX[imageModel] || [];
    const homeVideoModelVersions = VOD_VIDEO_MODEL_MATRIX[videoModel] || [];
    const isHomeVideo = homeGenerationType === 'video';
    const isKlingExtendedVideo = videoModel === 'Kling' && ['3.0', '3.0-Omni'].includes(videoModelVersion);
    const homeVideoReferenceFeature = !isHomeVideo
        ? ''
        : videoModel === 'Kling' && videoModelVersion === '3.0'
            ? 'firstLastFrame'
            : videoModel === 'Kling' && videoModelVersion === '3.0-Omni'
                ? 'multiReference'
                : videoModel === 'Kling' && videoModelVersion === 'O1'
                    ? 'subjectReference'
                    : '';
    const supportsHomeVideoSubjects = isHomeVideo && videoModel === 'Kling' && ['O1', '3.0-Omni'].includes(videoModelVersion);
    const homeVideoSubjectInfos = isHomeVideo ? parseHomeVideoSubjectInfos(homeVideoSubjectText) : [];
    const homeReferenceLimit = isHomeVideo
        ? (homeVideoReferenceFeature === 'firstLastFrame' ? 2 : VIDEO_REFERENCE_LIMIT)
        : homeModelCapability.maxReferences;
    const homeRatioOptions = isHomeVideo ? VOD_VIDEO_RATIOS : homeModelCapability.ratios;
    const homeResolutionOptions = isHomeVideo ? VIDEO_RESOLUTIONS : homeModelCapability.resolutions;
    const homeVideoDurationOptions = isKlingExtendedVideo ? KLING_EXTENDED_DURATIONS : DEFAULT_VIDEO_DURATIONS;
    const activeHomeModel = isHomeVideo ? videoModel : imageModel;
    const activeHomeModelVersion = isHomeVideo ? videoModelVersion : imageModelVersion;
    const homeGenerationLoading = isHomeVideo ? homeVideoLoading : homeImageLoading;
    const homeAnyGenerationLoading = homeImageLoading || homeVideoLoading;
    const homeGenerationStage = isHomeVideo ? homeVideoStage : homeImageStage;
    const visibleCapabilities = capabilityCategory === 'all'
        ? IMAGE_CAPABILITIES
        : IMAGE_CAPABILITIES.filter((item) => item.category === capabilityCategory);
    const normalizedStyleQuery = styleQuery.trim().toLowerCase();
    const visibleStyles = IMAGE_INSPIRATIONS.filter((style) => {
        const matchesCategory = styleCategory === 'all' || style.category === styleCategory;
        const matchesQuery = !normalizedStyleQuery || [style.name, style.description, style.prompt]
            .some((value) => value.toLowerCase().includes(normalizedStyleQuery));
        return matchesCategory && matchesQuery;
    });

    useEffect(() => {
        const openGlobalSettings = () => setSettingsOpen(true);
        window.addEventListener('txstudio:open-api-settings', openGlobalSettings);
        return () => window.removeEventListener('txstudio:open-api-settings', openGlobalSettings);
    }, []);

    useEffect(() => {
        if (!quickInspirationOpen) return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape') setQuickInspirationOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [quickInspirationOpen]);

    const registerCanvasActions = useCallback((actions) => {
        canvasActionsRef.current = actions;
    }, []);
    const syncCanvasUiState = useCallback((nextState) => {
        setCanvasUiState((previous) => {
            const unchanged = Object.keys(previous).every((key) => previous[key] === nextState[key]);
            return unchanged ? previous : nextState;
        });
    }, []);
    const runCanvasAction = useCallback((action) => {
        const handler = canvasActionsRef.current?.[action];
        if (typeof handler === 'function') handler();
    }, []);
    const isCanvasActionActive = useCallback((action) => {
        if (action === 'select') return canvasUiState.activeTool === 'select' && !canvasUiState.historyOpen && !canvasUiState.charactersOpen && !canvasUiState.storyboardAssetsOpen;
        if (action === 'history') return canvasUiState.historyOpen;
        if (action === 'characters') return canvasUiState.charactersOpen;
        if (action === 'storyboard') return canvasUiState.storyboardAssetsOpen;
        if (action === 'chat') return canvasUiState.isChatOpen;
        return false;
    }, [canvasUiState]);

    // 切换功能 = 只换主区内容，不跳走
    const goMode = (id) => {
        if (id === 'home') {
            goHome();
            return;
        }
        if (id === 'canvas') {
            if (activeMode === 'canvas' && currentProject) {
                setCanvasToolsOpen((open) => !open);
                return;
            }
            setCurrentProject(null);
            setCanvasToolsOpen(true);
        }
        if (id === 'image') {
            setImageTemplateMode(true);
        }
        setActiveMode(id);
    };
    const goHome = () => { setActiveMode('home'); setCurrentProject(null); };

    const openImageTemplate = (style) => {
        setAppliedTemplate({
            type: 'image',
            model_name: style.is_custom ? style.model_name : imageModel,
            model_version: style.is_custom ? style.model_version : imageModelVersion,
            prompt: style.prompt,
            source_prompt: '',
            ratio: style.is_custom ? style.ratio : homeAspectRatio,
            resolution: style.is_custom ? style.resolution : homeResolution,
            enhance_prompt: style.is_custom ? style.enhance_prompt : (homeEnhancePrompt ? 'Enabled' : 'Disabled'),
            storage_mode: style.is_custom ? style.storage_mode : homeStorageMode,
            inspiration: style,
        });
        setImageTemplateMode(false);
        setActiveMode('image');
    };

    const applyQuickInspiration = (inspiration) => {
        setText(inspiration.prompt);
        setQuickInspirationOpen(false);
    };

    const switchHomeGenerationType = (type) => {
        if (homeAnyGenerationLoading) return;
        setHomeGenerationType(type);
        setModelOpen(false);
        setHomeParameterOpen(null);
        setHomeParameterError('');
        if (type === 'video') {
            setHomeAspectRatio((current) => VOD_VIDEO_RATIOS.includes(current) ? current : '16:9');
            setHomeResolution(homeVideoResolution);
        } else {
            setHomeAspectRatio((current) => homeModelCapability.ratios.includes(current) ? current : homeModelCapability.defaultRatio);
            setHomeResolution((current) => homeModelCapability.resolutions.includes(current) ? current : homeModelCapability.defaultResolution);
        }
    };

    const selectHomeModel = (modelName) => {
        const nextVersion = defaultImageModelVersion(modelName);
        const nextCapability = getVodImageModelCapability(modelName, nextVersion);
        setImageModel(modelName);
        setImageModelVersion(nextVersion);
        setHomeAspectRatio((current) => nextCapability.ratios.includes(current) ? current : nextCapability.defaultRatio);
        setHomeResolution((current) => nextCapability.resolutions.includes(current) ? current : nextCapability.defaultResolution);
        setHomeParameterError('');
    };

    const selectHomeVideoModel = (modelName) => {
        const versions = VOD_VIDEO_MODEL_MATRIX[modelName] || [];
        const nextVersion = modelName === VOD_DEFAULT_VIDEO_MODEL_NAME && versions.includes(VOD_DEFAULT_VIDEO_MODEL_VERSION)
            ? VOD_DEFAULT_VIDEO_MODEL_VERSION
            : versions[0] || '';
        setVideoModel(modelName);
        setVideoModelVersion(nextVersion);
        if (!(modelName === 'Kling' && ['3.0', '3.0-Omni'].includes(nextVersion))) {
            setHomeVideoDuration((current) => DEFAULT_VIDEO_DURATIONS.includes(current) ? current : '5s');
        }
        setHomeParameterError('');
    };

    const selectHomeModelVersion = (modelVersion) => {
        const nextCapability = getVodImageModelCapability(imageModel, modelVersion);
        setImageModelVersion(modelVersion);
        setHomeAspectRatio((current) => nextCapability.ratios.includes(current) ? current : nextCapability.defaultRatio);
        setHomeResolution((current) => nextCapability.resolutions.includes(current) ? current : nextCapability.defaultResolution);
        setHomeParameterError('');
    };

    const selectHomeVideoModelVersion = (modelVersion) => {
        setVideoModelVersion(modelVersion);
        if (!(videoModel === 'Kling' && ['3.0', '3.0-Omni'].includes(modelVersion))) {
            setHomeVideoDuration((current) => DEFAULT_VIDEO_DURATIONS.includes(current) ? current : '5s');
        }
        setHomeParameterError('');
    };

    const handleHomeReferenceUpload = (files) => {
        const list = Array.from(files || []);
        const remaining = Math.max(0, homeReferenceLimit - homeReferenceImages.length);
        const validFiles = list.filter((file) => REFERENCE_IMAGE_TYPES.has(file?.type) && file.size > 0 && file.size <= HOME_REFERENCE_MAX_BYTES);
        if (!remaining) {
            setHomeParameterError(`当前 ${activeHomeModel} ${activeHomeModelVersion} 最多支持 ${homeReferenceLimit} 张参考图`);
        } else if (!validFiles.length) {
            setHomeParameterError('请选择单张不超过 20MB 的 JPG、PNG 或 WEBP 图片');
        } else {
            const accepted = validFiles.slice(0, remaining).map((file) => ({ file, preview: URL.createObjectURL(file) }));
            setHomeReferenceImages((previous) => [...previous, ...accepted]);
            setHomeParameterError(validFiles.length > remaining ? `已按当前模型上限添加前 ${remaining} 张参考图` : '');
        }
        if (homeReferenceInputRef.current) homeReferenceInputRef.current.value = '';
    };

    const removeHomeReference = (index) => {
        setHomeReferenceImages((previous) => {
            const removed = previous[index];
            if (removed?.preview) URL.revokeObjectURL(removed.preview);
            return previous.filter((_, currentIndex) => currentIndex !== index);
        });
        setHomeParameterError('');
    };

    // 图片和视频均在首页完成参数校验、任务提交、进度反馈和结果展示。
    const handleSend = async () => {
        if (homeAnyGenerationLoading) return;
        if (homeReferenceImages.length > homeReferenceLimit) {
            setHomeParameterError(`当前模型最多支持 ${homeReferenceLimit} 张参考图，请删除多余图片后再生成`);
            return;
        }
        const value = text.trim();
        if (!value && !homeReferenceImages.length && !(isHomeVideo && homeVideoSubjectInfos.length)) {
            setHomeParameterError(isHomeVideo ? '请输入提示词、上传参考图或填写角色主体 ID' : '请输入提示词或上传至少一张参考图');
            return;
        }
        if (value) {
            try { sessionStorage.setItem('txstudio_prompt', value); } catch { /* 忽略 */ }
        }
        if (!isHomeVideo) {
            setHomeImageLoading(true);
            setHomeParameterError('');
            setHomeImageResults([]);
            setHomeImageStage('正在创建图片任务');
            try {
                const { urls } = await runVodAigcPipeline({
                    type: 'image',
                    modelName: imageModel,
                    modelVersion: imageModelVersion,
                    prompt: value,
                    enhancePrompt: homeEnhancePrompt ? 'Enabled' : 'Disabled',
                    sourceImages: homeReferenceImages.map((item) => item.file),
                    aspectRatio: homeAspectRatio || undefined,
                    extraConfig: {
                        ...(homeResolution ? { Resolution: homeResolution } : {}),
                        StorageMode: homeStorageMode,
                    },
                }, {
                    ...HOME_PIPELINE_CONTEXT,
                    history: { source: 'home', parameters: { entry: 'home_image' } },
                    onStage: (stage) => setHomeImageStage(IMAGE_STAGE_LABELS[stage] || '正在生成图片'),
                });
                setHomeImageResults(urls);
                setHomeImageStage('图片生成完成');
            } catch (error) {
                setHomeParameterError(`生成失败：${error?.message || '未知错误'}`);
                setHomeImageStage('');
            } finally {
                setHomeImageLoading(false);
            }
            return;
        }

        setHomeVideoLoading(true);
        setHomeParameterError('');
        setHomeVideoResults([]);
        setHomeVideoStage('正在创建视频任务');
        try {
            const referenceFiles = homeReferenceImages.map((item) => item.file);
            const subjectOnly = homeVideoReferenceFeature === 'subjectReference' && homeVideoSubjectInfos.length > 0;
            const sourceImages = subjectOnly ? [] : referenceFiles;
            const sourceFileInfos = homeVideoReferenceFeature === 'firstLastFrame'
                ? referenceFiles.map((_, index) => index === 0 ? { Usage: 'FirstFrame' } : null)
                : homeVideoReferenceFeature === 'multiReference'
                    ? referenceFiles.map(() => ({ Usage: 'Reference', Category: 'Image' }))
                    : undefined;
            const { urls } = await runVodAigcPipeline({
                type: 'video',
                modelName: videoModel,
                modelVersion: videoModelVersion,
                prompt: value,
                enhancePrompt: homeEnhancePrompt ? 'Enabled' : 'Disabled',
                sourceImages,
                sourceFileInfos,
                lastFrameSourceIndex: homeVideoReferenceFeature === 'firstLastFrame' && referenceFiles.length > 1 ? 1 : undefined,
                aspectRatio: homeAspectRatio,
                extraTaskParams: supportsHomeVideoSubjects && homeVideoSubjectInfos.length
                    ? { subjectInfos: homeVideoSubjectInfos }
                    : undefined,
                extraConfig: {
                    Duration: Number.parseInt(homeVideoDuration, 10),
                    Resolution: homeVideoResolution,
                    AudioGeneration: homeVideoAudio ? 'Enabled' : 'Disabled',
                    StorageMode: homeStorageMode,
                },
            }, {
                ...HOME_PIPELINE_CONTEXT,
                history: { source: 'home', parameters: { entry: 'home_video', audio_generation: homeVideoAudio } },
                onStage: (stage) => setHomeVideoStage(VIDEO_STAGE_LABELS[stage] || '正在生成视频'),
            });
            setHomeVideoResults(urls);
            setHomeVideoStage('视频生成完成');
        } catch (error) {
            setHomeParameterError(`生成失败：${error?.message || '未知错误'}`);
            setHomeVideoStage('');
        } finally {
            setHomeVideoLoading(false);
        }
    };

    // 模板应用 → 切到对应工具
    const handleApplyTemplate = (tpl) => {
        setAppliedTemplate(tpl);
        if (tpl.type === 'image') setImageTemplateMode(false);
        setActiveMode(tpl.type === 'image' ? 'image' : 'video');
    };

    // AI 换装使用腾讯云 MPS 专用工作台；其余能力复用通用图片工具。
    const openCapability = (capability) => {
        if (capability.id === 'change-clothes') {
            setActiveMode('ai-outfit');
            return;
        }
        if (capability.id === 'erase') {
            setActiveMode('watermark-erase');
            return;
        }
        if (capability.id === 'restore') {
            setActiveMode('old-photo-restore');
            return;
        }
        if (capability.id === 'foreground') {
            setActiveMode('foreground-extraction');
            return;
        }
        if (capability.id === 'change-model') {
            setActiveMode('change-model');
            return;
        }
        handleApplyTemplate({
            type: 'image',
            capability_id: capability.id,
            capability_name: capability.name,
            description: capability.description,
            ref_image_count: capability.refCount,
            model_name: imageModel,
            model_version: imageModelVersion,
            ratio: homeAspectRatio,
            resolution: homeResolution,
            enhance_prompt: homeEnhancePrompt ? 'Enabled' : 'Disabled',
            storage_mode: homeStorageMode,
            prompt: capability.prompt,
        });
    };

    // 进入画布编辑器（深色沉浸式）时，主区铺满
    const inCanvasEditor = activeMode === 'canvas' && !!currentProject;

    // 当前功能的中文名（用于工具区面包屑）
    const currentLabel = activeMode === 'ai-outfit'
        ? 'AI 换装'
        : activeMode === 'watermark-erase'
            ? '智能擦除'
            : activeMode === 'foreground-extraction'
                ? '前景提取'
                : activeMode === 'change-model'
                    ? 'AI 换模特'
                    : activeMode === 'history'
                ? '生成历史'
                : (MODES.find((m) => m.id === activeMode) || {}).label || '';
    const canvasToolItems = [
        { id: 'autoArrange', label: '自动整理', icon: Layout },
        { id: 'select', label: '选择与移动', icon: MousePointer2 },
        { id: 'history', label: '生成历史', icon: History },
        { id: 'characters', label: '角色库', icon: Users },
        { id: 'storyboard', label: '分镜素材', icon: LayoutGrid },
        { id: 'chat', label: 'AI 对话', icon: MessageSquare },
        { id: 'download', label: '下载选中内容', icon: Download },
        { id: 'importWorkflow', label: '导入工作流', icon: UploadCloud },
    ];

    return (
        <div className="flex h-screen w-full overflow-hidden bg-white font-sans text-[#1f2329]">
            {/* ============ 侧边栏 ============ */}
            <aside className={`flex flex-shrink-0 flex-col border-r border-[#ececef] py-4 transition-[width,padding] duration-200 ${sidebarCollapsed ? 'w-[68px] px-2' : 'w-[232px] px-3'}`}>
                {/* Logo + 折叠 */}
                <div className="flex items-center justify-between px-2 pb-4">
                    <button
                        onClick={goHome}
                        title={t('返回首页')}
                        className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-gradient-to-br from-neutral-800 to-black font-serif text-[15px] font-bold text-white"
                    >
                        V
                    </button>
                    <button
                        type="button"
                        onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-[#f4f4f5] hover:text-gray-600"
                        title={sidebarCollapsed ? t('展开侧栏') : t('收起侧栏')}
                        aria-label={sidebarCollapsed ? t('展开侧栏') : t('收起侧栏')}
                    >
                        <PanelLeft size={16} className={sidebarCollapsed ? 'rotate-180' : ''} />
                    </button>
                </div>

                {/* 主导航 = 真实功能 */}
                <nav className="mt-0.5 flex flex-col gap-0.5">
                    {SIDEBAR_MODES.map(({ id, label, icon: Icon }) => {
                        const isCanvas = id === 'canvas';
                        const isActive = activeMode === id;
                        return (
                            <React.Fragment key={id}>
                                <button
                                    type="button"
                                    onClick={() => goMode(id)}
                                    title={sidebarCollapsed ? t(label) : undefined}
                                    className={`flex w-full items-center rounded-lg py-2 text-[13.5px] transition ${sidebarCollapsed ? 'justify-center px-2' : 'gap-[11px] px-[9px]'} ${isActive
                                        ? 'bg-[#f4f4f5] text-[#1f2329]'
                                        : 'text-gray-500 hover:bg-[#f4f4f5] hover:text-[#1f2329]'
                                        }`}
                                >
                                    <Icon size={16} className="flex-shrink-0" />
                                    {!sidebarCollapsed && <span className="min-w-0 flex-1 truncate text-left">{t(label)}</span>}
                                    {!sidebarCollapsed && isCanvas && (
                                        <ChevronDown size={14} className={`flex-shrink-0 transition-transform ${inCanvasEditor && canvasToolsOpen ? '' : '-rotate-90'}`} />
                                    )}
                                </button>
                                {isCanvas && inCanvasEditor && canvasToolsOpen && !sidebarCollapsed && (
                                    <div className="ml-4 mt-1 space-y-0.5 border-l border-[#e6e3da] pl-2">
                                        {canvasToolItems.map(({ id: action, label: actionLabel, icon: ActionIcon }) => {
                                            const active = isCanvasActionActive(action);
                                            return (
                                                <button
                                                    key={action}
                                                    type="button"
                                                    onClick={() => runCanvasAction(action)}
                                                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition ${active
                                                        ? 'bg-[#f7edcf] text-[#4a3910]'
                                                        : 'text-gray-500 hover:bg-[#f4f4f5] hover:text-[#1f2329]'
                                                        }`}
                                                >
                                                    <ActionIcon size={14} className="flex-shrink-0" />
                                                    <span className="truncate">{t(actionLabel)}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}
                </nav>

                {!sidebarCollapsed && (
                    <>
                        {/* 项目 */}
                        <div className="mt-3.5 flex items-center justify-between px-[9px] py-1.5 text-[12.5px] text-gray-400">
                            <span className="flex items-center gap-1.5">{t('项目')} <ChevronDown size={11} /></span>
                            <button type="button" onClick={() => goMode('canvas')} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#f4f4f5]" title={t('项目列表')}>
                                <LayoutGrid size={14} />
                            </button>
                        </div>

                        {/* 统一生成历史 */}
                        <button type="button" onClick={() => goMode('history')} className="mt-3.5 flex w-full items-center justify-between rounded-lg px-[9px] py-2 text-[12.5px] text-gray-400 hover:bg-[#f4f4f5] hover:text-[#1f2329]">
                            <span className="flex items-center gap-1.5"><History size={14} />{t('查看全部生成历史')}</span>
                            <ChevronDown size={11} className="-rotate-90" />
                        </button>
                        <div className="flex-1" />

                        <div className="mt-2 border-t border-[#ececef] px-[9px] pt-3 text-[11px] text-gray-300">
                            {t('本地单用户模式')}
                        </div>
                    </>
                )}
            </aside>

            {/* ============ 主区域 ============ */}
            <main className="relative flex min-w-0 flex-1 flex-col">
                <div className="absolute right-5 top-4 z-50">
                    <button
                        type="button"
                        onClick={() => setSettingsOpen(true)}
                        className="flex items-center gap-2 rounded-xl border border-[#e4e4e7] bg-white/95 px-3.5 py-2 text-[13px] font-medium text-[#3f3f46] shadow-sm backdrop-blur hover:bg-[#f4f4f5]"
                    >
                        <Settings size={15} />
                        {t('API 设置')}
                    </button>
                </div>

                {/* 内容区 */}
                <div className="relative min-h-0 flex-1">
                    {/* ---- 落地态 Home ---- */}
                    {activeMode === 'home' && (
                        <div className="h-full overflow-y-auto px-4 sm:px-6">
                            <div className="mx-auto flex min-h-full w-full max-w-[1180px] flex-col items-center justify-center py-14 sm:py-16">
                                <h1 className="flex max-w-full flex-wrap items-baseline justify-center gap-x-3 gap-y-1 px-3 pb-2 text-center text-[36px] font-bold leading-[1.15] tracking-[-0.035em] text-[#1f2329] sm:text-[46px]">
                                    <span className="font-script inline-block bg-gradient-to-r from-[#4cc2c4] to-[#4a90d9] bg-clip-text px-1 pb-1 text-[48px] leading-[1.15] text-transparent sm:text-[60px]">
                                        txstudio empowers
                                    </span>
                                    <span className="whitespace-nowrap">your success</span>
                                </h1>
                                <p className="mt-2.5 text-sm text-gray-400 sm:mt-3.5">{t('好的灵感，从这里开始')}</p>

                                {/* 输入卡片 */}
                                <div className="mt-7 w-full max-w-[960px] rounded-2xl border border-[#ececef] bg-white p-5 px-5 pb-4 shadow-[0_10px_30px_rgba(0,0,0,0.045)] sm:px-6">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="inline-flex rounded-lg bg-[#f4f4f5] p-1">
                                            <button
                                                type="button"
                                                onClick={() => switchHomeGenerationType('image')}
                                                disabled={homeAnyGenerationLoading}
                                                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition disabled:cursor-not-allowed ${!isHomeVideo ? 'bg-white text-[#1f2329] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                            >
                                                <ImageIcon size={14} />{t('生成图片')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => switchHomeGenerationType('video')}
                                                disabled={homeAnyGenerationLoading}
                                                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition disabled:cursor-not-allowed ${isHomeVideo ? 'bg-white text-[#1f2329] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                            >
                                                <Video size={14} />{t('生成视频')}
                                            </button>
                                        </div>
                                        <div className="relative inline-flex">
                                        <button
                                            type="button"
                                            onClick={() => { setQuickInspirationOpen((open) => !open); setModelOpen(false); }}
                                            aria-expanded={quickInspirationOpen}
                                            aria-controls="home-quick-inspirations"
                                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition ${quickInspirationOpen
                                                ? 'border-[#e5bd57] bg-[#fff9e9] text-[#5c4510]'
                                                : 'border-[#ececef] text-gray-500 hover:bg-[#f4f4f5] hover:text-[#292722]'
                                                }`}
                                        >
                                            <Sparkles size={13} className={quickInspirationOpen ? 'text-[#c58b15]' : ''} />
                                            {t('灵感')}
                                            <ChevronDown size={12} className={quickInspirationOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                                        </button>

                                        {quickInspirationOpen && (
                                            <>
                                                <button
                                                    type="button"
                                                    tabIndex={-1}
                                                    aria-label={t('关闭灵感菜单')}
                                                    onClick={() => setQuickInspirationOpen(false)}
                                                    className="fixed inset-0 z-10 cursor-default"
                                                />
                                                <section
                                                    id="home-quick-inspirations"
                                                    aria-label={t('灵感快捷提示词')}
                                                    className="absolute left-0 top-[calc(100%+9px)] z-20 w-[min(310px,calc(100vw-48px))] overflow-hidden rounded-xl border border-[#e4e0d4] bg-white py-1.5 shadow-[0_16px_38px_rgba(49,42,24,0.16)]"
                                                >
                                                    <div className="border-b border-[#f0eee9] px-3 py-2 text-[10.5px] font-medium tracking-[0.08em] text-[#a38749]">
                                                        {t('快捷提示词')}
                                                    </div>
                                                    <div className="max-h-[342px] overflow-y-auto py-1">
                                                        {HOME_QUICK_INSPIRATIONS.map((inspiration) => (
                                                            <button
                                                                key={inspiration.id}
                                                                type="button"
                                                                title={inspiration.prompt}
                                                                onClick={() => applyQuickInspiration(inspiration)}
                                                                className="group flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#3b3934] transition hover:bg-[#fff8e6] hover:text-[#8b6411]"
                                                            >
                                                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#e4c77b] opacity-0 transition group-hover:opacity-100" />
                                                                <span className="truncate">{t(inspiration.name)}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </section>
                                            </>
                                        )}
                                        </div>
                                    </div>

                                    <textarea
                                        value={text}
                                        onChange={(e) => setText(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                        rows={4}
                                        placeholder={t(isHomeVideo ? '描述画面主体、动作、镜头运动与氛围...' : '每个伟大的想法都始于一个念头...')}
                                        className="mt-5 block min-h-[112px] w-full resize-none border-0 bg-transparent text-[15px] leading-7 text-[#1f2329] placeholder-gray-400 focus:outline-none focus:ring-0"
                                    />

                                    {isHomeVideo && (
                                        <div className="mt-2 rounded-xl border border-[#ebe7dc] bg-[#fcfbf8] p-3">
                                            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-[1.45fr_.72fr_.72fr_.72fr_.78fr]">
                                                <label className="min-w-0">
                                                    <span className="mb-1 block text-[10px] font-medium text-[#81796a]">{t('视频模型')}</span>
                                                    <div className="grid grid-cols-2 gap-1.5">
                                                        <select id="home-video-model" name="home-video-model" aria-label={t('视频模型')} value={videoModel} onChange={(event) => selectHomeVideoModel(event.target.value)} className="h-8 min-w-0 rounded-lg border border-[#e3ded1] bg-white px-2.5 text-[11.5px] text-[#36332d] outline-none focus:border-[#d4aa42]">
                                                            {VIDEO_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
                                                        </select>
                                                        <select id="home-video-model-version" name="home-video-model-version" aria-label={t('模型版本')} value={videoModelVersion} onChange={(event) => selectHomeVideoModelVersion(event.target.value)} className="h-8 min-w-0 rounded-lg border border-[#e3ded1] bg-white px-2.5 text-[11.5px] text-[#36332d] outline-none focus:border-[#d4aa42]">
                                                            {homeVideoModelVersions.map((version) => <option key={version} value={version}>{version}</option>)}
                                                        </select>
                                                    </div>
                                                </label>
                                                <label>
                                                    <span className="mb-1 block text-[10px] font-medium text-[#81796a]">{t('清晰度')}</span>
                                                    <select value={homeVideoResolution} onChange={(event) => { setHomeVideoResolution(event.target.value); setHomeResolution(event.target.value); }} aria-label={t('视频清晰度')} className="h-8 w-full rounded-lg border border-[#e3ded1] bg-white px-2.5 text-[11.5px] text-[#36332d] outline-none focus:border-[#d4aa42]">
                                                        {VIDEO_RESOLUTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
                                                    </select>
                                                </label>
                                                <label>
                                                    <span className="mb-1 block text-[10px] font-medium text-[#81796a]">{t('时长')}</span>
                                                    <select value={homeVideoDuration} onChange={(event) => setHomeVideoDuration(event.target.value)} aria-label={t('生成时长')} className="h-8 w-full rounded-lg border border-[#e3ded1] bg-white px-2.5 text-[11.5px] text-[#36332d] outline-none focus:border-[#d4aa42]">
                                                        {homeVideoDurationOptions.map((duration) => <option key={duration} value={duration}>{duration}</option>)}
                                                    </select>
                                                </label>
                                                <label>
                                                    <span className="mb-1 block text-[10px] font-medium text-[#81796a]">{t('比例')}</span>
                                                    <select value={homeAspectRatio} onChange={(event) => setHomeAspectRatio(event.target.value)} aria-label={t('画面比例')} className="h-8 w-full rounded-lg border border-[#e3ded1] bg-white px-2.5 text-[11.5px] text-[#36332d] outline-none focus:border-[#d4aa42]">
                                                        {VOD_VIDEO_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
                                                    </select>
                                                </label>
                                                <div>
                                                    <span className="mb-1 block text-[10px] font-medium text-[#81796a]">{t('音画')}</span>
                                                    <button type="button" onClick={() => setHomeVideoAudio((enabled) => !enabled)} aria-pressed={homeVideoAudio} className={`flex h-8 w-full items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition ${homeVideoAudio ? 'border border-[#ead394] bg-[#fff3d0] text-[#765611]' : 'border border-[#e3ded1] bg-white text-gray-500'}`}>
                                                        {homeVideoAudio ? <Volume2 size={13} /> : <VolumeX size={13} />}
                                                        {homeVideoAudio ? t('同步') : t('静音')}
                                                    </button>
                                                </div>
                                            </div>
                                            {(homeVideoReferenceFeature || supportsHomeVideoSubjects) && (
                                                <div className="mt-2 flex items-center gap-1.5 border-t border-[#eeeae0] pt-2 text-[10px] text-[#9a7628]">
                                                    <Sparkles size={12} />
                                                    {t(homeVideoReferenceFeature === 'firstLastFrame' ? '支持首帧与尾帧参考' : homeVideoReferenceFeature === 'multiReference' ? '支持多图角色参考与固定主体' : '支持固定主体角色参考')}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-[13px] text-gray-500">
                                        <span className="mr-1 flex items-center gap-1.5">{isHomeVideo ? <Video size={16} /> : <ImageIcon size={16} />} {t(isHomeVideo ? '视频' : '图像')}</span>

                                        {!isHomeVideo && <div className="relative">
                                            <button
                                                type="button"
                                                onClick={() => { setModelOpen((open) => !open); setHomeParameterOpen(null); }}
                                                aria-expanded={modelOpen}
                                                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-[#f4f4f5]"
                                            >
                                                <span className="h-[13px] w-[13px] rounded-full bg-gradient-to-br from-[#a78bfa] to-[#818cf8]" />
                                                <span>{imageModel}</span>
                                                <span className="text-[11px] text-gray-400">{imageModelVersion}</span>
                                                <ChevronDown size={12} />
                                            </button>
                                            {modelOpen && (
                                                <>
                                                    <button type="button" aria-label={t('关闭模型菜单')} className="fixed inset-0 z-10 cursor-default" onClick={() => setModelOpen(false)} />
                                                    <div className="absolute bottom-full left-0 z-20 mb-2 flex w-[340px] overflow-hidden rounded-xl border border-[#e7e4da] bg-white shadow-[0_12px_34px_rgba(37,32,19,0.14)]">
                                                        <div className="w-[152px] border-r border-[#efede7] py-1.5">
                                                            <div className="px-3 py-1.5 text-[10.5px] font-medium tracking-[0.08em] text-[#a38749]">{t('模型')}</div>
                                                            {IMAGE_MODELS.map((modelName) => (
                                                                <button
                                                                    key={modelName}
                                                                    type="button"
                                                                    onClick={() => selectHomeModel(modelName)}
                                                                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] transition hover:bg-[#f5f4f1] ${modelName === imageModel ? 'bg-[#fff8e5] font-medium text-[#634a14]' : 'text-gray-600'}`}
                                                                >
                                                                    <span className="h-[10px] w-[10px] flex-shrink-0 rounded-full bg-gradient-to-br from-[#a78bfa] to-[#818cf8]" />
                                                                    {modelName}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        <div className="min-w-0 flex-1 py-1.5">
                                                            <div className="px-3 py-1.5 text-[10.5px] font-medium tracking-[0.08em] text-[#a38749]">{t('版本')}</div>
                                                            {homeModelVersions.map((version) => (
                                                                <button
                                                                    key={version}
                                                                    type="button"
                                                                    onClick={() => { selectHomeModelVersion(version); setModelOpen(false); }}
                                                                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px] transition hover:bg-[#f5f4f1] ${version === imageModelVersion ? 'font-medium text-[#634a14]' : 'text-gray-600'}`}
                                                                >
                                                                    {version}
                                                                    {version === imageModelVersion && <Check size={13} />}
                                                                </button>
                                                            ))}
                                                            <div className="mx-3 mt-2 border-t border-[#f0eee8] pt-2 text-[10.5px] leading-4 text-gray-400">{t(homeModelCapability.description)}</div>
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>}

                                        <div className="relative">
                                            <button
                                                type="button"
                                                onClick={() => { setHomeParameterOpen((current) => current === 'reference' ? null : 'reference'); setModelOpen(false); }}
                                                aria-expanded={homeParameterOpen === 'reference'}
                                                title={t(`参考图：最多 ${homeReferenceLimit} 张，每张不超过 20MB`)}
                                                className={`relative flex h-8 min-w-8 items-center justify-center rounded-lg px-2 transition ${homeParameterOpen === 'reference' || homeReferenceImages.length || homeVideoSubjectInfos.length
                                                    ? 'bg-[#fff8e5] text-[#9a7016]'
                                                    : 'hover:bg-[#f4f4f5] hover:text-[#1f2329]'
                                                    }`}
                                            >
                                                <Paperclip size={16} />
                                                {(homeReferenceImages.length > 0 || homeVideoSubjectInfos.length > 0) && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#c88b17] px-1 text-[9px] font-semibold text-white">{homeReferenceImages.length + homeVideoSubjectInfos.length}</span>}
                                            </button>
                                            <input
                                                ref={homeReferenceInputRef}
                                                id="home-reference-images"
                                                type="file"
                                                accept={REFERENCE_IMAGE_ACCEPT}
                                                multiple
                                                className="sr-only"
                                                onChange={(event) => handleHomeReferenceUpload(event.target.files)}
                                            />
                                            {homeParameterOpen === 'reference' && (
                                                <>
                                                    <button type="button" aria-label={t('关闭参考图菜单')} className="fixed inset-0 z-10 cursor-default" onClick={() => setHomeParameterOpen(null)} />
                                                    <div className="absolute bottom-full left-0 z-20 mb-2 w-[min(400px,calc(100vw-48px))] rounded-xl border border-[#e7e4da] bg-white p-3 shadow-[0_12px_34px_rgba(37,32,19,0.14)]">
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div><div className="text-[12px] font-semibold text-[#2e2c27]">{t(homeVideoReferenceFeature === 'firstLastFrame' ? '首帧 / 尾帧' : homeVideoReferenceFeature === 'multiReference' ? '角色参考图' : homeVideoReferenceFeature === 'subjectReference' ? '角色参考' : '参考图')}</div><p className="mt-0.5 text-[10.5px] leading-4 text-gray-400">{t(homeVideoReferenceFeature === 'multiReference' ? `最多 ${homeReferenceLimit} 张角色参考图，将以 Reference 提交。` : `当前 ${activeHomeModel} ${activeHomeModelVersion} 最多 ${homeReferenceLimit} 张；单张不超过 20MB。`)}</p></div>
                                                            <Info size={14} className="mt-0.5 shrink-0 text-[#b28b2b]" />
                                                        </div>
                                                        <div className="mt-3 flex flex-wrap gap-2">
                                                            {homeReferenceImages.map((item, index) => (
                                                                <div key={`${item.file.name}-${index}`} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-[#e7e3d9] bg-[#f6f5f2]">
                                                                    <img src={item.preview} alt={t(`参考图 ${index + 1}`)} className="h-full w-full object-cover" />
                                                                    <span className="absolute bottom-0 left-0 right-0 bg-black/55 py-0.5 text-center text-[8px] text-white">{t(homeVideoReferenceFeature === 'firstLastFrame' ? (index === 0 ? '首帧' : '尾帧') : homeVideoReferenceFeature === 'multiReference' ? '角色参考' : `参考 ${index + 1}`)}</span>
                                                                    <button type="button" onClick={() => removeHomeReference(index)} aria-label={t('删除参考图')} className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition group-hover:opacity-100"><X size={11} /></button>
                                                                </div>
                                                            ))}
                                                            {homeReferenceImages.length < homeReferenceLimit && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => homeReferenceInputRef.current?.click()}
                                                                    className="flex h-14 w-14 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#d8d2c2] text-[#9b8961] transition hover:border-[#c79428] hover:bg-[#fff9eb] hover:text-[#9a7016] focus:outline-none focus:ring-2 focus:ring-[#e7b238] focus:ring-offset-1"
                                                                    title={t(`添加参考图（最多 ${homeReferenceLimit} 张）`)}
                                                                    aria-label={t(`添加参考图（最多 ${homeReferenceLimit} 张）`)}
                                                                >
                                                                    <Paperclip size={15} />
                                                                    <span className="mt-1 text-[9px]">{t('添加')}</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                        {isHomeVideo && supportsHomeVideoSubjects && (
                                                            <label className="mt-3 block border-t border-[#efebe2] pt-3">
                                                                <span className="flex items-center justify-between gap-2 text-[10.5px] font-medium text-[#665b43]"><span>{t('固定角色主体')}</span><span className="font-normal text-gray-400">{t('每行：主体 ID | 角色名')}</span></span>
                                                                <textarea value={homeVideoSubjectText} onChange={(event) => setHomeVideoSubjectText(event.target.value)} rows={2} placeholder={t('subject-id-001 | 女主角')} className="mt-1.5 w-full resize-none rounded-lg border border-[#e5dfd1] bg-[#fcfbf8] px-2.5 py-2 text-[11px] leading-5 text-[#3b3730] outline-none placeholder:text-gray-300 focus:border-[#d5ad4b]" />
                                                                <p className="mt-1 text-[9.5px] leading-4 text-gray-400">{t('Kling O1 / 3.0-Omni 将通过 SubjectInfos 保持角色身份一致。')}</p>
                                                            </label>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => setHomeEnhancePrompt((enabled) => !enabled)}
                                            aria-pressed={homeEnhancePrompt}
                                            title={homeEnhancePrompt ? t('已开启提示词增强') : t('已关闭提示词增强')}
                                            className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${homeEnhancePrompt ? 'bg-[#fff8e5] text-[#e3a526]' : 'text-gray-400 hover:bg-[#f4f4f5]'}`}
                                        >
                                            <Star size={16} className={homeEnhancePrompt ? 'fill-current' : ''} />
                                        </button>

                                        {!isHomeVideo && <>
                                        <div className="relative">
                                            <button
                                                type="button"
                                                onClick={() => { setHomeParameterOpen((current) => current === 'ratio' ? null : 'ratio'); setModelOpen(false); }}
                                                className={`flex h-8 items-center gap-1 rounded-lg px-2.5 transition ${homeParameterOpen === 'ratio' ? 'bg-[#f4f4f5] text-[#292722]' : 'hover:bg-[#f4f4f5] hover:text-[#1f2329]'}`}
                                            >
                                                {homeAspectRatio}<ChevronDown size={12} />
                                            </button>
                                            {homeParameterOpen === 'ratio' && (
                                                <>
                                                    <button type="button" aria-label={t('关闭比例菜单')} className="fixed inset-0 z-10 cursor-default" onClick={() => setHomeParameterOpen(null)} />
                                                    <div className="absolute bottom-full left-0 z-20 mb-2 w-[245px] rounded-xl border border-[#e7e4da] bg-white p-2 shadow-[0_12px_34px_rgba(37,32,19,0.14)]">
                                                        <div className="px-1.5 pb-1.5 text-[10.5px] font-medium tracking-[0.08em] text-[#a38749]">{t('长宽比')}</div>
                                                        <div className="grid grid-cols-3 gap-1">{homeRatioOptions.map((ratio) => <button key={ratio} type="button" onClick={() => { setHomeAspectRatio(ratio); setHomeParameterOpen(null); }} className={`rounded-lg px-2 py-2 text-[12px] transition ${ratio === homeAspectRatio ? 'bg-[#fff1c8] font-medium text-[#684e17]' : 'text-gray-600 hover:bg-[#f5f4f1]'}`}>{ratio}</button>)}</div>
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        <div className="relative">
                                            <button
                                                type="button"
                                                disabled={!homeResolutionOptions.length}
                                                onClick={() => { setHomeParameterOpen((current) => current === 'resolution' ? null : 'resolution'); setModelOpen(false); }}
                                                title={!homeResolutionOptions.length ? t('当前模型使用自由尺寸，未提供固定分辨率档位') : t('输出分辨率')}
                                                className={`flex h-8 items-center gap-1 rounded-lg px-2.5 transition ${!homeResolutionOptions.length ? 'cursor-not-allowed text-gray-300' : homeParameterOpen === 'resolution' ? 'bg-[#f4f4f5] text-[#292722]' : 'hover:bg-[#f4f4f5] hover:text-[#1f2329]'}`}
                                            >
                                                {homeResolution || t('自动')}<ChevronDown size={12} />
                                            </button>
                                            {homeParameterOpen === 'resolution' && homeResolutionOptions.length > 0 && (
                                                <>
                                                    <button type="button" aria-label={t('关闭分辨率菜单')} className="fixed inset-0 z-10 cursor-default" onClick={() => setHomeParameterOpen(null)} />
                                                    <div className="absolute bottom-full left-0 z-20 mb-2 w-[170px] rounded-xl border border-[#e7e4da] bg-white p-2 shadow-[0_12px_34px_rgba(37,32,19,0.14)]">
                                                        <div className="px-1.5 pb-1.5 text-[10.5px] font-medium tracking-[0.08em] text-[#a38749]">{t('输出分辨率')}</div>
                                                        {homeResolutionOptions.map((resolution) => <button key={resolution} type="button" onClick={() => { setHomeResolution(resolution); setHomeParameterOpen(null); }} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[12px] transition ${resolution === homeResolution ? 'bg-[#fff1c8] font-medium text-[#684e17]' : 'text-gray-600 hover:bg-[#f5f4f1]'}`}>{resolution}{resolution === homeResolution && <Check size={13} />}</button>)}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                        </>}

                                        <button
                                            type="button"
                                            onClick={() => setHomeStorageMode((mode) => mode === 'Permanent' ? 'Temporary' : 'Permanent')}
                                            aria-pressed={homeStorageMode === 'Permanent'}
                                            title={homeStorageMode === 'Permanent'
                                                ? t('当前永久保存到 VOD，点击改为临时存储')
                                                : t('当前临时存储，结果有效期为 7 天；点击改为永久保存')}
                                            className={`hidden h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] transition sm:flex ${homeStorageMode === 'Permanent'
                                                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                                : 'text-gray-500 hover:bg-[#f4f4f5] hover:text-[#1f2329]'
                                                }`}
                                        >
                                            <SlidersHorizontal size={13} />
                                            {homeStorageMode === 'Permanent' ? t('永久保存') : t('临时存储')}
                                        </button>
                                        <div className="flex-1" />
                                        <span className="hidden text-[12px] text-gray-400 sm:inline">{t(isHomeVideo ? `${homeVideoResolution} · ${homeVideoDuration}` : '单次 1 张')}</span>
                                        <button
                                            type="button"
                                            onClick={handleSend}
                                            disabled={homeGenerationLoading}
                                            className={`flex h-[36px] flex-shrink-0 items-center justify-center gap-1.5 bg-[#1f2329] text-white transition hover:bg-black focus:outline-none focus:ring-2 focus:ring-[#e7b238] focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${isHomeVideo ? 'min-w-[96px] rounded-lg px-4 text-[12.5px] font-semibold' : 'w-[36px] rounded-full'}`}
                                            aria-label={t(isHomeVideo ? '生成视频' : '开始生成')}
                                        >
                                            {homeGenerationLoading ? <Loader2 size={16} className="animate-spin" /> : isHomeVideo ? <Play size={15} className="fill-current" /> : <ArrowUp size={17} />}
                                            {isHomeVideo && <span>{t(homeGenerationLoading ? '生成中' : '生成视频')}</span>}
                                        </button>
                                    </div>
                                    {(homeParameterError || homeReferenceImages.length > homeReferenceLimit) && (
                                        <div className="mt-3 rounded-lg border border-[#f0d495] bg-[#fff9ea] px-3 py-2 text-[11px] leading-5 text-[#8b681b]">{homeParameterError || t(`当前参考图数量超过 ${activeHomeModel} ${activeHomeModelVersion} 的 ${homeReferenceLimit} 张限制`)}</div>
                                    )}
                                    {homeGenerationStage && !homeParameterError && (
                                        <div className="mt-3 flex items-center gap-2 text-[11.5px] text-[#8b681b]" role="status" aria-live="polite">
                                            {homeGenerationLoading && <Loader2 size={13} className="animate-spin" />}
                                            {t(homeGenerationStage)}
                                        </div>
                                    )}
                                </div>

                                {/* 首页功能导航：生成结果出现时仍保持在结果之前 */}
                                <div className="mt-[34px] flex flex-wrap items-center justify-center gap-2">
                                    {MODES.filter(({ id }) => id !== 'scenario').map(({ id, label, icon: Icon }) => (
                                        <button
                                            key={id}
                                            onClick={() => id === 'video' ? switchHomeGenerationType('video') : goMode(id)}
                                            className={`flex items-center gap-[7px] rounded-[10px] px-4 py-2 text-[13.5px] hover:bg-[#f4f4f5] ${id === 'video' && isHomeVideo ? 'bg-[#fff5d8] text-[#795913]' : 'text-gray-500'}`}
                                        >
                                            <Icon size={16} />
                                            {t(id === 'image' ? '图片' : label)}
                                        </button>
                                    ))}
                                </div>

                                {!isHomeVideo && homeImageResults.length > 0 && (
                                    <section className="mt-5 w-full max-w-[960px]" aria-label={t('图片生成结果')}>
                                        <div className="mb-2.5 flex items-center justify-between px-1">
                                            <div className="flex items-center gap-2 text-[12px] font-medium text-[#5f563f]">
                                                <Sparkles size={14} className="text-[#c58b15]" />
                                                {t('生成结果')}
                                            </div>
                                            <span className="text-[10.5px] text-gray-400">{t(`${imageModel} ${imageModelVersion} · ${homeAspectRatio}${homeResolution ? ` · ${homeResolution}` : ''}`)}</span>
                                        </div>
                                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                            {homeImageResults.map((url, index) => (
                                                <article key={`${url}-${index}`} className="group overflow-hidden rounded-2xl border border-[#ece7da] bg-[#fbfaf7] p-2 shadow-[0_8px_24px_rgba(50,43,24,0.06)]">
                                                    <a href={url} target="_blank" rel="noreferrer" className="relative block overflow-hidden rounded-xl bg-[#f2f0ea]">
                                                        <img src={url} alt={t(`生成图片 ${index + 1}`)} className="aspect-square w-full object-contain transition duration-300 group-hover:scale-[1.015]" />
                                                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-3 pb-2 pt-8 text-[10px] text-white opacity-0 transition group-hover:opacity-100">{t('点击查看原图')}</span>
                                                    </a>
                                                    <div className="flex items-center justify-between px-2 pb-1 pt-2">
                                                        <span className="text-[11.5px] text-gray-400">{t(`生成图片 ${index + 1}`)}</span>
                                                        <a href={url} download target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-[#765611] hover:bg-[#fff1c9]"><Download size={13} />{t('下载')}</a>
                                                    </div>
                                                </article>
                                            ))}
                                        </div>
                                    </section>
                                )}

                                {isHomeVideo && homeVideoResults.length > 0 && (
                                    <section className="mt-5 grid w-full max-w-[960px] gap-4 sm:grid-cols-2">
                                        {homeVideoResults.map((url, index) => (
                                            <div key={`${url}-${index}`} className="overflow-hidden rounded-2xl border border-[#ece7da] bg-[#fbfaf7] p-2 shadow-[0_8px_24px_rgba(50,43,24,0.06)]">
                                                <video src={url} controls playsInline className="aspect-video w-full rounded-xl bg-black object-contain" />
                                                <div className="flex items-center justify-between px-2 pb-1 pt-2">
                                                    <span className="text-[11.5px] text-gray-400">{t(`生成视频 ${index + 1}`)}</span>
                                                    <a href={url} download target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-[#765611] hover:bg-[#fff1c9]"><Download size={13} />{t('下载')}</a>
                                                </div>
                                            </div>
                                        ))}
                                    </section>
                                )}

                            </div>
                        </div>
                    )}

                    {/* ---- 画布编辑器：浅色主题，铺满主区，不跳走（与工作台纯白风格统一） ---- */}
                    {inCanvasEditor && (
                        <div className="absolute inset-0 overflow-hidden bg-[#f6f5ef]">
                            <CanvasApp
                                embedded
                                currentProject={currentProject}
                                onExitToProjects={() => setCurrentProject(null)}
                                onCanvasActionsReady={registerCanvasActions}
                                onCanvasStateChange={syncCanvasUiState}
                            />
                        </div>
                    )}

                    {/* ---- 浅色工具区（图片 / 视频 / 模板 / 画布项目列表） ---- */}
                    {activeMode !== 'home' && !inCanvasEditor && (
                        <div className="theme-light absolute inset-0 flex flex-col bg-white">
                            {/* 工具区面包屑 */}
                            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[#ececef] px-4">
                                <button
                                    onClick={goHome}
                                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-gray-500 hover:bg-[#f4f4f5] hover:text-[#1f2329]"
                                >
                                    <ArrowLeft size={15} />{t('首页')}
                                </button>
                                <span className="text-gray-300">/</span>
                                <span className="text-[13px] font-medium text-[#1f2329]">{t(currentLabel)}</span>
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto">
                                {activeMode === 'agent' && (
                                    <AgentStudio />
                                )}
                                {activeMode === 'history' && (
                                    <GenerationHistory />
                                )}
                                {activeMode === 'image' && imageTemplateMode && (
                                    <ImageTemplateHub
                                        builtInStyles={IMAGE_INSPIRATIONS}
                                        onApply={openImageTemplate}
                                    />
                                )}
                                {activeMode === 'image' && !imageTemplateMode && (
                                    <ImageTool embedded template={appliedTemplate} />
                                )}
                                {activeMode === 'video' && (
                                    <VideoTool embedded template={appliedTemplate} />
                                )}
                                {activeMode === 'ai-outfit' && (
                                    <AIOutfitTool />
                                )}
                                {activeMode === 'watermark-erase' && (
                                    <WatermarkEraseTool />
                                )}
                                {activeMode === 'old-photo-restore' && (
                                    <OldPhotoRestoreTool />
                                )}
                                {activeMode === 'foreground-extraction' && (
                                    <ForegroundExtractionTool />
                                )}
                                {activeMode === 'change-model' && (
                                    <ChangeModelTool />
                                )}
                                {activeMode === 'scenario' && (
                                    <ScenarioCapabilityHub
                                        activeCategory={capabilityCategory}
                                        onCategoryChange={setCapabilityCategory}
                                        capabilities={visibleCapabilities}
                                        onOpenCapability={openCapability}
                                    />
                                )}
                                {activeMode === 'canvas' && (
                                    <ProjectList embedded onOpenProject={(p) => { setCurrentProject(p); setCanvasToolsOpen(true); }} />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </main>
            <GlobalAPISettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </div>
    );
}
