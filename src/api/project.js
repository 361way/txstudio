/**
 * 本地 SQLite 项目 / 画布 / 历史 API。
 */
import { apiGet, apiPost, apiPut, apiDelete } from './client';

export const listProjects = () => apiGet('/api/projects');
export const createProject = (name) => apiPost('/api/projects', { name });
export const getProject = (id) => apiGet(`/api/projects/${id}`);
export const updateProject = (id, updates) => apiPut(`/api/projects/${id}`, updates);
export const deleteProject = (id) => apiDelete(`/api/projects/${id}`);

export const saveCanvas = (projectId, canvasData) =>
    apiPut(`/api/projects/${projectId}/canvas`, {
        data: typeof canvasData === 'string' ? canvasData : JSON.stringify(canvasData),
    });

export async function getCanvas(projectId) {
    const data = await apiGet(`/api/projects/${projectId}/canvas`);
    if (data?.data) {
        try { return JSON.parse(data.data); } catch { return data.data; }
    }
    return null;
}

export const listHistory = (projectId) => apiGet(`/api/projects/${projectId}/history`);
export const addHistory = (projectId, record) => apiPost(`/api/projects/${projectId}/history`, record);

/** 用当前历史快照原子替换 SQLite 中的项目历史。 */
export const replaceHistory = (projectId, items) =>
    apiPut(`/api/projects/${projectId}/history`, { items });

/** 按稳定的前端记录 ID 从 SQLite 硬删除历史。 */
export const deleteHistory = (projectId, clientIds) =>
    apiDelete(`/api/projects/${projectId}/history`, {
        client_ids: clientIds.map((id) => String(id)),
    });
