/**
 * 爆款复刻 API 封装。
 * 对应后端 backend/internal/viral/ 的 /api/viral/* 路由。
 */

// 上传素材到 COS(视频/图片),返回 { id, name, size, type, url, key }
export function uploadViralFile(file, onProgress) {
    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('file', file);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/viral/upload');
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const json = JSON.parse(xhr.responseText);
                    if (json.success === false) reject(new Error(json.error || '上传失败'));
                    else resolve(json.data);
                } catch { reject(new Error('上传响应解析失败')); }
            } else {
                let msg = `上传失败 (${xhr.status})`;
                try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
                reject(new Error(msg));
            }
        });
        xhr.addEventListener('error', () => reject(new Error('网络错误')));
        xhr.send(form);
    });
}

/** 轮询异步任务结果;onLog 回调会增量收到任务日志行(用于实时监测)。 */
async function pollViralTask(runId, signal, onLog) {
    const start = Date.now();
    const MAX = 20 * 60 * 1000;
    let lastLogCount = 0;
    while (Date.now() - start < MAX) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        // 增量拉取任务日志
        if (onLog) {
            try {
                const logResp = await fetch(`/api/viral/tasks/${runId}/log`, { signal });
                const logJson = await logResp.json().catch(() => ({}));
                const logs = logJson?.data?.logs || [];
                if (logs.length > lastLogCount) {
                    onLog(logs.slice(lastLogCount));
                    lastLogCount = logs.length;
                }
            } catch (e) {
                if (e.name === 'AbortError') throw e;
            }
        }
        try {
            const resp = await fetch(`/api/viral/tasks/${runId}/result`, { signal });
            const json = await resp.json().catch(() => ({}));
            if (json.ready) {
                if (json.status === 'error') throw new Error(json.error || '任务执行失败');
                return json.result;
            }
        } catch (e) {
            if (e.name === 'AbortError') throw e;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error('任务超时(超过 20 分钟未完成)');
}

/** 启动异步任务并轮询结果;onLog 可选,用于增量接收任务日志。 */
async function startViralTask(endpoint, body, signal, onLog) {
    const resp = await fetch(`/api/viral/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.success === false) {
        throw new Error(json.error || `请求失败 (${resp.status})`);
    }
    if (json.data?.runId) return pollViralTask(json.data.runId, signal, onLog);
    return json.data;
}

/** 腾讯云 MPS 爆款复刻:返回 { videoUrls };onLog 可选,用于实时监测任务日志。 */
export const cloneViralVideo = (payload, signal, onLog) =>
    startViralTask('clone', payload, signal, onLog);
