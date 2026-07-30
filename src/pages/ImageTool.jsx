/**
 * 图片工具 — 独立生图页面（非画布节点）
 * 参考图上传 + 模型/比例选择 + 提示词 + 生成
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
    ArrowLeft, ImagePlus, X, Sparkles, Loader2, AlertCircle, Download, Wand2,
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

    const versions = VOD_IMAGE_MODEL_MATRIX[modelName] || [];
    const modelCapability = getVodImageModelCapability(modelName, modelVersion);

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
            <div className="max-w-4xl mx-auto px-6 py-8">
                {/* 顶部栏 */}
                <div className="flex items-center justify-between mb-8 animate-fade-in">
                    <div className="flex items-center gap-3">
                        {!embedded && (
                            <button onClick={onBack} className="btn-ghost px-3 py-2 text-sm">
                                <ArrowLeft className="w-4 h-4" />
                                {t('返回')}
                            </button>
                        )}
                        <div className="flex items-center gap-2.5">
                            <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 shadow-lg">
                                <ImagePlus className="w-4 h-4 text-white" />
                            </div>
                            <div>
                                <h1 className="text-xl font-semibold text-[#1f2329]">{t(template?.capability_name || '图像创作')}</h1>
                                {template?.capability_name && (
                                    <p className="mt-0.5 text-xs text-gray-400">{t('图片能力工作台')}</p>
                                )}
                                {template?.inspiration && (
                                    <p className="mt-0.5 text-xs text-[#a4781a]">{t('灵感样式：')}{t(template.inspiration.name)}</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {template?.capability_name && (
                    <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-[#f0dfad] bg-[#fffaf0] px-5 py-4 animate-fade-in">
                        <div>
                            <div className="text-sm font-semibold text-[#3f3215]">{t(template.capability_name)}</div>
                            <div className="mt-1 text-xs text-[#88754a]">{t(template.description || '')}</div>
                        </div>
                        <div className="shrink-0 rounded-full bg-[#f4bd35] px-3 py-1.5 text-xs font-medium text-[#3b2a00]">
                            {t('参考图')} × {template.ref_image_count || 1}
                        </div>
                    </div>
                )}

                <div className="glass-card rounded-2xl p-6 mb-6 animate-fade-in">
                    {/* 参考图 */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-600 mb-3">
                            {template?.capability_name
                                ? `${t('参考图')}（${t('至少上传')} ${template.ref_image_count || 1} ${t('张')}，${t('最多')} ${modelCapability.maxReferences} ${t('张')}）`
                                : `${t('参考图（可选）')} · ${t('最多')} ${modelCapability.maxReferences} ${t('张')}`}
                        </label>
                        <p className="-mt-2 mb-3 text-xs leading-5 text-gray-400">{t(modelCapability.description)}</p>
                        <div className="flex flex-wrap gap-3">
                            {refImages.map((r, i) => (
                                <div key={i} className="relative group">
                                    <img src={r.preview} alt="" className="w-20 h-20 object-cover rounded-xl border border-[#ececef]" />
                                    <button onClick={() => removeRef(i)}
                                        className="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg transition">
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                            {refImages.length < modelCapability.maxReferences && (
                                <>
                                    <input
                                        ref={referenceInputRef}
                                        type="file"
                                        accept={REFERENCE_IMAGE_ACCEPT}
                                        multiple
                                        className="sr-only"
                                        onChange={(event) => {
                                            handleUpload(event.target.files);
                                            event.target.value = '';
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => referenceInputRef.current?.click()}
                                        className="dropzone w-20 h-20"
                                        title={t(`添加参考图（最多 ${modelCapability.maxReferences} 张）`)}
                                        aria-label={t(`添加参考图（最多 ${modelCapability.maxReferences} 张）`)}
                                    >
                                        <ImagePlus className="w-5 h-5" />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* 模型 + 版本 + 输出参数 */}
                    <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 xl:grid-cols-5">
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('模型')}</label>
                            <select value={modelName} onChange={(event) => handleModelChange(event.target.value)} className="field">
                                {Object.keys(VOD_IMAGE_MODEL_MATRIX).map((model) => <option key={model} value={model}>{model}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('版本')}</label>
                            <select value={modelVersion} onChange={(event) => handleVersionChange(event.target.value)} className="field">
                                {versions.map((version) => <option key={version} value={version}>{version}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('长宽比')}</label>
                            <select value={ratio} onChange={(event) => setRatio(event.target.value)} className="field">
                                {modelCapability.ratios.map((item) => <option key={item} value={item}>{item}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('输出大小')}</label>
                            {modelCapability.resolutions.length ? (
                                <select value={resolution} onChange={(event) => setResolution(event.target.value)} className="field">
                                    {modelCapability.resolutions.map((item) => <option key={item} value={item}>{item}</option>)}
                                </select>
                            ) : (
                                <div className="field flex items-center text-sm text-gray-400">{t('模型自动尺寸')}</div>
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('提示词增强')}</label>
                            <select value={enhancePrompt} onChange={(event) => setEnhancePrompt(event.target.value)} className="field">
                                <option value="Enabled">{t('开启')}</option>
                                <option value="Disabled">{t('关闭')}</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('存储模式')}</label>
                            <select value={storageMode} onChange={(event) => setStorageMode(event.target.value)} className="field">
                                <option value="Temporary">{t('临时存储（7 天）')}</option>
                                <option value="Permanent">{t('永久保存到 VOD')}</option>
                            </select>
                        </div>
                    </div>

                    {/* 提示词 */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-600 mb-2">{t('提示词')}</label>
                        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder={t('描述你想要的图片...')}
                            className="field resize-none" />
                    </div>

                    {error && (
                        <div className="mb-4 flex items-start gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}
                    {stage && (
                        <div className="mb-4 flex items-center gap-2 text-sm text-brand-600">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>{stage}</span>
                        </div>
                    )}

                    <button onClick={generate} disabled={loading} className="btn-primary w-full py-3">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                        {loading ? t('生成中...') : t('生成图片')}
                    </button>
                </div>

                {results.length > 0 && (
                    <div className="animate-fade-in">
                        <div className="flex items-center gap-2 mb-3">
                            <Sparkles className="w-4 h-4 text-brand-600" />
                            <h2 className="text-sm font-medium text-gray-600">{t('生成结果')}</h2>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {results.map((url, i) => (
                                <a key={i} href={url} target="_blank" rel="noreferrer"
                                    className="group relative block rounded-xl overflow-hidden border border-[#ececef]">
                                    <img src={url} alt="" className="w-full" />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                                        <Download className="w-5 h-5 text-white" />
                                    </div>
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
