import { apiGet, apiPost, apiDelete } from './client';

export const listCredentials = () => apiGet('/api/credentials');

export const saveCredential = (provider, data) =>
    apiPost('/api/credentials', { provider, data });

export const deleteCredential = (id) => apiDelete(`/api/credentials/${id}`);

/** 从 SQLite 凭证状态初始化浏览器运行时配置；不读取任何 Secret 明文。 */
export async function bootstrapRuntimeCredentials() {
    const credentials = await listCredentials();
    const providers = {};

    const tokenhub = credentials.find((item) => item.provider === 'tokenhub' && item.has_data);
    if (tokenhub) {
        providers.openai = {
            key: '__server__',
            url: tokenhub.config?.base_url || 'https://tokenhub.tencentmaas.com',
            apiType: 'openai',
            useProxy: true,
            forceAsync: false,
            enabled: true,
        };
    }

    const vod = credentials.find((item) => item.provider === 'tencent-cloud' && item.has_data);
    if (vod) {
        providers['tencent-vod'] = {
            key: ['__server__', '__server__', vod.config?.sub_app_id || '', vod.config?.region || 'ap-guangzhou'].join('|'),
            url: 'https://vod.tencentcloudapi.com',
            apiType: 'tencent-vod',
            useProxy: true,
            forceAsync: true,
            enabled: true,
        };
    }

    localStorage.setItem('vodstudio_providers', JSON.stringify(providers));
    localStorage.setItem('vodstudio_global_key', tokenhub ? '__server__' : '');
    window.dispatchEvent(new CustomEvent('vodstudio:api-settings-updated'));
    return providers;
}
