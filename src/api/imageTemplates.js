import { apiDelete, apiGet, apiPost, apiPut } from './client';

export const listImageTemplates = () => apiGet('/api/image-templates');
export const createImageTemplate = (template) => apiPost('/api/image-templates', template);
export const updateImageTemplate = (id, template) => apiPut(`/api/image-templates/${id}`, template);
export const deleteImageTemplate = (id) => apiDelete(`/api/image-templates/${id}`);
