import { apiPost, apiRequest } from './client';

const MPS_VERSION = '2019-06-12';
const TEXT_WATERMARK_ERASE_SCHEDULE_ID = 30000;

export function invokeMps(action, payload, region = '') {
    return apiRequest('/api/mps/invoke', {
        method: 'POST',
        body: JSON.stringify({
            action,
            version: MPS_VERSION,
            region,
            payload: payload || {},
        }),
    }, false, true);
}

export async function uploadMpsImage(file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/mps/assets', { method: 'POST', body: formData });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.success === false) {
        throw new Error(json.error || json.message || `图片上传失败 (${response.status})`);
    }
    return json.data;
}

export const uploadMpsImageFromURL = (url) => apiPost('/api/mps/assets/from-url', { url });

function buildCosImageTaskPayload({ input, outputBucket, outputRegion, outputDir, imageTask, scheduleId, stdExtInfo, addOnParameter }) {
    return {
        InputInfo: {
            Type: 'COS',
            CosInputInfo: {
                Bucket: input.bucket,
                Region: input.region,
                Object: input.object,
            },
        },
        OutputStorage: {
            Type: 'COS',
            CosOutputStorage: { Bucket: outputBucket, Region: outputRegion },
        },
        OutputDir: outputDir,
        ...(imageTask ? { ImageTask: imageTask } : {}),
        ...(scheduleId ? { ScheduleId: scheduleId } : {}),
        ...(stdExtInfo !== undefined ? { StdExtInfo: stdExtInfo } : {}),
        ...(addOnParameter && (addOnParameter.ImageSet?.length || addOnParameter.ExtPrompt?.length || addOnParameter.OutputConfig) ? { AddOnParameter: addOnParameter } : {}),
    };
}

async function submitCosImageTask(payload, outputRegion, failureMessage) {
    const result = await invokeMps('ProcessImage', payload, outputRegion);
    const error = result?.Response?.Error;
    if (error) throw new Error(error.Message || error.Code || failureMessage);
    const taskId = result?.Response?.TaskId;
    if (!taskId) throw new Error('腾讯云 MPS 未返回 TaskId');
    return { taskId, payload, response: result };
}

export function buildTextWatermarkErasePayload({ input, outputBucket, outputRegion }) {
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/watermark/',
        scheduleId: TEXT_WATERMARK_ERASE_SCHEDULE_ID,
    });
}

export function createTextWatermarkEraseTask(options) {
    const payload = buildTextWatermarkErasePayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建智能擦除任务失败');
}

// ---- 图片扩图（官方编排 ScheduleId=30010，OutputConfig.AspectRatio 控制目标比例） ----
export const OUTPAINT_SCHEDULE_ID = 30010;

export function buildOutpaintPayload({ input, outputBucket, outputRegion, aspectRatio = '16:9' }) {
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/padding/',
        scheduleId: OUTPAINT_SCHEDULE_ID,
        addOnParameter: { OutputConfig: { AspectRatio: aspectRatio } },
    });
}

export function createOutpaintTask(options) {
    const payload = buildOutpaintPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建图片扩图任务失败');
}

// ---- 分镜拆图（官方编排 ScheduleId=30050，StoryboardConfig） ----
// processIndex 为空时拆全部分镜；指定数字时只处理该分镜。
export const SPLIT_SCHEDULE_ID = 30050;

export function buildSplitPayload({ input, outputBucket, outputRegion, eraseText = true, modelSampling = 0.1, processIndex = '' }) {
    const config = { EraseText: Boolean(eraseText), ModelSampling: Number(modelSampling) || 0.1 };
    const index = String(processIndex ?? '').trim();
    if (index !== '') config.ProcessIndex = Number(index);
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/split/',
        scheduleId: SPLIT_SCHEDULE_ID,
        stdExtInfo: JSON.stringify({ StoryboardConfig: config }),
    });
}

export function createSplitTask(options) {
    const payload = buildSplitPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建分镜拆图任务失败');
}

// ---- 图片理解（官方编排 ScheduleId=30200，ModelConfig 选用 Gemini，结果为文本） ----
export const UNDERSTAND_SCHEDULE_ID = 30200;

export function buildUnderstandPayload({ input, outputBucket, outputRegion, prompt = '', modelName = 'Google/gemini-2.5-flash', topK = 1 }) {
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/comprehend/',
        scheduleId: UNDERSTAND_SCHEDULE_ID,
        stdExtInfo: JSON.stringify({ ModelConfig: { ModelName: modelName, TopK: Math.max(1, Number(topK) || 1) } }),
        addOnParameter: { ExtPrompt: [{ Prompt: String(prompt || '').trim() }] },
    });
}

export function createUnderstandTask(options) {
    const payload = buildUnderstandPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建图片理解任务失败');
}

// 图片理解轮询：FINISH 后从任务详情提取文本。
// 实测结构：ImageProcessTaskResultSet[0].Output.Content（DescribeImageTaskDetail 返回）。
export async function pollUnderstandTask(taskId, region = '', options = {}) {
    const detail = await pollTextResultTask(taskId, region, options);
    const text = detail?.ImageProcessTaskResultSet?.[0]?.Output?.Content
        || detail?.DescribeText
        || detail?.Result
        || '';
    return { urls: [], detail, text };
}

// 轮询到 FINISH 且无图片输出的纯文本任务（理解 / 盲水印提取）。
async function pollTextResultTask(taskId, region = '', options = {}) {
    const intervalMs = options.intervalMs || 4000;
    const maxAttempts = options.maxAttempts || 300;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const detail = await describeImageTask(taskId, region);
        const status = String(detail.Status || '').toUpperCase();
        options.onPoll?.({ attempt, status, detail });
        if (status === 'FINISH') return detail;
        if (['FAIL', 'FAILED', 'ABORTED'].includes(status)) {
            throw new Error(detail.ErrMsg || '图片处理任务失败');
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('任务查询超时');
}

// ---- 老照片修复（官方编排 ScheduleId=30040，专修复模型） ----
export const PHOTO_RESTORE_SCHEDULE_ID = 30040;

export function buildOldPhotoRestorePayload({ input, outputBucket, outputRegion }) {
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/fix-image/',
        scheduleId: PHOTO_RESTORE_SCHEDULE_ID,
    });
}

export function createOldPhotoRestoreTask(options) {
    const payload = buildOldPhotoRestorePayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建老照片修复任务失败');
}

// ---- 前景提取（官方编排 ScheduleId=30031） ----
export const FOREGROUND_EXTRACTION_SCHEDULE_ID = 30031;

export function buildForegroundExtractionPayload({ input, outputBucket, outputRegion }) {
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/foreground-cutout/',
        scheduleId: FOREGROUND_EXTRACTION_SCHEDULE_ID,
    });
}

export function createForegroundExtractionTask(options) {
    const payload = buildForegroundExtractionPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建前景提取任务失败');
}

// ---- 智能抠图（官方编排 ScheduleId=30030 + CutoutConfig 边缘微调） ----
// transparencyThreshold / opaqueThreshold / edgeSamplingStep 控制发丝级边缘。
export const CUTOUT_SCHEDULE_ID = 30030;

export function buildCutoutPayload({ input, outputBucket, outputRegion, model, transparencyThreshold = 30, opaqueThreshold = 127, edgeSamplingStep = 5 }) {
    // ponytail: model 参数仅为兼容旧调用方保留（编排模式按阈值抠图，无模型选择）。
    void model;
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/cutout/',
        scheduleId: CUTOUT_SCHEDULE_ID,
        stdExtInfo: JSON.stringify({
            CutoutConfig: {
                TransparencyThreshold: Number(transparencyThreshold) || 30,
                OpaqueThreshold: Number(opaqueThreshold) || 127,
                EdgeSamplingStep: Number(edgeSamplingStep) || 5,
            },
        }),
    });
}

export function createCutoutTask(options) {
    const payload = buildCutoutPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建智能抠图任务失败');
}

// ---- 背景融合（AI 换背景 · 商品图背景） ----
// 官方工作台 bgfusion：产品图（主输入）+ 背景图（可选，AddOnParameter.ImageSet 第 2 张）+ 背景描述。
// 官方 prompt 工程模板（dry_run 实测）：按是否上传背景图两套文案，硬性约束保护商品主体。
function bgfusionPrompt(userPrompt, hasBg) {
    const desc = String(userPrompt || '').trim();
    return [
        '将图1中的商品融入一个与其用途和风格调性相符的真实场景中,场景自然贴合商品的使用情境与气质。',
        '柔和自然的光线,干净协调的构图,背景简洁贴切、适度虚化以突出商品主体,商品作为画面主体占比突出,尺寸比例自然真实,画面氛围与商品调性统一。',
        '商品主体清晰,产品上的所有文字、标签和品牌标识完整清晰可辨,产品细节清晰,高级感,商业摄影质感。',
        '',
        desc ? `用户描述:${desc}` : '',
        '',
        hasBg
            ? '参考背景(图2)提供主要视觉基调、色调与光线方向,请将其场景元素自然融合到画面中,同时保持图1商品作为绝对主体。'
            : '无背景参考图,请依据用户描述与商品自身调性自由生成合适的真实场景背景。',
        '',
        '硬性约束:',
        '- 图1中的商品(位置、姿态、比例、颜色、文字、标签、品牌标识)必须完整保持,不得改动或遮挡',
        '- 输出图像不添加任何额外文字、水印、logo、UI 元素',
        '- 若参考背景与商品调性冲突,以商品调性为准',
    ].filter((line) => line !== '').join('\n');
}

export function buildBgfusionPayload({ input, extraImages = [], prompt = '', model = 'WAND-create-1.0-flash', resolution = '2K', aspectRatio = '1:1', outputBucket, outputRegion }) {
    const hasBg = extraImages.length > 0;
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/bgfusion/',
        imageTask: {
            CreateImageConfig: {
                Model: model,
                Prompt: bgfusionPrompt(prompt, hasBg),
                Resolution: resolution,
                AspectRatio: aspectRatio,
            },
        },
        addOnParameter: {
            // 官方顺序：图1 商品（主输入）+ 图2 参考背景（可选）。
            ...(hasBg ? { ImageSet: [
                { Image: { Type: 'COS', CosInputInfo: { Bucket: input.bucket, Region: input.region, Object: input.object } } },
                ...extraImages.map((image) => ({ Image: { Type: 'COS', CosInputInfo: { Bucket: image.bucket, Region: image.region, Object: image.object } } })),
            ] } : {}),
        },
    });
}

export function createBgfusionTask(options) {
    const payload = buildBgfusionPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建背景融合任务失败');
}

// 换模特编排 ID（MPS ProcessImage ScheduleId，来自控制台 Dry Run）。
export const CHANGE_MODEL_SCHEDULE_ID = 30110;

// 换模特体型枚举（沙漏型为默认）。API 取值为小写（Dry Run 实测默认值为 "hourglass"）。
export const CHANGE_MODEL_BODY_TYPES = [
    { value: 'hourglass', label: '沙漏型', default: true },
    { value: 'rectangle', label: 'H 型' },
    { value: 'plus-size', label: '大码型' },
    { value: 'apple-shape', label: '苹果型' },
    { value: 'pear-shape', label: '梨型' },
];

// 换模特：保留服装，将参考模特替换为目标体型的虚拟模特。
// 结构与控制台 Dry Run 完全一致：ScheduleId 编排 + StdExtInfo(JSON 字符串) 内的
// ChangeGarmentModelConfig；模特图为 InputInfo(COS)，服装图经 AddOnParameter.ImageSet(COS)。
export function buildChangeModelPayload({ modelInput, garmentInput, bodyShape, precisionScale, outputBucket, outputRegion }) {
    return {
        InputInfo: {
            Type: 'COS',
            CosInputInfo: { Bucket: modelInput.bucket, Region: modelInput.region, Object: modelInput.object },
        },
        OutputStorage: {
            Type: 'COS',
            CosOutputStorage: { Bucket: outputBucket, Region: outputRegion },
        },
        OutputDir: '/mps-saas/output/changemodel/',
        ScheduleId: CHANGE_MODEL_SCHEDULE_ID,
        StdExtInfo: JSON.stringify({
            ChangeGarmentModelConfig: { BodyShape: bodyShape, PrecisionScale: precisionScale },
        }),
        AddOnParameter: {
            ImageSet: [
                {
                    Type: 'garment',
                    Image: {
                        Type: 'COS',
                        CosInputInfo: { Bucket: garmentInput.bucket, Region: garmentInput.region, Object: garmentInput.object },
                    },
                },
            ],
        },
    };
}

export function createChangeModelTask(options) {
    const payload = buildChangeModelPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建换模特任务失败');
}

// ============================================================================
// 画质提升 + 版权保护：真实 MPS ProcessImage 算子
// 配置 schema 参考 tencentcloud-sdk-nodejs-mps 的 ImageTaskInput 及其子配置
// ============================================================================

// 盲水印 EmbedText：URL 安全的 Base64，解码后 ≤12 字节（不足填充 0x00，超出截断）。
export function urlSafeBase64(text) {
    const bytes = unescape(encodeURIComponent(String(text || '')));
    const fixed = (bytes + '\x00'.repeat(12)).slice(0, 12);
    return btoa(fixed).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---- 超分辨率（官方 AdvancedSuperResolutionConfig：ultra/fidelity 双模型，按倍数或指定边长） ----
// sizeMode='percent' 时用 scale（1.0~4.0 倍）；sizeMode='aspect' 时用 edgeType(long/short)+edgeValue(px，≤8192)。
export function buildSuperResolutionPayload({ input, outputBucket, outputRegion, advSrType = 'ultra', sizeMode = 'percent', scale = 2, edgeType = 'long', edgeValue = 2048 }) {
    const config = { Switch: 'ON', Type: advSrType === 'fidelity' ? 'fidelity' : 'ultra' };
    if (sizeMode === 'aspect') {
        config.Mode = 'aspect';
        if (edgeType === 'short') config.ShortSide = Math.max(1, Math.floor(Number(edgeValue) || 2048));
        else config.LongSide = Math.max(1, Math.floor(Number(edgeValue) || 2048));
    } else {
        config.Mode = 'percent';
        config.Percent = Math.min(4, Math.max(1, Number(scale) || 2));
    }
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/super-resolution/',
        imageTask: { EnhanceConfig: { AdvancedSuperResolutionConfig: config } },
    });
}

export function createSuperResolutionTask(options) {
    const payload = buildSuperResolutionPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建超分辨率任务失败');
}

// ---- 综合增强（官方 EnhanceConfig 参数化） ----
// effects 形如 [{type:'quality_enhance',value:'strong'}, {type:'sharp_enhance',value:0.8}, {type:'lowlight_enhance',value:true}]：
// quality_enhance/denoise/color_enhance 取 strong|normal|weak；sharp_enhance/face_enhance 取 0~1；
// lowlight_enhance 为布尔开关。
export const ENHANCE_LEVELS = ['strong', 'normal', 'weak'];

export function buildEnhancePayload({ input, outputBucket, outputRegion, effects = [] }) {
    const items = Array.isArray(effects) ? effects : [];
    const config = {};
    for (const item of items) {
        const type = String(item?.type || '').trim();
        if (!type) continue;
        const value = item.value;
        if (type === 'sharp_enhance' || type === 'face_enhance') {
            const key = type === 'sharp_enhance' ? 'SharpEnhance' : 'FaceEnhance';
            config[key] = { Switch: 'ON', Intensity: Math.min(1, Math.max(0, Number(value) || 0)) };
        } else if (type === 'lowlight_enhance') {
            config.LowLightEnhance = { Switch: 'ON', Type: 'normal' };
        } else {
            const keyMap = { quality_enhance: 'ImageQualityEnhance', denoise: 'Denoise', color_enhance: 'ColorEnhance' };
            const key = keyMap[type];
            if (key) config[key] = { Switch: 'ON', Type: ENHANCE_LEVELS.includes(value) ? value : 'normal' };
        }
    }
    if (!Object.keys(config).length) {
        // ponytail: 全空时兜底综合增强 normal，避免 INVALID_PARAMS。
        config.ImageQualityEnhance = { Switch: 'ON', Type: 'normal' };
    }
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/enhance/',
        imageTask: { EnhanceConfig: config },
    });
}

export function createEnhanceTask(options) {
    const payload = buildEnhancePayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建综合增强任务失败');
}

// ---- 美颜美化（官方 BeautyConfig：19 美颜项 + 3 滤镜） ----
// beautyEffects: [{type:'Smooth',value:60}]；filterEffects: [{type:'Dongjing',value:40}]。
export const BEAUTY_EFFECT_TYPES = ['Whiten', 'BlackAlpha1', 'BlackAlpha2', 'FoundationAlpha2', 'Clear', 'Sharpen', 'Smooth', 'BeautyThinFace', 'NatureFace', 'VFace', 'EnlargeEye', 'EyeLighten', 'RemoveEyeBags', 'ThinNose', 'RemoveLawLine', 'CheekboneThin', 'ToothWhiten', 'FaceFeatureSoftlight', 'Makeup'];
export const BEAUTY_FILTER_TYPES = ['Dongjing', 'Qingjiaopian', 'Meiwei'];

export function buildBeautyPayload({ input, outputBucket, outputRegion, effects = [] }) {
    const toItems = (list) => (Array.isArray(list) ? list : [])
        .map((item) => ({ Type: String(item?.type || '').trim(), Switch: 'ON', Value: Math.min(100, Math.max(0, Math.round(Number(item?.value) || 0))) }))
        .filter((item) => item.Type);
    const beautyEffectItems = toItems(effects.filter((item) => BEAUTY_EFFECT_TYPES.includes(item?.type)));
    const beautyFilterItems = toItems(effects.filter((item) => BEAUTY_FILTER_TYPES.includes(item?.type)));
    if (!beautyEffectItems.length && !beautyFilterItems.length) {
        // ponytail: 全空兜底官方默认（磨皮 60），避免 INVALID_PARAMS。
        beautyEffectItems.push({ Type: 'Smooth', Switch: 'ON', Value: 60 });
    }
    const beautyConfig = {};
    if (beautyEffectItems.length) beautyConfig.BeautyEffectItems = beautyEffectItems;
    if (beautyFilterItems.length) beautyConfig.BeautyFilterItems = beautyFilterItems;
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/beauty/',
        imageTask: { BeautyConfig: beautyConfig },
    });
}

export function createBeautyTask(options) {
    const payload = buildBeautyPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建美颜美化任务失败');
}

// ---- 图片压缩 ----
export function buildCompressPayload({ input, outputBucket, outputRegion }) {
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/compress/',
        imageTask: { EncodeConfig: { Quality: 70 } },
    });
}

export function createCompressTask(options) {
    const payload = buildCompressPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建图片压缩任务失败');
}

// ---- 添加盲水印 ----
export function buildAddBlindWatermarkPayload({ input, outputBucket, outputRegion, watermarkText }) {
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/blind-watermark/',
        imageTask: {
            BlindWatermarkConfig: {
                AddBlindWatermark: {
                    Switch: 'ON',
                    EmbedInfo: { EmbedText: urlSafeBase64(watermarkText) },
                },
            },
        },
    });
}

export function createAddBlindWatermarkTask(options) {
    const payload = buildAddBlindWatermarkPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '添加盲水印失败');
}

// ---- 提取盲水印 ----
export function buildExtractBlindWatermarkPayload({ input, outputBucket, outputRegion }) {
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/blind-watermark-extract/',
        imageTask: { BlindWatermarkConfig: { ExtractBlindWatermark: { Switch: 'ON' } } },
    });
}

export function createExtractBlindWatermarkTask(options) {
    const payload = buildExtractBlindWatermarkPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '提取盲水印失败');
}

// 提取盲水印轮询：提取结果是 COS 上的 .txt 文件（实测
// Output.Path = xxx.png.txt，内容为水印文本的 Base64/原文）。
// 轮询到 FINISH 后读取该文本文件内容返回。
export async function pollBlindWatermarkExtractTask(taskId, region = '', options = {}) {
    const { urls, detail } = await pollImageTask(taskId, region, options);
    // .txt 输出会出现在 urls 里（mpsOutputURL 代理）；逐个 fetch 读内容。
    let text = '';
    for (const url of urls) {
        const isTxt = /\.txt($|\?)/i.test(url);
        if (!isTxt) continue;
        try {
            const response = await fetch(url);
            if (response.ok) {
                text = await response.text();
                break;
            }
        } catch { /* 忽略单个文件读取失败，继续兜底 */ }
    }
    if (!text) {
        // 兜底：从详情里的 Result / 文本节点提取。
        text = detail?.ExtractBlindWatermarkTask?.Result
            || detail?.ImageProcessTaskResultSet?.[0]?.Result
            || '';
    }
    // 结果文本若为 Base64（如 dGVzdA==）则解码为可读原文。
    if (text && /^[A-Za-z0-9+/=]+$/.test(text.trim())) {
        try {
            const decoded = decodeURIComponent(escape(atob(text.trim())));
            if (decoded) text = decoded;
        } catch { /* 非 Base64 则原样返回 */ }
    }
    return { urls: [], detail, text };
}

// ---- 套图生成（AI 电商套图，对齐官方 /workflow?solution=poster-suite） ----
// AiPosterSuiteConfig：平台视觉模板 Definition（50 淘宝/天猫 · 51 亚马逊 · 52 京东 ·
// 53 拼多多 · 54 Temu · 55 TikTok），Recipe 主题 hero/selling/detail/scene/atmosphere/angles
// （单主题 1-4 张，总数 4-12）。
// auto 模式（首跑）：文案变量经 CustomVariables({Type: Role, Description: Prompt}) 传入；
// modify 模式（审核重生成）：文案变量经 AddOnParameter.ExtPrompt({Role, Prompt}) 传入，
// 且禁止 CustomVariables（SDK 约束）。
export function buildImageSuitePayload({
    input, extraImages = [],
    definition = 50, recipe = [{ Theme: 'hero', Num: 1 }, { Theme: 'selling', Num: 1 }, { Theme: 'detail', Num: 1 }, { Theme: 'scene', Num: 1 }, { Theme: 'atmosphere', Num: 1 }, { Theme: 'angles', Num: 1 }],
    mode = 'auto', language = 'zh-CN', panelRatio = '1:1', panelResolution = '2K', model = 'flash',
    extPrompts = [], outputDir = '/mps-saas/output/poster_suite/v1/',
    outputBucket, outputRegion,
}) {
    const prompts = (extPrompts || [])
        .map((item) => ({ Role: item.Role, Prompt: String(item.Prompt || '').trim() }))
        .filter((item) => item.Role && item.Prompt);
    const modelName = model === 'lite' ? 'WAND-suite-1.0-lite' : 'WAND-suite-1.0-flash';
    const templateId = Math.max(1, Math.floor(Number(definition) || 50));
    const config = {
        Definition: templateId,
        Recipe: recipe,
        Mode: mode,
        Language: language,
        PanelRatio: panelRatio,
        PanelResolution: panelResolution,
        Model: modelName,
    };
    if (mode !== 'modify') {
        // auto 模式：文案变量作为自定义变量。
        if (prompts.length) {
            config.CustomVariables = prompts.map((item) => ({ Type: item.Role, Description: item.Prompt }));
        }
    }
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir,
        imageTask: { AiPosterSuiteConfig: config },
        addOnParameter: {
            ...(extraImages.length ? { ImageSet: extraImages.map((image) => ({ Image: { Type: 'COS', CosInputInfo: { Bucket: image.bucket, Region: image.region, Object: image.object } } })) } : {}),
            ...(mode === 'modify' && prompts.length ? { ExtPrompt: prompts } : {}),
        },
    });
}

export function createImageSuiteTask(options) {
    const payload = buildImageSuitePayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建套图生成任务失败');
}

// ---- 商品多视角生成（视觉模板 Definition=20194） ----
// AiPosterSuiteConfig modify 模式：Recipe 固定 [{Theme:"multiview", Num:4}]，
// 每个视角的补充描述经 AddOnParameter.ExtPrompt(Role=ViewAngle0-3) 传入，
// 附加参考图经 AddOnParameter.ImageSet(COS) 传入。
export function buildMultiviewSuitePayload({ input, extraImages = [], viewPrompts = [], definition = 20194, panelRatio = '1:1', panelResolution = '1K', model = 'flash', outputBucket, outputRegion }) {
    const extPrompts = (viewPrompts || [])
        .map((prompt, index) => ({ Role: `ViewAngle${index}`, Prompt: String(prompt || '').trim() }))
        .filter((item) => item.Prompt);
    const modelName = model === 'lite' ? 'WAND-suite-1.0-lite' : 'WAND-suite-1.0-flash';
    const templateId = Math.max(1, Math.floor(Number(definition) || 20194));
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/multiview-suite/',
        imageTask: {
            AiPosterSuiteConfig: {
                Definition: templateId,
                Recipe: [{ Theme: 'multiview', Num: 4 }],
                Mode: 'modify',
                Model: modelName,
                PanelRatio: panelRatio,
                PanelResolution: panelResolution,
            },
        },
        addOnParameter: {
            ...(extraImages.length ? { ImageSet: extraImages.map((image) => ({ Image: { Type: 'COS', CosInputInfo: { Bucket: image.bucket, Region: image.region, Object: image.object } } })) } : {}),
            ...(extPrompts.length ? { ExtPrompt: extPrompts } : {}),
        },
    });
}

export function createMultiviewSuiteTask(options) {
    const payload = buildMultiviewSuitePayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建多视角生成任务失败');
}

// ---- 场景图生成（视觉模板 Definition=20195，对齐官方 /workflow?solution=scene-image） ----
// AiPosterSuiteConfig modify 模式：Recipe 固定 [{Theme:"scene", Num:4}]，
// 生成 棚拍台面/生活使用场景/环境叙事/细节特写 四类场景图；
// 自定义场景描述经 AddOnParameter.ExtPrompt(Role=ScenePrompt) 传入。
export function buildSceneImagePayload({ input, extraImages = [], scenePrompt = '', definition = 20195, panelRatio = '1:1', panelResolution = '1K', model = 'flash', outputBucket, outputRegion }) {
    const prompt = String(scenePrompt || '').trim();
    const modelName = model === 'lite' ? 'WAND-suite-1.0-lite' : 'WAND-suite-1.0-flash';
    const templateId = Math.max(1, Math.floor(Number(definition) || 20195));
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/scene-image/',
        imageTask: {
            AiPosterSuiteConfig: {
                Definition: templateId,
                Recipe: [{ Theme: 'scene', Num: 4 }],
                Mode: 'modify',
                Model: modelName,
                PanelRatio: panelRatio,
                PanelResolution: panelResolution,
            },
        },
        addOnParameter: {
            ...(extraImages.length ? { ImageSet: extraImages.map((image) => ({ Image: { Type: 'COS', CosInputInfo: { Bucket: image.bucket, Region: image.region, Object: image.object } } })) } : {}),
            ...(prompt ? { ExtPrompt: [{ Role: 'ScenePrompt', Prompt: prompt }] } : {}),
        },
    });
}

export function createSceneImageTask(options) {
    const payload = buildSceneImagePayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建场景图生成任务失败');
}


// ---- 目标检测（官方 dry_run 实测：ProcessImage 算子 StdExtInfo.ObjectDetectDescribeConfig） ----
// Prompts 为检测目标描述数组；返回 PNG 画框图。Points（归一化坐标 [[x,y]]）可选。
export function buildObjectDetectPayload({ input, outputBucket, outputRegion, prompts = [], points = [], topK = 1, skipDescribe = false, returnCutout = false }) {
    const detectConfig = {
        Prompts: prompts.map((p) => String(p || '').trim()).filter(Boolean),
        TopK: Math.max(1, Math.floor(Number(topK) || 1)),
    };
    if (points?.length) detectConfig.Points = points;
    if (skipDescribe) detectConfig.SkipDescribe = true;
    if (returnCutout) detectConfig.ReturnCutout = true;
    return {
        InputInfo: {
            Type: 'COS',
            CosInputInfo: { Bucket: input.bucket, Region: input.region, Object: input.object },
        },
        ImageTask: {
            // 检测结果画框输出为 PNG（官方 dry_run 同构）。
            EncodeConfig: { Format: 'PNG' },
        },
        StdExtInfo: JSON.stringify({ ObjectDetectDescribeConfig: detectConfig }),
    };
}

export function createObjectDetectTask(options) {
    const payload = buildObjectDetectPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建目标检测任务失败');
}

// ---- 局部重绘（官方 dry_run 实测：CreateImageConfig 图生图，参考图走 AddOnParameter.ImageSet） ----
// 官方同样不传 mask 图：涂抹区域在前端转成区域文字（left-center 等）拼进 prompt。
export function buildRepaintPayload({ input, outputBucket, outputRegion, prompt = '', model = 'WAND-create-1.0-flash', resolution = '2K', aspectRatio = '1:1' }) {
    return {
        OutputStorage: {
            Type: 'COS',
            CosOutputStorage: { Bucket: outputBucket, Region: outputRegion },
        },
        OutputDir: '/mps-saas/output/repaint/',
        ImageTask: {
            CreateImageConfig: {
                Model: model,
                Prompt: String(prompt || '').trim(),
                Resolution: resolution,
                AspectRatio: aspectRatio,
            },
        },
        AddOnParameter: {
            ImageSet: [
                {
                    Image: {
                        Type: 'COS',
                        CosInputInfo: { Bucket: input.bucket, Region: input.region, Object: input.object },
                    },
                },
            ],
        },
    };
}

export function createRepaintTask(options) {
    const payload = buildRepaintPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建局部重绘任务失败');
}

export async function createAiTryOnTask({
    modelImageUrl,
    garmentImageUrls,
    model,
    prompt,
    resolution,
    outputBucket,
    outputRegion,
}) {
    const payload = {
        InputInfo: {
            Type: 'URL',
            UrlInputInfo: { Url: modelImageUrl },
        },
        OutputStorage: {
            Type: 'COS',
            CosOutputStorage: { Bucket: outputBucket, Region: outputRegion },
        },
        ImageTask: {
            AiTryOnConfig: {
                Model: model,
                Resolution: resolution,
                ...(prompt?.trim() ? { Prompt: prompt.trim() } : {}),
            },
        },
        AddOnParameter: {
            ImageSet: garmentImageUrls.map((url) => ({
                Image: { Type: 'URL', UrlInputInfo: { Url: url } },
            })),
        },
    };
    const result = await invokeMps('ProcessImage', payload, outputRegion);
    const error = result?.Response?.Error;
    if (error) throw new Error(error.Message || error.Code || '创建换装任务失败');
    const taskId = result?.Response?.TaskId;
    if (!taskId) throw new Error('腾讯云 MPS 未返回 TaskId');
    return { taskId, payload, response: result };
}

export async function describeImageTask(taskId, region = '') {
    const result = await invokeMps('DescribeImageTaskDetail', { TaskId: taskId }, region);
    const error = result?.Response?.Error;
    if (error) throw new Error(error.Message || error.Code || '查询图片处理任务失败');
    return result?.Response || {};
}

function mpsOutputURL(path) {
    const value = String(path || '').trim();
    return value ? `/api/mps/assets/output?${new URLSearchParams({ path: value })}` : '';
}

// 递归扫描所有 Output 节点，提取可访问地址（SignedUrl/Url 或 COS Path），
// 兼容不同任务类型与返回层级；只读取 Output 节点，避免误取输入素材地址。
function collectFromOutputNodes(node, acc, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 10) return;
    if (Array.isArray(node)) { node.forEach((child) => collectFromOutputNodes(child, acc, depth + 1)); return; }
    for (const [key, value] of Object.entries(node)) {
        if (key === 'Output' && value && typeof value === 'object') {
            const signed = value.SignedUrl || value.Url || '';
            if (/^https?:\/\//i.test(signed) && !acc.urls.includes(signed)) acc.urls.push(signed);
            const proxy = mpsOutputURL(value.Path || value.FilePath || '');
            if (proxy && !acc.urls.includes(proxy)) acc.urls.push(proxy);
        } else if (typeof value === 'object') {
            collectFromOutputNodes(value, acc, depth + 1);
        }
    }
}

// 生成响应结构的紧凑摘要，便于在错误信息中定位真实字段。
function summarizeStructure(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 2) return '';
    if (Array.isArray(value)) {
        return `[${value.length}项${value[0] ? ':' + summarizeStructure(value[0], depth + 1) : ''}]`;
    }
    return Object.keys(value)
        .map((key) => {
            const child = value[key];
            if (child && typeof child === 'object') return `${key}${summarizeStructure(child, depth + 1)}`;
            return key;
        })
        .join(',');
}

export function extractImageTaskResults(detail) {
    return (detail?.ImageProcessTaskResultSet || [])
        .map((item) => {
            const path = item?.Output?.Path || '';
            return {
                status: String(item?.Status || '').toUpperCase(),
                // MPS 对私有 COS Bucket 常只返回 Output.Path；经本地服务代理读取，
                // 避免把临时签名 URL 保存进结果和生成历史。
                url: item?.Output?.SignedUrl || item?.Output?.Url || mpsOutputURL(path),
                path,
                error: item?.ErrMsg || item?.ErrorMessage || '',
            };
        })
        .filter((item) => item.url || item.path || item.error || item.status);
}

export async function pollImageTask(taskId, region = '', options = {}) {
    const intervalMs = options.intervalMs || 4000;
    const maxAttempts = options.maxAttempts || 300;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const detail = await describeImageTask(taskId, region);
        const status = String(detail.Status || '').toUpperCase();
        options.onPoll?.({ attempt, status, detail });
        if (status === 'FINISH') {
            const results = extractImageTaskResults(detail);
            const failed = results.find((item) => item.error || item.status === 'FAIL');
            if (failed) throw new Error(failed.error || '图片处理任务失败');
            let urls = results.map((item) => item.url).filter(Boolean);
            if (!urls.length) {
                // 兜底：递归扫描所有 Output 节点，兼容不同的返回层级。
                const acc = { urls: [] };
                collectFromOutputNodes(detail, acc);
                urls = acc.urls;
            }
            if (!urls.length) {
                throw new Error(`任务完成，但未返回可访问的结果 URL（结果结构: ${summarizeStructure(detail)}）`);
            }
            return { detail, urls };
        }
        if (['FAIL', 'FAILED', 'ABORTED'].includes(status)) {
            throw new Error(detail.ErrMsg || '图片处理任务失败');
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('图片处理任务查询超时');
}

export const extractTryOnResults = extractImageTaskResults;
export const pollAiTryOnTask = pollImageTask;
