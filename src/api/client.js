/**
 * 本地单用户 API 客户端。
 * 所有请求直接访问同源 Go 服务；开发环境由 Vite 代理到本地后端。
 */

const DEFAULT_BASE_URL = import.meta.env?.VITE_API_BASE_URL || '';

export async function apiRequest(path, options = {}, _skipAuth = false, rawResponse = false) {
    const url = path.startsWith('http') ? path : `${DEFAULT_BASE_URL}${path}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const resp = await fetch(url, { ...options, headers });
    const json = await resp.json().catch(() => ({}));

    if (!resp.ok || json.success === false) {
        throw {
            status: resp.status,
            message: json.error || json.message || `请求失败 (${resp.status})`,
            data: json.data,
        };
    }
    return rawResponse ? json : json.data;
}

export const apiGet = (path) => apiRequest(path, { method: 'GET' });
export const apiPost = (path, body) => apiRequest(path, { method: 'POST', body: JSON.stringify(body || {}) });
export const apiPut = (path, body) => apiRequest(path, { method: 'PUT', body: JSON.stringify(body || {}) });
export const apiDelete = (path, body) => apiRequest(path, {
    method: 'DELETE',
    ...(body ? { body: JSON.stringify(body) } : {}),
});

export const API_BASE_URL = DEFAULT_BASE_URL;
