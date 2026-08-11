/**
 * 图片工具 — 独立生图页面（非画布节点）
 * 参考图上传 + 模型/比例选择 + 提示词 + 生成
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
    ArrowLeft, ImagePlus, X, Sparkles, Loader2, AlertCircle, Download, Wand2, Copy, Check, Eye,
} from 'lucide-react';
import {
    VOD_IMAGE_MODEL_MATRIX,
    VOD_DEFAULT_IMAGE_MODEL_NAME, VOD_DEFAULT_IMAGE_MODEL_VERSION,
    runVodAigcPipeline,
} from '../vodAdapter';
import { getVodImageModelCapability } from '../data/vodImageModelCapabilities';
import i18n from '../i18n';

const t = (s) => i18n.t ? i18n.t(s) : s;

const LOCAL_SERVICE_URL = import.meta.env.DEV ? 'http://127.0.0.1:8080' : window.location.origin;
const PIPELINE_CONTEXT = {
    credentials: {},
    useProxy: true,
    localServerUrl: LOCAL_SERVICE_URL,
};

const HOME_REFERENCE_MAX_BYTES = 20 * 1024 * 1024;
const REFERENCE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const REFERENCE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

const STAGE_LABELS = {
    upload_start: '上传参考图...',
    upload_done: '参考图上传完成',
    create_task: '创建生成任务...',
    task_created: '任务已创建，等待生成...',
    polling: '生成中，正在查询任务状态...',
    task_finish: '生成完成',
};

function safeSampleImageURL(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    if (url.startsWith('/file/') || url.startsWith('/api/cache/')) return url;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
        return '';
    }
}

export default function ImageTool({ onBack, template, embedded = false }) {
    const referenceInputRef = useRef(null);
    const initialModelName = template?.model_name || VOD_DEFAULT_IMAGE_MODEL_NAME;
    const initialModelVersion = template?.model_version || VOD_DEFAULT_IMAGE_MODEL_VERSION;
    const initialCapability = getVodImageModelCapability(initialModelName, initialModelVersion);
    const [refImages, setRefImages] = useState(() => template?.reference_images || []);
    const [modelName, setModelName] = useState(initialModelName);
    const [modelVersion, setModelVersion] = useState(initialModelVersion);
    const [ratio, setRatio] = useState(() => initialCapability.ratios.includes(template?.ratio) ? template.ratio : initialCapability.defaultRatio);
    const [resolution, setResolution] = useState(() => initialCapability.resolutions.includes(template?.resolution) ? template.resolution : initialCapability.defaultResolution);
    const [enhancePrompt, setEnhancePrompt] = useState(template?.enhance_prompt || 'Enabled');
    const [storageMode, setStorageMode] = useState(() => {
        if (template?.storage_mode === 'Permanent') return 'Permanent';
        try {
            return localStorage.getItem('txstudio_aigc_storage_mode') === 'Permanent' ? 'Permanent' : 'Temporary';
        } catch {
            return 'Temporary';
        }
    });
    const [prompt, setPrompt] = useState(template?.prompt || '');
    const [loading, setLoading] = useState(false);
    const [stage, setStage] = useState('');
    const [results, setResults] = useState([]);
    const [error, setError] = useState('');
    const [promptCopied, setPromptCopied] = useState(false);

    // 模版中心可在不卸载本组件的情况下切换模版；同步全部生成参数，避免沿用旧模版的提示词或模型。
    useEffect(() => {
        const nextModelName = VOD_IMAGE_MODEL_MATRIX[template?.model_name]
            ? template.model_name
            : VOD_DEFAULT_IMAGE_MODEL_NAME;
        const availableVersions = VOD_IMAGE_MODEL_MATRIX[nextModelName] || [];
        const nextModelVersion = availableVersions.includes(template?.model_version)
            ? template.model_version
            : (nextModelName === VOD_DEFAULT_IMAGE_MODEL_NAME && availableVersions.includes(VOD_DEFAULT_IMAGE_MODEL_VERSION)
                ? VOD_DEFAULT_IMAGE_MODEL_VERSION
                : availableVersions[0] || '');
        const nextCapability = getVodImageModelCapability(nextModelName, nextModelVersion);
        setRefImages(template?.reference_images || []);
        setModelName(nextModelName);
        setModelVersion(nextModelVersion);
        setRatio(nextCapability.ratios.includes(template?.ratio) ? template.ratio : nextCapability.defaultRatio);
        setResolution(nextCapability.resolutions.includes(template?.resolution) ? template.resolution : nextCapability.defaultResolution);
        setEnhancePrompt(template?.enhance_prompt || 'Enabled');
        if (template?.storage_mode) {
            setStorageMode(template.storage_mode === 'Permanent' ? 'Permanent' : 'Temporary');
        }
        setPrompt(template?.prompt || '');
        setResults([]);
        setError('');
        setStage('');
    }, [template?.id, template?.prompt, template?.model_name, template?.model_version, template?.ratio, template?.resolution, template?.enhance_prompt, template?.storage_mode]);

    const versions = VOD_IMAGE_MODEL_MATRIX[modelName] || [];
    const modelCapability = getVodImageModelCapability(modelName, modelVersion);
    const sampleImageURL = safeSampleImageURL(template?.sample_image_url || template?.inspiration?.cover_url);
    const templateName = template?.inspiration?.name || template?.name || '';

    const copyPrompt = async () => {
        if (!prompt.trim() || !navigator.clipboard?.writeText) return;
        try {
            await navigator.clipboard.writeText(prompt);
            setPromptCopied(true);
            window.setTimeout(() => setPromptCopied(false), 1600);
        } catch {
            setPromptCopied(false);
        }
    };

    const handleModelChange = (nextModelName) => {
        const nextVersion = nextModelName === VOD_DEFAULT_IMAGE_MODEL_NAME
            && (VOD_IMAGE_MODEL_MATRIX[nextModelName] || []).includes(VOD_DEFAULT_IMAGE_MODEL_VERSION)
            ? VOD_DEFAULT_IMAGE_MODEL_VERSION
            : (VOD_IMAGE_MODEL_MATRIX[nextModelName] || [])[0] || '';
        const nextCapability = getVodImageModelCapability(nextModelName, nextVersion);
        setModelName(nextModelName);
        setModelVersion(nextVersion);
        setRatio((current) => nextCapability.ratios.includes(current) ? current : nextCapability.defaultRatio);
        setResolution((current) => nextCapability.resolutions.includes(current) ? current : nextCapability.defaultResolution);
        setError('');
    };

    const handleVersionChange = (nextVersion) => {
        const nextCapability = getVodImageModelCapability(modelName, nextVersion);
        setModelVersion(nextVersion);
        setRatio((current) => nextCapability.ratios.includes(current) ? current : nextCapability.defaultRatio);
        setResolution((current) => nextCapability.resolutions.includes(current) ? current : nextCapability.defaultResolution);
        setError('');
    };

    const handleUpload = useCallback((files) => {
        const remaining = Math.max(0, modelCapability.maxReferences - refImages.length);
        const validFiles = Array.from(files || []).filter((file) => REFERENCE_IMAGE_TYPES.has(file?.type) && file.size > 0 && file.size <= HOME_REFERENCE_MAX_BYTES);
        if (!remaining) {
            setError(`当前 ${modelName} ${modelVersion} 最多支持 ${modelCapability.maxReferences} 张参考图`);
            return;
        }
        if (!validFiles.length) {
            setError('请选择单张不超过 20MB 的 JPG、PNG 或 WEBP 图片');
            return;
        }
        const selected = validFiles.slice(0, remaining).map((file) => ({ file, preview: URL.createObjectURL(file) }));
        setError(validFiles.length > remaining ? `已按当前模型上限添加前 ${remaining} 张参考图` : '');
        setRefImages((previous) => [...previous, ...selected]);
    }, [modelCapability.maxReferences, modelName, modelVersion, refImages.length]);

    const removeRef = (idx) => {
        setRefImages((prev) => {
            const removed = prev[idx];
            if (removed?.preview) URL.revokeObjectURL(removed.preview);
            return prev.filter((_, i) => i !== idx);
        });
    };

    const generate = async () => {
        const requiredRefCount = Number(template?.ref_image_count || 0);
        if (template?.capability_id && refImages.length < requiredRefCount) {
            setError(`“${template.capability_name}”需要上传至少 ${requiredRefCount} 张参考图`);
            return;
        }
        if (refImages.length > modelCapability.maxReferences) {
            setError(`当前 ${modelName} ${modelVersion} 最多支持 ${modelCapability.maxReferences} 张参考图，请删除多余图片后再生成`);
            return;
        }
        if (!prompt.trim() && !refImages.length) {
            setError('请输入提示词或上传参考图');
            return;
        }
        setLoading(true); setError(''); setResults([]); setStage('创建生成任务...');
        try {
            const { urls } = await runVodAigcPipeline({
                type: 'image',
                modelName,
                modelVersion,
                prompt: prompt.trim(),
                enhancePrompt,
                sourceImages: refImages.map((item) => item.file),
                aspectRatio: ratio || undefined,
                extraConfig: {
                    ...(resolution ? { Resolution: resolution } : {}),
                    StorageMode: storageMode,
                },
            }, {
                ...PIPELINE_CONTEXT,
                history: { source: 'image_tool', parameters: { capability_id: template?.capability_id || '' } },
                onStage: (name) => setStage(STAGE_LABELS[name] || '处理中...'),
            });
            setResults(urls);
            setStage('');
        } catch (e) {
            setError('生成失败: ' + (e.message || ''));
            setStage('');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={embedded ? '' : 'app-surface min-h-screen'}>
            <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3 animate-fade-in">
                    <div className="flex items-center gap-3">
                        {!embedded && (
                            <button onClick={onBack} className="btn-ghost px-3 py-2 text-sm">
                                <ArrowLeft className="w-4 h-4" />
                                {t('返回')}
                            </button>
                        )}
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#4a90d9] to-[#58b7ca] shadow-[0_8px_18px_rgba(74,144,217,0.22)]">
                            <ImagePlus className="h-[18px] w-[18px] text-white" />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="text-xl font-semibold tracking-[-0.02em] text-[#1f2329]">{t(template?.capability_name || '图像创作')}</h1>
                                {templateName && <span className="rounded-full bg-[#fff2cc] px-2.5 py-1 text-[10px] font-semibold text-[#8a6510]">{templateName}</span>}
                            </div>
                            <p className="mt-1 text-xs text-[#8a8a90]">{templateName ? t('已应用模板，可调整参数后开始生成') : t('图片能力工作台')}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-[#ececef] bg-white px-3 py-2 text-[11px] text-[#65656d] shadow-sm">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#45b07a]" />
                        <span>{modelName}</span><span className="text-[#c2c2c5]">/</span><span>{modelVersion}</span>
                    </div>
                </div>

                <div className={sampleImageURL ? 'grid items-start gap-6 lg:grid-cols-[minmax(220px,0.62fr)_minmax(0,1.38fr)]' : ''}>
                    {sampleImageURL && (
                        <aside className="animate-fade-in lg:sticky lg:top-5">
                            <div className="overflow-hidden rounded-2xl border border-[#e8e2d5] bg-[#2c2922] shadow-[0_14px_35px_rgba(59,45,17,0.16)]">
                                <div className="relative aspect-[4/5] overflow-hidden bg-[#171717]">
                                    <img src={sampleImageURL} alt={templateName || t('模板效果样例')} className="h-full w-full object-cover" />
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent px-4 pb-4 pt-12 text-white">
                                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#f7d67b]"><Eye size={13} />{t('效果样例')}</div>
                                        <div className="mt-1 line-clamp-2 text-sm font-semibold">{templateName || t('当前模板')}</div>
                                    </div>
                                </div>
                                <div className="border-t border-white/10 px-4 py-3 text-[11px] leading-5 text-[#d7d1c5]">
                                    {t('此图仅用于展示模板效果，不会作为生成参考图上传。')}
                                </div>
                            </div>
                        </aside>
                    )}

                    <section className="min-w-0 animate-fade-in">
                        {template?.capability_name && (
                            <div className="mb-3 flex items-center justify-between gap-4 rounded-2xl border border-[#f0dfad] bg-[#fffaf0] px-4 py-3">
                                <div><div className="text-sm font-semibold text-[#3f3215]">{t(template.capability_name)}</div><div className="mt-1 text-xs text-[#88754a]">{t(template.description || '')}</div></div>
                                <div className="shrink-0 rounded-full bg-[#f4bd35] px-3 py-1.5 text-xs font-medium text-[#3b2a00]">{t('参考图')} × {template.ref_image_count || 1}</div>
                            </div>
                        )}

                        <div className="glass-card overflow-hidden rounded-2xl">
                            <div className="border-b border-[#ececef] bg-[#fbfbfa] px-4 py-3 sm:px-5">
                                <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-[#2b2b30]">{t('创作设置')}</h2><p className="mt-0.5 text-[11px] text-[#909096]">{t('选择模型与画面规格，编辑提示词后即可生成')}</p></div><Sparkles className="h-4 w-4 text-[#c69322]" /></div>
                            </div>
                            <div className="p-3.5 sm:p-4">
                                <div className="mb-3 lg:flex lg:items-center lg:justify-between lg:gap-5">
                                    <div className="mb-2 lg:mb-0"><div className="flex items-baseline gap-3"><label className="text-sm font-semibold text-[#45454c]">{template?.capability_name ? `${t('参考图')}（${t('至少上传')} ${template.ref_image_count || 1} ${t('张')}）` : t('参考图（可选）')}</label><span className="text-[11px] text-[#9a9aa0]">{t('最多')} {modelCapability.maxReferences} {t('张')}</span></div><p className="mt-0.5 text-[11px] leading-4 text-[#96969d]">{t(modelCapability.description)}</p></div>
                                    <div className="flex flex-wrap gap-2 lg:shrink-0 lg:flex-nowrap">
                                        {refImages.map((r, i) => (
                                            <div key={r.preview || i} className="group relative">
                                                <img src={r.preview} alt={t('生成参考图')} className="h-14 w-14 rounded-lg border border-[#e4e4e8] object-cover shadow-sm" />
                                                <button type="button" onClick={() => removeRef(i)} aria-label={t('移除参考图')} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#e95252] text-white opacity-0 shadow-lg transition group-hover:opacity-100 focus:opacity-100"><X className="h-3 w-3" /></button>
                                            </div>
                                        ))}
                                        {refImages.length < modelCapability.maxReferences && <><input ref={referenceInputRef} type="file" accept={REFERENCE_IMAGE_ACCEPT} multiple className="sr-only" onChange={(event) => { handleUpload(event.target.files); event.target.value = ''; }} /><button type="button" onClick={() => referenceInputRef.current?.click()} className="dropzone h-14 w-14 bg-[#fafafa]" title={t(`添加参考图（最多 ${modelCapability.maxReferences} 张）`)} aria-label={t(`添加参考图（最多 ${modelCapability.maxReferences} 张）`)}><ImagePlus className="h-4 w-4" /><span className="text-[9px]">{t('添加')}</span></button></>}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-[#f0f0f1] pt-4 sm:grid-cols-3">
                                    <label className="min-w-0"><span className="mb-1.5 block text-[11px] font-medium text-[#686870]">{t('模型')}</span><select value={modelName} onChange={(event) => handleModelChange(event.target.value)} className="field h-10 text-[13px]">{Object.keys(VOD_IMAGE_MODEL_MATRIX).map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
                                    <label className="min-w-0"><span className="mb-1.5 block text-[11px] font-medium text-[#686870]">{t('版本')}</span><select value={modelVersion} onChange={(event) => handleVersionChange(event.target.value)} className="field h-10 text-[13px]">{versions.map((version) => <option key={version} value={version}>{version}</option>)}</select></label>
                                    <label className="min-w-0"><span className="mb-1.5 block text-[11px] font-medium text-[#686870]">{t('长宽比')}</span><select value={ratio} onChange={(event) => setRatio(event.target.value)} className="field h-10 text-[13px]">{modelCapability.ratios.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                                    <label className="min-w-0"><span className="mb-1.5 block text-[11px] font-medium text-[#686870]">{t('输出大小')}</span>{modelCapability.resolutions.length ? <select value={resolution} onChange={(event) => setResolution(event.target.value)} className="field h-10 text-[13px]">{modelCapability.resolutions.map((item) => <option key={item} value={item}>{item}</option>)}</select> : <div className="field flex h-10 items-center text-[12px] text-gray-400">{t('模型自动尺寸')}</div>}</label>
                                    <label className="min-w-0"><span className="mb-1.5 block text-[11px] font-medium text-[#686870]">{t('提示词增强')}</span><select value={enhancePrompt} onChange={(event) => setEnhancePrompt(event.target.value)} className="field h-10 text-[13px]"><option value="Enabled">{t('开启')}</option><option value="Disabled">{t('关闭')}</option></select></label>
                                    <label className="min-w-0"><span className="mb-1.5 block text-[11px] font-medium text-[#686870]">{t('存储模式')}</span><select value={storageMode} onChange={(event) => setStorageMode(event.target.value)} className="field h-10 text-[13px]"><option value="Temporary">{t('临时存储（7 天）')}</option><option value="Permanent">{t('永久保存到 VOD')}</option></select></label>
                                </div>

                                <div className="mt-4 rounded-xl border border-[#e7e7eb] bg-[#fcfcfc] p-3.5">
                                    <div className="mb-1.5 flex items-center justify-between gap-3"><label className="text-sm font-semibold text-[#45454c]">{t('提示词')}</label><button type="button" onClick={copyPrompt} disabled={!prompt.trim()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[#72727a] transition hover:bg-[#efeff1] hover:text-[#34343a] disabled:cursor-not-allowed disabled:opacity-50">{promptCopied ? <Check className="h-3.5 w-3.5 text-[#3d9f6e]" /> : <Copy className="h-3.5 w-3.5" />}{promptCopied ? t('已复制') : t('复制')}</button></div>
                                    <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder={t('描述你想要的图片...')} className="field min-h-[92px] resize-y leading-6" />
                                    <div className="mt-1 text-right text-[10px] text-[#a0a0a6]">{prompt.trim().length} {t('字符')}</div>
                                </div>

                                {error && <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
                                {stage && <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#eef7ff] px-3 py-2.5 text-sm text-[#397bb5]"><Loader2 className="h-4 w-4 animate-spin" /><span>{stage}</span></div>}

                                <div className="mt-4 border-t border-[#f0f0f1] pt-3"><button type="button" onClick={generate} disabled={loading} className="btn-primary w-full py-3"><>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}</>{loading ? t('生成中...') : t('生成图片')}</button></div>
                            </div>
                        </div>

                        {results.length > 0 && <div className="mt-6 animate-fade-in"><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[#c69322]" /><h2 className="text-sm font-semibold text-[#424249]">{t('生成结果')}</h2><span className="rounded-full bg-[#f2f2f3] px-2 py-0.5 text-[10px] text-[#797980]">{results.length}</span></div><span className="text-[11px] text-[#9999a0]">{t('点击预览或下载原图')}</span></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{results.map((url, i) => <div key={url} className="group relative overflow-hidden rounded-2xl border border-[#e5e5e9] bg-[#f6f6f7] shadow-sm"><a href={url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden"><img src={url} alt={`${t('生成结果')} ${i + 1}`} className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.015]" /></a><div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-9 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"><span className="text-xs font-medium text-white">{t('结果')} {i + 1}</span><a href={url} target="_blank" rel="noreferrer" download className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-[#35353a] shadow-sm hover:bg-white" title={t('下载原图')} aria-label={t('下载原图')}><Download className="h-4 w-4" /></a></div></div>)}</div></div>}
                    </section>
                </div>
            </div>
        </div>
    );
}
