/**
 * 管理员 API（仅超级管理员可用）
 */
import { apiGet, apiPut } from './client';

/** 列出所有用户（跨租户） */
export const listUsers = () => apiGet('/api/admin/users');

/** 设置用户配额覆盖 */
export const setUserQuota = (userId, quotas) =>
    apiPut(`/api/admin/users/${userId}/quota`, { quotas });

/** 启用/禁用用户 */
export const setUserStatus = (userId, status) =>
    apiPut(`/api/admin/users/${userId}/status`, { status });
