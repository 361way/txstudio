/**
 * 项目 / 画布 / 历史 API
 */
import { apiGet, apiPost, apiPut, apiDelete } from './client';

/** 项目列表 */
export const listProjects = () => apiGet('/api/projects');

/** 创建项目 */
export const createProject = (name) => apiPost('/api/projects', { name });

/** 获取项目详情 */
export const getProject = (id) => apiGet(`/api/projects/${id}`);

/** 更新项目 */
export const updateProject = (id, updates) => apiPut(`/api/projects/${id}`, updates);

/** 删除项目 */
export const deleteProject = (id) => apiDelete(`/api/projects/${id}`);

/** 保存画布状态（nodes + connections 序列化为 JSON 字符串） */
export const saveCanvas = (projectId, canvasData) =>
    apiPut(`/api/projects/${projectId}/canvas`, {
        data: typeof canvasData === 'string' ? canvasData : JSON.stringify(canvasData),
    });

/** 读取画布状态 */
export async function getCanvas(projectId) {
    const data = await apiGet(`/api/projects/${projectId}/canvas`);
    if (data.data) {
        try { return JSON.parse(data.data); } catch { return data.data; }
    }
    return null;
}

/** 历史记录列表 */
export const listHistory = (projectId) => apiGet(`/api/projects/${projectId}/history`);

/** 新增历史记录 */
export const addHistory = (projectId, record) =>
    apiPost(`/api/projects/${projectId}/history`, record);
