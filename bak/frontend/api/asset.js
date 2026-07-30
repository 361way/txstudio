/**
 * 资产 / 凭证 / 计费 API
 */
import { apiGet, apiPost, apiDelete, API_BASE_URL } from './client';

// ---- 资产 ----

/** 获取 COS 临时上传 URL */
export const getUploadURL = (filename, contentType, projectId) =>
    apiPost('/api/assets/upload-url', { filename, content_type: contentType, project_id: projectId });

/** 登记资产元数据（上传完成后调用） */
export const registerAsset = (meta) => apiPost('/api/assets', meta);

/** 获取资产访问 URL */
export const getAsset = (id) => apiGet(`/api/assets/${id}`);

// ---- 凭证 ----

/** 凭证列表 */
export const listCredentials = () => apiGet('/api/credentials');

/** 保存凭证（VOD SecretId/Key/SubAppId 或 TokenHub key） */
export const saveCredential = (provider, data) =>
    apiPost('/api/credentials', { provider, data });

/** 删除凭证 */
export const deleteCredential = (id) => apiDelete(`/api/credentials/${id}`);

// ---- 计费 ----

/** 套餐列表 */
export const listPlans = () => apiGet('/api/billing/plans');

/** 当前订阅 */
export const getSubscription = () => apiGet('/api/billing/subscription');

/** 订阅/切换套餐 */
export const subscribe = (planCode) => apiPost('/api/billing/subscribe', { plan_code: planCode });

/** 用量统计 */
export const getUsage = () => apiGet('/api/billing/usage');

// ---- 代理（替代旧 /proxy 逻辑） ----

/**
 * 通过 SaaS 后端代理发送请求（替代旧版直连本地代理）
 * @param {string} targetUrl - 目标 URL
 * @param {object} opts - { method, headers, body }
 */
export const proxyRequest = (targetUrl, opts = {}) =>
    apiPost('/api/proxy', { url: targetUrl, ...opts });

/**
 * COS PUT 上传代理（走后端，加鉴权 + 配额）
 * @param {string} targetUrl - COS 上传地址
 * @param {Blob} blob - 文件内容
 * @param {object} headers - 额外 headers（如 Authorization）
 */
export async function cosPutProxy(targetUrl, blob, headers = {}) {
    const tokens = JSON.parse(localStorage.getItem('vodstudio_saas_tokens') || '{}');
    const resp = await fetch(`${API_BASE_URL}/api/cos-put?url=${encodeURIComponent(targetUrl)}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'X-Forward-Auth': JSON.stringify(headers),
        },
        body: blob,
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`COS 上传失败 (${resp.status}): ${text}`);
    }
    return resp;
}
