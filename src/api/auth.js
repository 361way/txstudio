/**
 * 认证 API
 */
import { apiPost, apiGet, setTokens, getTokens, clearTokens } from './client';

/** 注册 */
export async function register({ email, password, displayName, tenantName }) {
    const data = await apiPost('/api/auth/register', {
        email, password, display_name: displayName, tenant_name: tenantName,
    }, true);
    setTokens({ access_token: data.access_token, refresh_token: data.refresh_token });
    return data.user;
}

/** 登录 */
export async function login(email, password) {
    const data = await apiPost('/api/auth/login', { email, password }, true);
    setTokens({ access_token: data.access_token, refresh_token: data.refresh_token });
    return data.user;
}

/** 退出登录 */
export function logout() {
    clearTokens();
}

/** 当前用户信息 */
export async function me() {
    return apiGet('/api/auth/me');
}

/** 是否已登录 */
export function isLoggedIn() {
    const tokens = getTokens();
    return !!(tokens && tokens.access_token);
}
