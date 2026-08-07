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

function buildCosImageTaskPayload({ input, outputBucket, outputRegion, outputDir, imageTask, scheduleId }) {
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

export function buildOldPhotoRestorePayload({ input, outputBucket, outputRegion }) {
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/photo-restore/',
        imageTask: {
            EnhanceConfig: {
                SuperResolution: { Switch: 'ON' },
            },
        },
    });
}

export function createOldPhotoRestoreTask(options) {
    const payload = buildOldPhotoRestorePayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建老照片修复任务失败');
}

// 腾讯云 MPS AiCutoutConfig：foreground 为默认前景提取模式。
export function buildForegroundExtractionPayload({ input, outputBucket, outputRegion }) {
    return buildCosImageTaskPayload({
        input, outputBucket, outputRegion,
        outputDir: '/mps-saas/output/foreground/',
        imageTask: {
            AiCutoutConfig: {
                Switch: 'ON',
                Type: 'foreground',
            },
        },
    });
}

export function createForegroundExtractionTask(options) {
    const payload = buildForegroundExtractionPayload(options);
    return submitCosImageTask(payload, options.outputRegion, '创建前景提取任务失败');
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
