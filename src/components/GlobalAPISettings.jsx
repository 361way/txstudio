import React, { useEffect, useMemo, useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, LibraryBig, Loader2, Plus, Save, Settings, Trash2, X } from 'lucide-react';
import { listCredentials, saveCredential } from '../api/credential';

const PROVIDERS_KEY = 'vodstudio_providers';
const API_CONFIGS_KEY = 'vodstudio_api_configs';
const GLOBAL_KEY = 'vodstudio_global_key';
const DEFAULT_TOKENHUB_URL = 'https://tokenhub.tencentmaas.com';
const DEFAULT_VOD_URL = 'https://vod.tencentcloudapi.com';

const readJSON = (key, fallback) => {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
};

const defaultModels = () => [
    { id: 'hy3-preview', modelName: 'hy3-preview', displayName: 'hy3-preview', provider: 'openai', type: 'Chat', apiType: 'openai', _uid: crypto.randomUUID?.() || `model-${Date.now()}-1` },
    { id: 'vod-aigc-image', modelName: 'vod-aigc-image', displayName: 'vod-aigc-image', provider: 'tencent-vod', type: 'Image', apiType: 'tencent-vod', _uid: crypto.randomUUID?.() || `model-${Date.now()}-2` },
    { id: 'vod-aigc-video', modelName: 'vod-aigc-video', displayName: 'vod-aigc-video', provider: 'tencent-vod', type: 'Video', apiType: 'tencent-vod', _uid: crypto.randomUUID?.() || `model-${Date.now()}-3` },
];

const parseVodKey = (value = '') => {
    const [secretId = '', secretKey = '', subAppId = '', region = 'ap-guangzhou'] = String(value).split('|');
    return {
        secretId: secretId === '__server__' ? '' : secretId,
        secretKey: secretKey === '__server__' ? '' : secretKey,
        subAppId,
        region,
    };
};

export default function GlobalAPISettings({ open, onClose }) {
    const storedProviders = useMemo(() => readJSON(PROVIDERS_KEY, {}), [open]);
    const initialVod = parseVodKey(storedProviders?.['tencent-vod']?.key);
    const [tab, setTab] = useState('providers');
    const [showSecrets, setShowSecrets] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [configured, setConfigured] = useState({ tokenhub: false, vod: false });
    const storedTokenhubKey = storedProviders?.openai?.key || localStorage.getItem(GLOBAL_KEY) || '';
    const [tokenhub, setTokenhub] = useState({
        apiKey: storedTokenhubKey === '__server__' ? '' : storedTokenhubKey,
        baseUrl: storedProviders?.openai?.url || DEFAULT_TOKENHUB_URL,
    });
    const [vod, setVod] = useState({
        ...initialVod,
        mpsBucket: '',
        mpsRegion: initialVod.region || 'ap-guangzhou',
    });
    const [models, setModels] = useState(() => {
        const stored = readJSON(API_CONFIGS_KEY, null);
        return Array.isArray(stored) && stored.length ? stored : defaultModels();
    });

    useEffect(() => {
        if (!open) return;
        setMessage('');
        listCredentials()
            .then((items) => {
                const list = Array.isArray(items) ? items : [];
                const tokenhubCredential = list.find((item) => item.provider === 'tokenhub' && item.has_data);
                const vodCredential = list.find((item) => item.provider === 'tencent-cloud' && item.has_data);
                setConfigured({ tokenhub: Boolean(tokenhubCredential), vod: Boolean(vodCredential) });
                if (tokenhubCredential?.config?.base_url) {
                    setTokenhub((current) => ({ ...current, baseUrl: tokenhubCredential.config.base_url }));
                }
                if (vodCredential?.config) {
                    setVod((current) => ({
                        ...current,
                        subAppId: String(vodCredential.config.sub_app_id || current.subAppId || ''),
                        region: vodCredential.config.region || current.region || 'ap-guangzhou',
                        mpsBucket: vodCredential.config.mps_bucket || current.mpsBucket || '',
                        mpsRegion: vodCredential.config.mps_region || current.mpsRegion || 'ap-guangzhou',
                    }));
                }
            })
            .catch(() => setMessage('本地服务未启动，暂时无法读取 SQLite 配置'));
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    const saveProviders = async () => {
        setSaving(true);
        setMessage('');
        try {
            const tasks = [];
            if (tokenhub.apiKey.trim()) {
                tasks.push(saveCredential('tokenhub', {
                    api_key: tokenhub.apiKey.trim(),
                    base_url: tokenhub.baseUrl.trim() || DEFAULT_TOKENHUB_URL,
                }));
            }
            if (configured.vod || vod.secretId.trim() || vod.secretKey.trim()) {
                const isReplacingSecret = Boolean(vod.secretId.trim() || vod.secretKey.trim());
                if ((!configured.vod || isReplacingSecret) && (!vod.secretId.trim() || !vod.secretKey.trim() || !vod.subAppId.trim())) {
                    throw new Error('腾讯云媒体服务需要完整填写 SecretId、SecretKey 和 SubAppId');
                }
                tasks.push(saveCredential('tencent-cloud', {
                    secret_id: vod.secretId.trim(),
                    secret_key: vod.secretKey.trim(),
                    sub_app_id: vod.subAppId.trim(),
                    region: vod.region.trim() || 'ap-guangzhou',
                    mps_bucket: vod.mpsBucket.trim(),
                    mps_region: vod.mpsRegion.trim() || 'ap-guangzhou',
                }));
            }
            await Promise.all(tasks);

            const current = readJSON(PROVIDERS_KEY, {});
            const nextProviders = {
                ...current,
                openai: {
                    ...(current.openai || {}),
                    // 浏览器只保存占位符；真实 API Key 由本地后端从 SQLite 解密后注入代理请求。
                    key: '__server__',
                    url: tokenhub.baseUrl.trim() || DEFAULT_TOKENHUB_URL,
                    apiType: 'openai',
                    useProxy: true,
                    forceAsync: false,
                },
                'tencent-vod': {
                    ...(current['tencent-vod'] || {}),
                    // 浏览器只保存兼容旧画布校验所需的占位符与非敏感 SubAppId；真实 AK/SK 仅存在 SQLite 密文中。
                    key: ['__server__', '__server__', vod.subAppId, vod.region || 'ap-guangzhou'].map((part) => part.trim()).join('|'),
                    url: DEFAULT_VOD_URL,
                    apiType: 'tencent-vod',
                    useProxy: true,
                    forceAsync: true,
                },
            };
            localStorage.setItem(PROVIDERS_KEY, JSON.stringify(nextProviders));
            localStorage.setItem(GLOBAL_KEY, tokenhub.apiKey.trim() ? '__server__' : '');
            window.dispatchEvent(new CustomEvent('vodstudio:api-settings-updated'));
            setConfigured((prev) => ({
                tokenhub: prev.tokenhub || Boolean(tokenhub.apiKey.trim()),
                vod: prev.vod || Boolean(vod.secretId.trim() && vod.secretKey.trim()),
            }));
            setMessage('API 设置已保存到本地 SQLite');
        } catch (error) {
            setMessage(error?.message || '保存失败');
        } finally {
            setSaving(false);
        }
    };

    const saveModels = () => {
        const normalized = models
            .filter((item) => String(item.id || '').trim())
            .map((item) => ({
                ...item,
                id: String(item.id).trim(),
                modelName: String(item.id).trim(),
                displayName: String(item.id).trim(),
                provider: String(item.provider || 'openai').trim(),
                type: item.type || 'Chat',
                apiType: item.provider === 'tencent-vod' ? 'tencent-vod' : (item.apiType || 'openai'),
                _uid: item._uid || crypto.randomUUID?.() || `model-${Date.now()}-${Math.random()}`,
            }));
        localStorage.setItem(API_CONFIGS_KEY, JSON.stringify(normalized));
        setModels(normalized);
        window.dispatchEvent(new CustomEvent('vodstudio:api-settings-updated'));
        setMessage('模型配置已保存');
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <div className="flex max-h-[88vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-[#e5e5e7] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.22)]">
                <div className="flex items-center justify-between border-b border-[#ececef] px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1f2329] text-white"><Settings size={17} /></div>
                        <div>
                            <h2 className="text-base font-semibold text-[#1f2329]">全局 API 设置</h2>
                            <p className="mt-0.5 text-xs text-gray-400">应用内所有图片、视频和 AI 画布共用</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-[#f4f4f5] hover:text-gray-700"><X size={18} /></button>
                </div>

                <div className="flex gap-1 border-b border-[#ececef] px-6 pt-3">
                    <button onClick={() => setTab('providers')} className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm ${tab === 'providers' ? 'border-b-2 border-[#1f2329] font-medium text-[#1f2329]' : 'text-gray-400'}`}><KeyRound size={15} />接口配置</button>
                    <button onClick={() => setTab('models')} className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm ${tab === 'models' ? 'border-b-2 border-[#1f2329] font-medium text-[#1f2329]' : 'text-gray-400'}`}><LibraryBig size={15} />模型配置</button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-6">
                    {tab === 'providers' ? (
                        <div className="space-y-5">
                            <section className="rounded-xl border border-[#ececef] p-5">
                                <div className="mb-4 flex items-center justify-between">
                                    <div><h3 className="text-sm font-semibold text-[#1f2329]">TokenHub / OpenAI 兼容接口</h3><p className="mt-1 text-xs text-gray-400">角色提取、分镜和文本理解等能力</p></div>
                                    {configured.tokenhub && <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700"><Check size={12} />SQLite 已配置</span>}
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <label className="text-xs text-gray-500">Base URL<input value={tokenhub.baseUrl} onChange={(e) => setTokenhub((prev) => ({ ...prev, baseUrl: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-[#dedee2] px-3 py-2.5 text-sm text-[#1f2329] outline-none focus:border-[#9b9ba2]" /></label>
                                    <label className="text-xs text-gray-500">API Key<div className="relative mt-1.5"><input type={showSecrets ? 'text' : 'password'} value={tokenhub.apiKey} onChange={(e) => setTokenhub((prev) => ({ ...prev, apiKey: e.target.value }))} placeholder={configured.tokenhub ? '已配置；输入新值可覆盖' : 'sk-...'} className="w-full rounded-lg border border-[#dedee2] px-3 py-2.5 pr-10 text-sm text-[#1f2329] outline-none focus:border-[#9b9ba2]" /><button type="button" onClick={() => setShowSecrets((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400">{showSecrets ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
                                </div>
                            </section>

                            <section className="rounded-xl border border-[#ececef] p-5">
                                <div className="mb-4 flex items-center justify-between">
                                    <div><h3 className="text-sm font-semibold text-[#1f2329]">腾讯云媒体服务</h3><p className="mt-1 text-xs text-gray-400">VOD 生图/生视频，以及 MPS AI 换装</p></div>
                                    {configured.vod && <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700"><Check size={12} />SQLite 已配置</span>}
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <label className="text-xs text-gray-500">SecretId<input type={showSecrets ? 'text' : 'password'} value={vod.secretId} onChange={(e) => setVod((prev) => ({ ...prev, secretId: e.target.value }))} placeholder={configured.vod ? '已配置；输入新值可覆盖' : 'AKID...'} className="mt-1.5 w-full rounded-lg border border-[#dedee2] px-3 py-2.5 text-sm outline-none focus:border-[#9b9ba2]" /></label>
                                    <label className="text-xs text-gray-500">SecretKey<input type={showSecrets ? 'text' : 'password'} value={vod.secretKey} onChange={(e) => setVod((prev) => ({ ...prev, secretKey: e.target.value }))} placeholder={configured.vod ? '已配置；输入新值可覆盖' : 'SecretKey'} className="mt-1.5 w-full rounded-lg border border-[#dedee2] px-3 py-2.5 text-sm outline-none focus:border-[#9b9ba2]" /></label>
                                    <label className="text-xs text-gray-500">SubAppId<input value={vod.subAppId} onChange={(e) => setVod((prev) => ({ ...prev, subAppId: e.target.value }))} placeholder="子应用 ID" className="mt-1.5 w-full rounded-lg border border-[#dedee2] px-3 py-2.5 text-sm outline-none focus:border-[#9b9ba2]" /></label>
                                    <label className="text-xs text-gray-500">VOD Region<input value={vod.region} onChange={(e) => setVod((prev) => ({ ...prev, region: e.target.value }))} placeholder="ap-guangzhou" className="mt-1.5 w-full rounded-lg border border-[#dedee2] px-3 py-2.5 text-sm outline-none focus:border-[#9b9ba2]" /></label>
                                    <label className="text-xs text-gray-500">MPS 输出 COS Bucket<input value={vod.mpsBucket} onChange={(e) => setVod((prev) => ({ ...prev, mpsBucket: e.target.value }))} placeholder="example-1250000000" className="mt-1.5 w-full rounded-lg border border-[#dedee2] px-3 py-2.5 text-sm outline-none focus:border-[#9b9ba2]" /></label>
                                    <label className="text-xs text-gray-500">MPS 输出 Region<input value={vod.mpsRegion} onChange={(e) => setVod((prev) => ({ ...prev, mpsRegion: e.target.value }))} placeholder="ap-guangzhou" className="mt-1.5 w-full rounded-lg border border-[#dedee2] px-3 py-2.5 text-sm outline-none focus:border-[#9b9ba2]" /></label>
                                </div>
                            </section>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {models.map((model, index) => (
                                <div key={model._uid || index} className="grid items-end gap-3 rounded-xl border border-[#ececef] p-4 sm:grid-cols-[1fr_150px_120px_auto]">
                                    <label className="text-xs text-gray-500">模型 ID<input value={model.id || ''} onChange={(e) => setModels((items) => items.map((item, i) => i === index ? { ...item, id: e.target.value } : item))} className="mt-1.5 w-full rounded-lg border border-[#dedee2] px-3 py-2 text-sm outline-none" /></label>
                                    <label className="text-xs text-gray-500">Provider<input value={model.provider || ''} onChange={(e) => setModels((items) => items.map((item, i) => i === index ? { ...item, provider: e.target.value } : item))} className="mt-1.5 w-full rounded-lg border border-[#dedee2] px-3 py-2 text-sm outline-none" /></label>
                                    <label className="text-xs text-gray-500">类型<select value={model.type || 'Chat'} onChange={(e) => setModels((items) => items.map((item, i) => i === index ? { ...item, type: e.target.value } : item))} className="mt-1.5 w-full rounded-lg border border-[#dedee2] bg-white px-3 py-2 text-sm outline-none"><option>Chat</option><option>Image</option><option>Video</option></select></label>
                                    <button onClick={() => setModels((items) => items.filter((_, i) => i !== index))} className="rounded-lg p-2.5 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={16} /></button>
                                </div>
                            ))}
                            <button onClick={() => setModels((items) => [...items, { id: '', provider: 'openai', type: 'Chat', _uid: crypto.randomUUID?.() || `model-${Date.now()}` }])} className="flex items-center gap-2 rounded-lg border border-dashed border-[#d5d5d9] px-4 py-2.5 text-sm text-gray-500 hover:bg-[#f7f7f8]"><Plus size={15} />添加模型</button>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between border-t border-[#ececef] bg-[#fafafa] px-6 py-4">
                    <p className={`text-xs ${message.includes('失败') || message.includes('未启动') || message.includes('需要') ? 'text-red-500' : 'text-emerald-600'}`}>{message}</p>
                    <button disabled={saving} onClick={tab === 'providers' ? saveProviders : saveModels} className="flex items-center gap-2 rounded-lg bg-[#1f2329] px-4 py-2.5 text-sm font-medium text-white hover:bg-black disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}保存设置</button>
                </div>
            </div>
        </div>
    );
}
