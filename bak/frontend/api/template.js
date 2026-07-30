/**
 * 模板 API
 * 本地模板列表与详情。
 */
import { apiGet } from './client';

/** 模板列表（active，可选按 category/type 过滤） */
export const listTemplates = (params = {}) => {
    const qs = new URLSearchParams();
    if (params.category) qs.set('category', params.category);
    if (params.type) qs.set('type', params.type);
    const s = qs.toString();
    return apiGet(`/api/templates${s ? '?' + s : ''}`);
};

/** 模板详情 */
export const getTemplate = (id) => apiGet(`/api/templates/${id}`);
