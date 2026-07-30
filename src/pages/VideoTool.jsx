/**
 * 视频工具 — 独立生视频页面（非画布节点）
 * 模式：首尾帧 / 多图
 */
import React, { useRef, useState, useCallback } from 'react';
import {
    ArrowLeft, Clapperboard, X, Plus, Loader2, AlertCircle, Wand2, Sparkles,
    Film, Images,
} from 'lucide-react';
import {
    VOD_VIDEO_MODEL_MATRIX, VOD_VIDEO_RATIOS, VOD_VIDEO_DURATIONS,
    VOD_DEFAULT_VIDEO_MODEL_NAME, VOD_DEFAULT_VIDEO_MODEL_VERSION,
    runVodAigcPipeline,
} from '../vodAdapter';
import i18n from '../i18n';

const t = (s) => i18n.t ? i18n.t(s) : s;
const LOCAL_SERVICE_URL = import.meta.env.DEV ? 'http://127.0.0.1:8080' : window.location.origin;
const PIPELINE_CONTEXT = {
    credentials: {},
    useProxy: true,
    localServerUrl: LOCAL_SERVICE_URL,
};
const VIDEO_REFERENCE_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MULTI_REFERENCE_LIMIT = 10;
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

export default function VideoTool({ onBack, template, embedded = false }) {
    const firstFrameInputRef = useRef(null);
    const lastFrameInputRef = useRef(null);
    const multiImagesInputRef = useRef(null);
    const [mode, setMode] = useState('firstlast'); // firstlast | multi
    const [firstFrame, setFirstFrame] = useState(null);
    const [lastFrame, setLastFrame] = useState(null);
    const [multiImages, setMultiImages] = useState([]);
    const [modelName, setModelName] = useState(template?.model_name || VOD_DEFAULT_VIDEO_MODEL_NAME);
    const [modelVersion, setModelVersion] = useState(template?.model_version || VOD_DEFAULT_VIDEO_MODEL_VERSION);
    const [ratio, setRatio] = useState(template?.ratio || '16:9');
    const [duration, setDuration] = useState('5s');
    const [prompt, setPrompt] = useState(template?.prompt || '');
    const [loading, setLoading] = useState(false);
    const [stage, setStage] = useState('');
    const [results, setResults] = useState([]);
    const [error, setError] = useState('');

    const versions = VOD_VIDEO_MODEL_MATRIX[modelName] || [];

    const makePreview = useCallback((file) => ({
        file,
        preview: URL.createObjectURL(file),
    }), []);

    const isValidReferenceImage = (file) => REFERENCE_IMAGE_TYPES.has(file?.type)
        && file.size > 0
        && file.size <= VIDEO_REFERENCE_MAX_BYTES;

    const handleUploadSingle = (files, setter) => {
        const file = files?.[0];
        if (!file) return;
        if (!isValidReferenceImage(file)) {
            setError('请选择单张不超过 20MB 的 JPG、PNG 或 WEBP 图片');
            return;
        }
        setError('');
        setter((previous) => {
            if (previous?.preview) URL.revokeObjectURL(previous.preview);
            return makePreview(file);
        });
    };
    const handleUploadMulti = (files) => {
        const remaining = Math.max(0, VIDEO_MULTI_REFERENCE_LIMIT - multiImages.length);
        const validFiles = Array.from(files || []).filter(isValidReferenceImage);
        if (!remaining) {
            setError(`最多支持 ${VIDEO_MULTI_REFERENCE_LIMIT} 张参考图`);
            return;
        }
        if (!validFiles.length) {
            setError('请选择单张不超过 20MB 的 JPG、PNG 或 WEBP 图片');
            return;
        }
        const accepted = validFiles.slice(0, remaining).map(makePreview);
        setError(validFiles.length > remaining ? `已按上限添加前 ${remaining} 张参考图` : '');
        setMultiImages((previous) => [...previous, ...accepted]);
    };

    const clearPreview = (item, setter) => {
        if (item?.preview) URL.revokeObjectURL(item.preview);
        setter(null);
    };

    const generate = async () => {
        setLoading(true); setError(''); setResults([]); setStage('创建生成任务...');
        try {
            let sourceImages = [];
            let sourceFileInfos = null;
            let lastFrameSourceIndex = -1;
            if (mode === 'firstlast') {
                if (!firstFrame && !lastFrame) { setError('请上传首帧或尾帧'); setLoading(false); setStage(''); return; }
                if (firstFrame) {
                    sourceImages.push(firstFrame.file);
                    sourceFileInfos = [{ Usage: 'FirstFrame' }];
                }
                if (lastFrame) {
                    sourceImages.push(lastFrame.file);
                    sourceFileInfos = [...(sourceFileInfos || []), null];
                    lastFrameSourceIndex = sourceImages.length - 1;
                }
            } else {
                if (!multiImages.length) { setError('请至少上传一张图片'); setLoading(false); setStage(''); return; }
                sourceImages = multiImages.map((item) => item.file);
                sourceFileInfos = sourceImages.map(() => ({ Usage: 'Reference', Category: 'Image' }));
            }
            const durationValue = Number(String(duration).replace(/[^0-9.]/g, ''));
            const { urls } = await runVodAigcPipeline({
                type: 'video',
                modelName,
                modelVersion,
                prompt: prompt.trim() || undefined,
                sourceImages,
                sourceFileInfos,
                lastFrameSourceIndex,
                aspectRatio: ratio === 'Auto' ? undefined : ratio,
                extraConfig: {
                    ...(Number.isFinite(durationValue) ? { Duration: durationValue } : {}),
                },
            }, {
                ...PIPELINE_CONTEXT,
                onStage: (name) => setStage(STAGE_LABELS[name] || '处理中...'),
            });
            setResults(urls);
            setStage('');
        } catch (e) {
            setError('生成失败: ' + (e.message || '')); setStage('');
        } finally { setLoading(false); }
    };

    const slot = (img, onPick, onClear, label, inputRef) => (
        <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">{t(label)}</label>
            <input
                ref={inputRef}
                type="file"
                accept={REFERENCE_IMAGE_ACCEPT}
                className="sr-only"
                onChange={(event) => {
                    handleUploadSingle(event.target.files, onPick);
                    event.target.value = '';
                }}
            />
            {img ? (
                <div className="relative inline-block group">
                    <img src={img.preview} alt="" className="w-28 h-28 object-cover rounded-xl border border-[#ececef]" />
                    <button type="button" onClick={onClear}
                        className="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg transition"
                        aria-label={t(`删除${label}`)}
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="dropzone w-28 h-28 cursor-pointer"
                    title={t('添加参考图')}
                    aria-label={t(`添加${label}`)}
                >
                    <Plus className="w-5 h-5" />
                </button>
            )}
        </div>
    );

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
                            <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-400 shadow-lg">
                                <Clapperboard className="w-4 h-4 text-white" />
                            </div>
                            <h1 className="text-xl font-semibold text-[#1f2329]">{t('视频工具')}</h1>
                        </div>
                    </div>
                </div>

                <div className="glass-card rounded-2xl p-6 mb-6 animate-fade-in">
                    {/* 模式切换 */}
                    <div className="segmented mb-6">
                        <button data-active={mode === 'firstlast'} onClick={() => setMode('firstlast')}>
                            <span className="inline-flex items-center gap-1.5 justify-center"><Film className="w-4 h-4" />{t('首尾帧模式')}</span>
                        </button>
                        <button data-active={mode === 'multi'} onClick={() => setMode('multi')}>
                            <span className="inline-flex items-center gap-1.5 justify-center"><Images className="w-4 h-4" />{t('多图模式')}</span>
                        </button>
                    </div>

                    {/* 帧上传 */}
                    <div className="mb-6">
                        {mode === 'firstlast' ? (
                            <div className="flex gap-6">
                                {slot(firstFrame, setFirstFrame, () => clearPreview(firstFrame, setFirstFrame), '首帧（可选）', firstFrameInputRef)}
                                {slot(lastFrame, setLastFrame, () => clearPreview(lastFrame, setLastFrame), '尾帧（可选）', lastFrameInputRef)}
                            </div>
                        ) : (
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-2">{t('多图（1 张及以上）')}</label>
                                <div className="flex flex-wrap gap-3">
                                    {multiImages.map((r, i) => (
                                        <div key={i} className="relative group">
                                            <img src={r.preview} alt="" className="w-20 h-20 object-cover rounded-xl border border-[#ececef]" />
                                            <button onClick={() => setMultiImages((prev) => {
                                                if (prev[i]?.preview) URL.revokeObjectURL(prev[i].preview);
                                                return prev.filter((_, j) => j !== i);
                                            })}
                                                className="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg transition">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                    {multiImages.length < VIDEO_MULTI_REFERENCE_LIMIT && (
                                        <>
                                            <input
                                                ref={multiImagesInputRef}
                                                type="file"
                                                accept={REFERENCE_IMAGE_ACCEPT}
                                                multiple
                                                className="sr-only"
                                                onChange={(event) => {
                                                    handleUploadMulti(event.target.files);
                                                    event.target.value = '';
                                                }}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => multiImagesInputRef.current?.click()}
                                                className="dropzone w-20 h-20 cursor-pointer"
                                                title={t(`添加参考图（最多 ${VIDEO_MULTI_REFERENCE_LIMIT} 张）`)}
                                                aria-label={t(`添加参考图（最多 ${VIDEO_MULTI_REFERENCE_LIMIT} 张）`)}
                                            >
                                                <Plus className="w-5 h-5" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 模型/版本/比例/时长 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('模型')}</label>
                            <select value={modelName} onChange={(e) => { setModelName(e.target.value); setModelVersion((VOD_VIDEO_MODEL_MATRIX[e.target.value] || [''])[0]); }} className="field">
                                {Object.keys(VOD_VIDEO_MODEL_MATRIX).map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('版本')}</label>
                            <select value={modelVersion} onChange={(e) => setModelVersion(e.target.value)} className="field">
                                {versions.map((v) => <option key={v} value={v}>{v}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('比例')}</label>
                            <select value={ratio} onChange={(e) => setRatio(e.target.value)} className="field">
                                {VOD_VIDEO_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('时长')}</label>
                            <select value={duration} onChange={(e) => setDuration(e.target.value)} className="field">
                                {VOD_VIDEO_DURATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* 提示词 */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-600 mb-2">{t('提示词')}</label>
                        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder={t('描述想要的视频...')} className="field resize-none" />
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
                        {loading ? t('生成中...') : t('生成视频')}
                    </button>
                </div>

                {results.length > 0 && (
                    <div className="animate-fade-in">
                        <div className="flex items-center gap-2 mb-3">
                            <Sparkles className="w-4 h-4 text-brand-600" />
                            <h2 className="text-sm font-medium text-gray-600">{t('生成结果')}</h2>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {results.map((url, i) => (
                                <video key={i} src={url} controls className="w-full rounded-xl border border-[#ececef]" />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
