const AGENT_CHAT_ENDPOINT = '/api/agent/chat';

const readErrorMessage = (payload, fallback) => (
    payload?.error?.message
    || payload?.error
    || payload?.message
    || fallback
);

/**
 * 通过同源 Go 服务调用 TokenHub，避免浏览器直连产生 CORS/网络错误。
 * API Key 与 Base URL 均由后端从加密凭证中读取。
 */
export async function requestAgentChat({ model, messages, temperature, signal }) {
    const payload = { model, messages };
    if (Number.isFinite(temperature)) payload.temperature = temperature;

    let response;
    try {
        response = await fetch(AGENT_CHAT_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal,
        });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw new Error('无法连接本地 TxStudio 服务，请确认应用仍在运行后重试。');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 413) {
            throw new Error('媒体文件过大，建议缩短视频、降低分辨率，或改用“手动关键帧”模式后重试。');
        }
        if (response.status === 401 || response.status === 403) {
            throw new Error('TokenHub API Key 无效或当前模型未开通，请在“全局 API 设置”中检查。');
        }
        if (response.status === 502 || response.status === 504) {
            throw new Error(readErrorMessage(data, 'TokenHub 服务暂时不可用，请稍后重试。'));
        }
        throw new Error(readErrorMessage(data, `TokenHub 请求失败（HTTP ${response.status}）`));
    }
    return data;
}
