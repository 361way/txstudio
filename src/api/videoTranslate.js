/**
 * 视频译制·全球投放 API 封装。
 * 对应后端 backend/internal/translate/ 的 /api/translate/* 路由。
 */

// 上传源视频到 COS,返回 { id, name, size, type:"video", url, key }
export function uploadTranslateFile(file, onProgress) {
    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('file', file);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/translate/upload');
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
async function pollTranslateTask(runId, signal, onLog) {
    const start = Date.now();
    const MAX = 30 * 60 * 1000; // 每种语言约 1-3 分钟,多语言放宽到 30 分钟
    let lastLogCount = 0;
    while (Date.now() - start < MAX) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        // 增量拉取任务日志
        if (onLog) {
            try {
                const logResp = await fetch(`/api/translate/tasks/${runId}/log`, { signal });
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
            const resp = await fetch(`/api/translate/tasks/${runId}/result`, { signal });
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
    throw new Error('任务超时(超过 30 分钟未完成)');
}

/** 启动异步译制任务并轮询结果;onLog 可选,用于增量接收任务日志。 */
async function startTranslateTask(body, signal, onLog) {
    const resp = await fetch('/api/translate/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.success === false) {
        throw new Error(json.error || `请求失败 (${resp.status})`);
    }
    if (json.data?.runId) return pollTranslateTask(json.data.runId, signal, onLog);
    return json.data;
}

/** 视频译制:返回 { results, sourceLang, targetLangs };onLog 可选,用于实时监测任务日志。 */
export const translateVideo = (payload, signal, onLog) =>
    startTranslateTask(payload, signal, onLog);
