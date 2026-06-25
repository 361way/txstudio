/**
 * 模板 API
 * 普通用户：列表 + 详情
 * 管理员：CRUD（走 /api/admin/templates）
 */
import { apiGet, apiPost, apiPut, apiDelete } from './client';

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

// ===== 管理员 CRUD =====
export const adminListTemplates = () => apiGet('/api/admin/templates');
export const createTemplate = (data) => apiPost('/api/admin/templates', data);
export const updateTemplate = (id, data) => apiPut(`/api/admin/templates/${id}`, data);
export const deleteTemplate = (id) => apiDelete(`/api/admin/templates/${id}`);
