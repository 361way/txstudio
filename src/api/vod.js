/**
 * VOD 调用 API — 走后端代签转发（不再浏览器签名）
 */
import { apiRequest } from './client';

/**
 * 调用腾讯云 VOD API（后端代签 TC3-HMAC + 配额强制）
 * 后端透传腾讯云原始响应 { Response: {...} }，需用 rawResponse=true 取完整体。
 * @param {Object} params
 * @param {string} params.action - VOD API action，如 CreateAigcImageTask
 * @param {string} [params.version] - API 版本，默认 2018-07-17
 * @param {string} [params.region] - 地域
 * @param {Object} params.payload - 请求体（JSON 对象）
 */
export function invokeVod({ action, version, region, payload }) {
    return apiRequest('/api/vod/invoke', {
        method: 'POST',
        body: JSON.stringify({
            action,
            version: version || '2018-07-17',
            region: region || '',
            payload: payload || {},
        }),
    }, false, true);
}
