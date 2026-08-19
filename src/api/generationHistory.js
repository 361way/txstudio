import { apiDelete, apiGet, apiPost, apiPut } from './client';

const TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled']);
const SENSITIVE_KEY = /(secret|token|authorization|credential|password|signature|tempkey|sessiontoken)/i;

const compact = (value) => {
    if (Array.isArray(value)) return value.slice(0, 50).map(compact);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .filter(([key]) => !SENSITIVE_KEY.test(key))
            .map(([key, item]) => [key, compact(item)]));
    }
    if (typeof value === 'string') return value.slice(0, 4000);
    return value;
};

export const listGenerationJobs = (filters = {}) => {
    const search = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    });
    return apiGet(`/api/generation-jobs${search.size ? `?${search}` : ''}`);
};

export const listGenerationImageAssets = (projectId, limit = 60) => {
    const search = new URLSearchParams({ project_id: String(projectId), limit: String(limit) });
    return apiGet(`/api/generation-jobs/assets?${search}`);
};

export const getGenerationJob = (id) => apiGet(`/api/generation-jobs/${id}`);
export const createGenerationJob = (job) => apiPost('/api/generation-jobs', compact(job));
export const updateGenerationJob = (id, updates) => apiPut(`/api/generation-jobs/${id}`, compact(updates));
export const deleteGenerationJob = (id) => apiDelete(`/api/generation-jobs/${id}`);

export const generationStageInfo = {
    upload_start: { progress: 8, message: '正在上传参考素材' },
    upload_done: { progress: 24, message: '参考素材上传完成' },
    create_task: { progress: 32, message: '正在创建云端任务' },
    task_created: { progress: 40, message: '云端任务已创建' },
    polling: { progress: 58, message: '云端任务处理中' },
    task_finish: { progress: 100, message: '生成任务完成' },
};

export async function createGenerationTracker(meta) {
    let job;
    try {
        job = await createGenerationJob({
            client_id: crypto.randomUUID?.() || `generation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            source: meta.source || 'pipeline',
            type: meta.type,
            provider: meta.provider || 'tencent-vod',
            status: 'running',
            prompt: meta.prompt || '',
            model_name: meta.modelName || '',
            model_version: meta.modelVersion || '',
            parameters: compact(meta.parameters || {}),
            storage_mode: meta.storageMode || 'Permanent',
            project_id: meta.projectId || undefined,
            parent_job_id: meta.parentJobId || undefined,
            assets: compact(meta.assets || []),
        });
    } catch (error) {
        console.warn('[TxStudio] 无法创建生成历史记录:', error?.message || error);
        return null;
    }

    let queue = Promise.resolve();
    let lastStage = '';
    let lastPollingStatus = '';
    let lastProgress = -1;
    const enqueue = (payload) => {
        queue = queue.then(() => updateGenerationJob(job.id, compact(payload)))
            .catch((error) => console.warn('[TxStudio] 无法更新生成历史:', error?.message || error));
        return queue;
    };

    return {
        id: job.id,
        async stage(stage, info = {}) {
            const definition = generationStageInfo[stage] || { progress: Number(info.progress) || 0, message: info.message || stage };
            const progress = Number.isFinite(Number(info.progress)) ? Number(info.progress) : definition.progress;
            const message = info.message || definition.message;
            const pollingStatus = stage === 'polling' ? String(info.status || '').toUpperCase() : '';
            if (stage === lastStage && progress === lastProgress && (!pollingStatus || pollingStatus === lastPollingStatus)) return;
            lastStage = stage;
            lastProgress = progress;
            lastPollingStatus = pollingStatus;
            const assets = stage === 'upload_done'
                ? [{
                    role: info.role || 'reference', ordinal: Number(info.index) || 0,
                    media_type: 'image', cloud_file_id: info.fileId || '', cloud_url: info.url || '',
                    storage_provider: 'tencent-vod', metadata: { direct_url: !!info.directUrl },
                }]
                : [];
            await enqueue({
                ...(info.taskId ? { cloud_task_id: info.taskId } : {}),
                progress,
                assets,
                event: {
                    stage,
                    level: 'info',
                    message: pollingStatus ? `${message}（${pollingStatus}）` : message,
                    metadata: compact({ status: pollingStatus, index: info.index, total: info.total }),
                },
            });
        },
        async complete({ urls = [], fileIds = [], assets = [], mediaType = meta.type, status = 'completed', parameters } = {}) {
            const outputAssets = urls.map((url, index) => ({
                role: 'output', ordinal: index, media_type: mediaType,
                cloud_file_id: fileIds[index] || '', cloud_url: url,
                storage_provider: 'tencent-vod', storage_mode: meta.storageMode || 'Permanent',
            }));
            await enqueue({
                status: TERMINAL_STATUSES.has(status) ? status : 'completed',
                progress: 100,
                ...(parameters ? { parameters: compact(parameters) } : {}),
                assets: [...outputAssets, ...compact(assets)],
                event: { stage: 'completed', level: 'info', message: '生成任务已完成' },
            });
        },
        async fail(error, status = 'failed') {
            const message = String(error?.message || error || '生成任务失败').slice(0, 4000);
            await enqueue({
                status: TERMINAL_STATUSES.has(status) ? status : 'failed',
                error_message: message,
                event: { stage: status, level: status === 'cancelled' ? 'warning' : 'error', message },
            });
        },
        flush: () => queue,
    };
}
