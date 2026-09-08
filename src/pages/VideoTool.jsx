/**
 * 视频工具 — 独立生视频页面（非画布节点）
 * 模式：首尾帧 / 多图
 */
import React, { useRef, useState, useCallback } from 'react';
import {
    ArrowLeft, Clapperboard, X, Plus, Loader2, AlertCircle, Wand2, Sparkles,
    Film, Images, Video as VideoIcon, Music,
} from 'lucide-react';
import {
    VOD_VIDEO_MODEL_MATRIX, getVodVideoModelCapability,
    VOD_DEFAULT_VIDEO_MODEL_NAME, VOD_DEFAULT_VIDEO_MODEL_VERSION,
    runVodAigcPipeline,
    uploadImageToVod,
} from '../vodAdapter';
import { prepareReferenceImage } from '../api/mediaAssetCache';
import i18n from '../i18n';

const t = (s) => i18n.t ? i18n.t(s) : s;
const LOCAL_SERVICE_URL = import.meta.env.DEV ? 'http://127.0.0.1:8080' : window.location.origin;
const PIPELINE_CONTEXT = {
    credentials: {},
    useProxy: true,
    localServerUrl: LOCAL_SERVICE_URL,
};
const VIDEO_REFERENCE_MAX_BYTES = 20 * 1024 * 1024;
const REFERENCE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
    const [multiVideos, setMultiVideos] = useState([]);
    const [multiAudios, setMultiAudios] = useState([]);
    const [modelName, setModelName] = useState(template?.model_name || VOD_DEFAULT_VIDEO_MODEL_NAME);
    const [modelVersion, setModelVersion] = useState(template?.model_version || VOD_DEFAULT_VIDEO_MODEL_VERSION);
    const [ratio, setRatio] = useState(template?.ratio || '16:9');
    const [duration, setDuration] = useState('5s');
    const [resolution, setResolution] = useState(template?.resolution || '720P');
    const [storageMode, setStorageMode] = useState(() => template?.storage_mode === 'Temporary' ? 'Temporary' : 'Permanent');
    const [prompt, setPrompt] = useState(template?.prompt || '');
    const [loading, setLoading] = useState(false);
    const [stage, setStage] = useState('');
    const [results, setResults] = useState([]);
    const [error, setError] = useState('');

    const versions = VOD_VIDEO_MODEL_MATRIX[modelName] || [];
    const videoCapability = getVodVideoModelCapability(modelName, modelVersion);
    const supportedReferenceMimeTypes = new Set([
        ...(videoCapability.referenceImageMimeTypes || REFERENCE_IMAGE_TYPES),
        ...(videoCapability.forceVodFileIdReferences ? ['image/webp'] : []),
    ]);
    const referenceMaxBytes = videoCapability.maxReferenceImageBytes || VIDEO_REFERENCE_MAX_BYTES;
    const supportsFirstLastFrame = !!videoCapability.supportsFirstLastFrame;
    const supportsLastFrameOnly = !!videoCapability.supportsLastFrameOnly;
    const supportsReferenceImages = videoCapability.supportsReferenceImages !== false;
    const resolutionLabels = videoCapability.resolutionLabels || null;
    const hasResolutionOptions = Array.isArray(videoCapability.resolutions) && videoCapability.resolutions.length > 0;
    const maxReferenceVideos = videoCapability.supportsReferenceVideos ? (videoCapability.maxReferenceVideos || 0) : 0;
    const maxReferenceAudios = videoCapability.supportsReferenceAudios ? (videoCapability.maxReferenceAudios || 0) : 0;
    const supportsReferenceVideos = maxReferenceVideos > 0;
    const supportsReferenceAudios = maxReferenceAudios > 0;
    const supportsMultiReference = supportsReferenceImages || supportsReferenceVideos || supportsReferenceAudios;
    const referenceMediaDimensionRange = videoCapability.referenceMediaDimensionRange || null;
    const referenceVideoDurationRange = videoCapability.referenceVideoDurationRange || null;
    const referenceVideoTotalDurationMax = videoCapability.referenceVideoTotalDurationMax || null;
    const referenceAudioDurationRange = videoCapability.referenceAudioDurationRange || null;
    const referenceAudioTotalDurationMax = videoCapability.referenceAudioTotalDurationMax || null;
    const referenceVideoMaxBytes = videoCapability.referenceVideoMaxBytes || 100 * 1024 * 1024;
    const referenceAudioMaxBytes = videoCapability.referenceAudioMaxBytes || 50 * 1024 * 1024;
    const referenceMediaAccept = [
        ...(supportsReferenceImages ? Array.from(supportedReferenceMimeTypes) : []),
        ...(supportsReferenceVideos ? ['video/mp4', 'video/quicktime', 'video/webm'] : []),
        ...(supportsReferenceAudios ? ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/ogg'] : []),
    ].join(',');
    const referenceImageRequirement = `${Array.from(supportedReferenceMimeTypes).map((type) => type.replace('image/', '').toUpperCase()).join('、')}，单张不超过 ${Math.floor(referenceMaxBytes / 1024 / 1024)}MB`;
    const referenceImageAccept = Array.from(supportedReferenceMimeTypes).join(',');

    const [referencePreparing, setReferencePreparing] = useState(0);
    const referenceSessionRef = useRef(0);

    const makePreview = useCallback((file) => ({
        file,
        preview: URL.createObjectURL(file),
        status: 'checking',
    }), []);

    const prepareReference = useCallback(async (file, kind = 'image') => {
        return prepareReferenceImage(file, PIPELINE_CONTEXT, {
            mediaType: kind === 'image' ? 'image' : kind,
            storageMode,
            upload: (input) => uploadImageToVod(input, PIPELINE_CONTEXT),
        });
    }, [storageMode]);

    const probeMediaDuration = (file) => new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const isVideo = file.type.startsWith('video/');
        const element = document.createElement(isVideo ? 'video' : 'audio');
        element.preload = 'metadata';
        element.onloadedmetadata = () => {
            const result = {
                duration: Number.isFinite(element.duration) ? element.duration : 0,
                width: isVideo ? element.videoWidth || 0 : 0,
                height: isVideo ? element.videoHeight || 0 : 0,
            };
            URL.revokeObjectURL(url);
            resolve(result);
        };
        element.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('无法读取媒体文件信息'));
        };
        element.src = url;
    });

    const isValidReferenceImage = (file) => supportedReferenceMimeTypes.has(file?.type)
        && file.size > 0
        && file.size <= referenceMaxBytes;

    const handleUploadSingle = (files, setter) => {
        const file = files?.[0];
        if (!file) return;
        if (!isValidReferenceImage(file)) {
            setError(`请选择 ${referenceImageRequirement} 的参考图`);
            return;
        }
        setError('');
        const sessionId = ++referenceSessionRef.current;
        setter((previous) => {
            if (previous?.preview) URL.revokeObjectURL(previous.preview);
            return makePreview(file);
        });
        void (async () => {
            setReferencePreparing((count) => count + 1);
            try {
                const asset = await prepareReference(file);
                if (referenceSessionRef.current !== sessionId) return;
                setter((previous) => previous ? { ...previous, asset, status: 'ready' } : previous);
            } catch (nextError) {
                if (referenceSessionRef.current === sessionId) {
                    setter(null);
                    setError(`参考图准备失败：${nextError?.message || '无法上传云端'}`);
                }
            } finally {
                setReferencePreparing((count) => Math.max(0, count - 1));
            }
        })();
    };
    const handleUploadMulti = (files) => {
        const incoming = Array.from(files || []);
        if (!incoming.length) return;

        const imageFiles = [];
        const videoFiles = [];
        const audioFiles = [];
        const rejected = [];
        incoming.forEach((file) => {
            if (file.type.startsWith('image/')) {
                (isValidReferenceImage(file) ? imageFiles : rejected).push(file);
            } else if (file.type.startsWith('video/')) {
                (file.size > 0 && file.size <= referenceVideoMaxBytes ? videoFiles : rejected).push(file);
            } else if (file.type.startsWith('audio/')) {
                (file.size > 0 && file.size <= referenceAudioMaxBytes ? audioFiles : rejected).push(file);
            } else {
                rejected.push(file);
            }
        });
        if (rejected.length) {
            setError(`已忽略 ${rejected.length} 个不符合要求的文件（图片 ${referenceImageRequirement}；视频不超过 ${Math.floor(referenceVideoMaxBytes / 1024 / 1024)}MB；音频不超过 ${Math.floor(referenceAudioMaxBytes / 1024 / 1024)}MB）`);
        }

        const imageSlots = supportsReferenceImages ? Math.max(0, videoCapability.maxReferenceImages - multiImages.length) : 0;
        const videoSlots = Math.max(0, maxReferenceVideos - multiVideos.length);
        const audioSlots = Math.max(0, maxReferenceAudios - multiAudios.length);
        if (!imageSlots && !videoSlots && !audioSlots) {
            setError(`当前模型参考素材已达上限（图片 ${videoCapability.maxReferenceImages} 张、视频 ${maxReferenceVideos} 段、音频 ${maxReferenceAudios} 段）`);
            return;
        }

        const acceptedImages = imageFiles.slice(0, imageSlots).map((file) => makePreview(file));
        const acceptedVideos = videoFiles.slice(0, videoSlots).map((file) => ({ file, kind: 'video', preview: '', name: file.name || '', status: 'validating' }));
        const acceptedAudios = audioFiles.slice(0, audioSlots).map((file) => ({ file, kind: 'audio', preview: '', name: file.name || '', status: 'validating' }));
        const overflowCount = (imageFiles.length - acceptedImages.length) + (videoFiles.length - acceptedVideos.length) + (audioFiles.length - acceptedAudios.length);
        if (overflowCount > 0 && !rejected.length) {
            setError(`已达参考素材数量上限，仅添加了前 ${incoming.length - overflowCount} 个文件`);
        }

        if (acceptedImages.length) setMultiImages((previous) => [...previous, ...acceptedImages]);
        if (acceptedVideos.length) setMultiVideos((previous) => [...previous, ...acceptedVideos]);
        if (acceptedAudios.length) setMultiAudios((previous) => [...previous, ...acceptedAudios]);

        const sessionId = ++referenceSessionRef.current;
        const allAccepted = [...acceptedImages, ...acceptedVideos, ...acceptedAudios];
        const patchItem = (item, patch, listSetter) => listSetter((previous) => previous.map((entry) => entry === item ? { ...entry, ...patch } : entry));
        const removeItem = (item, listSetter) => listSetter((previous) => previous.filter((entry) => entry !== item));

        const validateMediaItem = async (item) => {
            if (item.kind === 'image') return { probed: null };
            let probed = { duration: 0, width: 0, height: 0 };
            try {
                probed = await probeMediaDuration(item.file);
            } catch (error) {
                return { error: error.message || '无法读取媒体信息' };
            }
            const range = item.kind === 'video' ? referenceVideoDurationRange : referenceAudioDurationRange;
            const totalMax = item.kind === 'video' ? referenceVideoTotalDurationMax : referenceAudioTotalDurationMax;
            const existingItems = item.kind === 'video' ? multiVideos : multiAudios;
            const existingTotal = existingItems
                .filter((entry) => entry !== item && Number.isFinite(entry.duration))
                .reduce((sum, entry) => sum + entry.duration, 0);
            if (range && (probed.duration < range[0] || probed.duration > range[1])) {
                return { error: `${item.kind === 'video' ? '参考视频' : '参考音频'}单段时长须在 ${range[0]}-${range[1]} 秒之间` };
            }
            if (totalMax && existingTotal + probed.duration > totalMax) {
                return { error: `${item.kind === 'video' ? '参考视频' : '参考音频'}总时长不能超过 ${totalMax} 秒` };
            }
            if (item.kind === 'video' && referenceMediaDimensionRange && probed.width && probed.height) {
                const [minDim, maxDim] = referenceMediaDimensionRange;
                if (probed.width < minDim || probed.width > maxDim || probed.height < minDim || probed.height > maxDim) {
                    return { error: `参考视频宽高须在 ${minDim}-${maxDim} 范围内` };
                }
            }
            return { probed };
        };

        void (async () => {
            setReferencePreparing((count) => count + 1);
            try {
                for (const item of allAccepted) {
                    const { error: validationError, probed } = await validateMediaItem(item);
                    if (referenceSessionRef.current !== sessionId) return;
                    if (validationError) {
                        if (item.kind === 'image') removeItem(item, setMultiImages);
                        else if (item.kind === 'video') removeItem(item, setMultiVideos);
                        else removeItem(item, setMultiAudios);
                        setError(validationError);
                        continue;
                    }
                    patchItem(item, { status: 'checking', duration: probed?.duration }, item.kind === 'image' ? setMultiImages : item.kind === 'video' ? setMultiVideos : setMultiAudios);
                    const asset = await prepareReference(item.file, item.kind);
                    if (referenceSessionRef.current !== sessionId) return;
                    patchItem(item, { asset, status: 'ready' }, item.kind === 'image' ? setMultiImages : item.kind === 'video' ? setMultiVideos : setMultiAudios);
                }
            } catch (nextError) {
                if (referenceSessionRef.current === sessionId) {
                    allAccepted.forEach((item) => {
                        if (item.kind === 'image') removeItem(item, setMultiImages);
                        else if (item.kind === 'video') removeItem(item, setMultiVideos);
                        else removeItem(item, setMultiAudios);
                    });
                    setError(`参考素材准备失败：${nextError?.message || '无法上传云端'}`);
                }
            } finally {
                setReferencePreparing((count) => Math.max(0, count - 1));
            }
        })();
    };

    const clearPreview = (item, setter) => {
        if (item?.preview) URL.revokeObjectURL(item.preview);
        setter(null);
    };

    const generate = async () => {
        const allMultiReferences = [...multiImages, ...multiVideos, ...multiAudios];
        const referenceNotReady = mode === 'firstlast'
            ? (firstFrame && firstFrame.status !== 'ready') || (lastFrame && lastFrame.status !== 'ready')
            : allMultiReferences.some((item) => item.status !== 'ready');
        if (referenceNotReady) {
            setError('参考素材仍在云端验证或上传中，请等待准备完成后再生成');
            return;
        }
        setLoading(true); setError(''); setResults([]); setStage('创建生成任务...');
        try {
            let sourceImages = [];
            let sourceFileInfos = null;
            let lastFrameSourceIndex = -1;
            if (mode === 'firstlast') {
                if (!supportsFirstLastFrame) {
                    setError(`当前 ${modelName} ${modelVersion} 不支持首尾帧模式，请改用参考模式或切换模型`); setLoading(false); setStage(''); return;
                }
                if (!firstFrame && !lastFrame) {
                    setError('请至少上传首帧或尾帧（当前模型支持文生 / 首帧 / 尾帧 / 首尾帧生视频）');
                    setLoading(false); setStage(''); return;
                }
                if (!firstFrame && !supportsLastFrameOnly) {
                    setError('当前模型不支持仅尾帧生视频，请先上传首帧');
                    setLoading(false); setStage(''); return;
                }
                if (firstFrame) {
                    sourceImages.push(firstFrame.asset.mediaUrl);
                    sourceFileInfos = [{ Usage: 'FirstFrame' }];
                }
                if (lastFrame) {
                    sourceImages.push(lastFrame.asset.mediaUrl);
                    if (!sourceFileInfos) sourceFileInfos = [];
                    sourceFileInfos.push(null);
                    lastFrameSourceIndex = sourceImages.length - 1;
                }
            } else {
                if (!supportsMultiReference) {
                    setError(`当前 ${modelName} ${modelVersion} 不支持多模态参考模式，请切换模型`); setLoading(false); setStage(''); return;
                }
                if (!allMultiReferences.length) {
                    setError('请至少上传一个参考素材（音频参考必须搭配图片或视频输入）');
                    setLoading(false); setStage(''); return;
                }
                if (!multiImages.length && !multiVideos.length && multiAudios.length) {
                    setError('不支持仅音频参考：音频必须与图片或视频参考一起输入');
                    setLoading(false); setStage(''); return;
                }
                sourceImages = allMultiReferences.map((item) => item.asset.mediaUrl);
                sourceFileInfos = allMultiReferences.map((item) => ({
                    Usage: 'Reference',
                    Category: item.kind === 'video' ? 'Video' : item.kind === 'audio' ? 'Audio' : 'Image',
                }));
            }
            const durationValue = Number(String(duration).replace(/[^0-9.]/g, ''));
            // Wan 3.0 等模型：有视频输入时，输入视频总时长 + 输出视频时长不超过上限
            if (videoCapability.referenceVideoPlusOutputDurationMax && multiVideos.length) {
                const videoInputTotal = multiVideos.reduce((sum, item) => sum + (Number.isFinite(item.duration) ? item.duration : 0), 0);
                const budgetMax = videoCapability.referenceVideoPlusOutputDurationMax;
                if (videoInputTotal > 0 && videoInputTotal + durationValue > budgetMax) {
                    setError(`参考视频总时长 ${videoInputTotal.toFixed(1)} 秒 + 输出时长 ${durationValue} 秒超过 ${budgetMax} 秒上限，请减少参考视频或缩短输出时长`);
                    setLoading(false); setStage(''); return;
                }
            }
            const pixVersePrompt = modelName === 'PixVerse' && mode === 'multi' && sourceImages.length > 0 && !/@pic\d+/i.test(prompt)
                ? `${prompt.trim()}${prompt.trim() ? '。' : ''}参考图标记：${sourceImages.map((_, index) => `@pic${index + 1}`).join('、')}。请根据提示词使用对应参考图。`
                : prompt.trim() || undefined;
            const { urls } = await runVodAigcPipeline({
                type: 'video',
                modelName,
                modelVersion,
                prompt: pixVersePrompt,
                sourceImages,
                sourceFileInfos,
                lastFrameSourceIndex,
                aspectRatio: ratio === 'Auto' ? undefined : ratio,
                extraConfig: {
                    ...(Number.isFinite(durationValue) ? { Duration: durationValue } : {}),
                    ...(hasResolutionOptions && resolution && resolution !== 'Auto' ? { Resolution: resolution } : {}),
                    StorageMode: storageMode,
                },
            }, {
                ...PIPELINE_CONTEXT,
                history: { source: 'video_tool', parameters: { reference_mode: mode } },
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
                accept={referenceImageAccept}
                className="sr-only"
                onChange={(event) => {
                    handleUploadSingle(event.target.files, onPick);
                    event.target.value = '';
                }}
            />
            {img ? (
                <div className="relative inline-block group">
                    <img src={img.preview} alt="" className="w-28 h-28 object-cover rounded-xl border border-[#ececef]" />
                    {img.status !== 'ready' && <span className="absolute left-1 top-1 rounded-full bg-white/95 px-1.5 py-0.5 text-[10px] text-[#876417] shadow">{t('云端校验中')}</span>}
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
                        <button data-active={mode === 'firstlast'} onClick={() => setMode('firstlast')} disabled={!supportsFirstLastFrame} title={supportsFirstLastFrame ? undefined : t('当前模型不支持首尾帧')}>
                            <span className="inline-flex items-center gap-1.5 justify-center"><Film className="w-4 h-4" />{t('首尾帧模式')}</span>
                        </button>
                        <button data-active={mode === 'multi'} onClick={() => setMode('multi')} disabled={!supportsMultiReference} title={supportsMultiReference ? undefined : t('当前模型不支持多模态参考')}>
                            <span className="inline-flex items-center gap-1.5 justify-center"><Images className="w-4 h-4" />{t('多模态参考')}</span>
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
                                <label className="block text-sm font-medium text-gray-600 mb-2">
                                    {t('参考素材')}
                                    {supportsReferenceImages && ` · ${t('图片')}${t('≤')}${videoCapability.maxReferenceImages}`}
                                    {supportsReferenceVideos && ` · ${t('视频')}${t('≤')}${maxReferenceVideos}${t('段')}`}
                                    {supportsReferenceAudios && ` · ${t('音频')}${t('≤')}${maxReferenceAudios}${t('段')}${t('（须搭配图片或视频）')}`}
                                </label>
                                <div className="flex flex-wrap gap-3">
                                    {multiImages.map((r, i) => (
                                        <div key={`img-${i}`} className="relative group">
                                            <img src={r.preview} alt="" className="w-20 h-20 object-cover rounded-xl border border-[#ececef]" />
                                            {r.status !== 'ready' && <span className="absolute left-1 top-1 rounded-full bg-white/95 px-1.5 py-0.5 text-[10px] text-[#876417] shadow">{t('云端校验中')}</span>}
                                            <button onClick={() => setMultiImages((prev) => {
                                                if (prev[i]?.preview) URL.revokeObjectURL(prev[i].preview);
                                                return prev.filter((_, j) => j !== i);
                                            })}
                                                className="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg transition">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                    {multiVideos.map((r, i) => (
                                        <div key={`video-${i}`} className="relative group">
                                            <div className="w-20 h-20 rounded-xl border border-[#ececef] bg-zinc-100 flex flex-col items-center justify-center gap-1 px-1">
                                                <VideoIcon className="w-5 h-5 text-zinc-500" />
                                                <span className="text-[9px] text-zinc-500 truncate w-full text-center">{r.name}</span>
                                                {Number.isFinite(r.duration) && r.duration > 0 && <span className="text-[9px] text-zinc-400">{r.duration.toFixed(1)}s</span>}
                                            </div>
                                            {r.status !== 'ready' && <span className="absolute left-1 top-1 rounded-full bg-white/95 px-1.5 py-0.5 text-[10px] text-[#876417] shadow">{r.status === 'validating' ? t('校验中') : t('云端校验中')}</span>}
                                            <button onClick={() => setMultiVideos((prev) => prev.filter((_, j) => j !== i))}
                                                className="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg transition">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                    {multiAudios.map((r, i) => (
                                        <div key={`audio-${i}`} className="relative group">
                                            <div className="w-20 h-20 rounded-xl border border-[#ececef] bg-zinc-100 flex flex-col items-center justify-center gap-1 px-1">
                                                <Music className="w-5 h-5 text-zinc-500" />
                                                <span className="text-[9px] text-zinc-500 truncate w-full text-center">{r.name}</span>
                                                {Number.isFinite(r.duration) && r.duration > 0 && <span className="text-[9px] text-zinc-400">{r.duration.toFixed(1)}s</span>}
                                            </div>
                                            {r.status !== 'ready' && <span className="absolute left-1 top-1 rounded-full bg-white/95 px-1.5 py-0.5 text-[10px] text-[#876417] shadow">{r.status === 'validating' ? t('校验中') : t('云端校验中')}</span>}
                                            <button onClick={() => setMultiAudios((prev) => prev.filter((_, j) => j !== i))}
                                                className="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg transition">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                    {(multiImages.length < (supportsReferenceImages ? videoCapability.maxReferenceImages : 0)
                                        || multiVideos.length < maxReferenceVideos
                                        || multiAudios.length < maxReferenceAudios) && (
                                        <>
                                            <input
                                                ref={multiImagesInputRef}
                                                type="file"
                                                accept={referenceMediaAccept}
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
                                                title={t('添加参考素材（图片 / 视频 / 音频）')}
                                                aria-label={t('添加参考素材（图片 / 视频 / 音频）')}
                                            >
                                                <Plus className="w-5 h-5" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 模型/版本/比例/时长/分辨率/存储 */}
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-4 mb-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('模型')}</label>
                            <select value={modelName} onChange={(e) => { const name = e.target.value; const version = (VOD_VIDEO_MODEL_MATRIX[name] || [''])[0]; const capability = getVodVideoModelCapability(name, version); setModelName(name); setModelVersion(version); setRatio((current) => capability.ratios.includes(current) ? current : capability.ratios[0]); setDuration((current) => capability.durations.includes(current) ? current : capability.durations[0]); setResolution((current) => capability.resolutions.includes(current) ? current : (capability.defaultResolution || capability.resolutions[0] || '')); setMultiImages([]); setMultiVideos([]); setMultiAudios([]); }} className="field">
                                {Object.keys(VOD_VIDEO_MODEL_MATRIX).map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('版本')}</label>
                            <select value={modelVersion} onChange={(e) => { const version = e.target.value; const capability = getVodVideoModelCapability(modelName, version); setModelVersion(version); setRatio((current) => capability.ratios.includes(current) ? current : capability.ratios[0]); setDuration((current) => capability.durations.includes(current) ? current : capability.durations[0]); setResolution((current) => capability.resolutions.includes(current) ? current : (capability.defaultResolution || capability.resolutions[0] || '')); setMultiImages((current) => current.slice(0, capability.maxReferenceImages)); setMultiVideos([]); setMultiAudios([]); }} className="field">
                                {versions.map((v) => <option key={v} value={v}>{v}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('比例')}</label>
                            <select value={ratio} onChange={(e) => setRatio(e.target.value)} className="field">
                                {videoCapability.ratios.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('时长')}</label>
                            <select value={duration} onChange={(e) => setDuration(e.target.value)} className="field">
                                {videoCapability.durations.map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        {hasResolutionOptions && (
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-2">{t('分辨率')}</label>
                                <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="field">
                                    {videoCapability.resolutions.map((r) => <option key={r} value={r}>{resolutionLabels?.[r] || r}</option>)}
                                </select>
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium text-gray-600 mb-2">{t('存储模式')}</label>
                            <select value={storageMode} onChange={(e) => setStorageMode(e.target.value)} className="field">
                                <option value="Permanent">{t('永久保存到 VOD')}</option>
                                <option value="Temporary">{t('临时存储（7 天）')}</option>
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

                    <button onClick={generate} disabled={loading || referencePreparing > 0 || (mode === 'firstlast' ? (firstFrame && !firstFrame.asset) || (lastFrame && !lastFrame.asset) : multiImages.some((item) => !item.asset))} className="btn-primary w-full py-3">
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
