/**
 * API 客户端封装层
 * - 统一注入 Bearer token
 * - 401 自动刷新 access token
 * - 请求失败时返回标准错误对象
 * - 渐进式降级：API 不可用时由调用方决定是否降级到 localStorage
 */

const DEFAULT_BASE_URL = (import.meta.env?.VITE_API_BASE_URL) || 'http://localhost:8080';
const TOKEN_STORAGE_KEY = 'vodstudio_saas_tokens';

/** 读取本地存储的 token */
export function getTokens() {
    try {
        const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/** 保存 token */
export function setTokens(tokens) {
    if (tokens) {
        localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
    } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
}

/** 获取当前 access token */
export function getAccessToken() {
    const t = getTokens();
    return t?.access_token || '';
}

/** 清除登录状态 */
export function clearTokens() {
    setTokens(null);
}

let refreshing = null; // 防止并发刷新

/** 刷新 access token */
async function refreshAccessToken() {
    if (refreshing) return refreshing;
    const tokens = getTokens();
    if (!tokens?.refresh_token) throw new Error('no refresh token');

    refreshing = (async () => {
        try {
            const resp = await fetch(`${DEFAULT_BASE_URL}/api/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: tokens.refresh_token }),
            });
            if (!resp.ok) throw new Error('refresh failed');
            const json = await resp.json();
            const newTokens = { ...tokens, access_token: json.data.access_token };
            setTokens(newTokens);
            return newTokens.access_token;
        } catch (err) {
            clearTokens();
            throw err;
        } finally {
            refreshing = null;
        }
    })();
    return refreshing;
}

/**
 * 统一请求函数
 * @param {string} path - API 路径，如 /api/auth/login
 * @param {object} options - fetch options
 * @param {boolean} skipAuth - 跳过鉴权（登录/注册用）
 */
export async function apiRequest(path, options = {}, skipAuth = false) {
    const url = path.startsWith('http') ? path : `${DEFAULT_BASE_URL}${path}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

    if (!skipAuth) {
        const token = getAccessToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    let resp = await fetch(url, { ...options, headers });

    // 401 → 尝试刷新后重试一次
    if (resp.status === 401 && !skipAuth) {
        try {
            await refreshAccessToken();
            headers['Authorization'] = `Bearer ${getAccessToken()}`;
            resp = await fetch(url, { ...options, headers });
        } catch {
            clearTokens();
            // 抛出让上层处理跳转登录
            throw { status: 401, message: '登录已过期，请重新登录', needLogin: true };
        }
    }

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.success === false) {
        throw {
            status: resp.status,
            message: json.error || json.message || `请求失败 (${resp.status})`,
            data: json.data,
        };
    }
    return json.data;
}

/** GET */
export const apiGet = (path, skipAuth) => apiRequest(path, { method: 'GET' }, skipAuth);

/** POST */
export const apiPost = (path, body, skipAuth) =>
    apiRequest(path, { method: 'POST', body: JSON.stringify(body || {}) }, skipAuth);

/** PUT */
export const apiPut = (path, body) =>
    apiRequest(path, { method: 'PUT', body: JSON.stringify(body || {}) });

/** DELETE */
export const apiDelete = (path) => apiRequest(path, { method: 'DELETE' });

export const API_BASE_URL = DEFAULT_BASE_URL;
