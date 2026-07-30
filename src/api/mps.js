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

export function extractImageTaskResults(detail) {
    return (detail?.ImageProcessTaskResultSet || [])
        .map((item) => ({
            status: String(item?.Status || '').toUpperCase(),
            url: item?.Output?.SignedUrl || item?.Output?.Url || '',
            path: item?.Output?.Path || '',
            error: item?.ErrMsg || item?.ErrorMessage || '',
        }))
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
            const urls = results.map((item) => item.url).filter(Boolean);
            if (!urls.length) throw new Error('任务完成，但未返回可访问的结果 URL');
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
