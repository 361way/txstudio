import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Clipboard, Download, ExternalLink, Loader2, RotateCcw, Sparkles, UploadCloud, X,
} from 'lucide-react';
import { listCredentials } from '../api/credential';
import { uploadMpsImage, uploadMpsImageFromURL } from '../api/mps';
import { createGenerationTracker } from '../api/generationHistory';
import '../styles/mpsStudio.css';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function validateFile(file) {
    if (!ACCEPTED_TYPES.has(file.type)) throw new Error('仅支持 JPG、PNG、WEBP 图片');
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) throw new Error('图片大小必须在 20MB 以内');
}

function validateURL(value) {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('请输入公开可访问的 HTTP 或 HTTPS 图片 URL');
    }
    return parsed.toString();
}

function formatElapsed(s) {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), r = s % 60;
    return `${m}m${r ? ` ${r}s` : ''}`;
}

// 缩放/平移状态（对齐官方 mg()：每次点击放大 1.5x，上限 8x，拖动平移）。
function useZoomPan() {
    const [state, setState] = useState({ scale: 1, x: 0, y: 0 });
    const panning = useRef(false);
    const lastPoint = useRef({ x: 0, y: 0 });
    const reset = useCallback(() => setState({ scale: 1, x: 0, y: 0 }), []);
    const zoomAt = useCallback((clientX, clientY, rect) => {
        setState((prev) => {
            const scale = Math.min(prev.scale * 1.5, 8);
            const dx = clientX - rect.left - rect.width / 2;
            const dy = clientY - rect.top - rect.height / 2;
            const ratio = 1 - scale / prev.scale;
            return { scale, x: prev.x + dx * ratio, y: prev.y + dy * ratio };
        });
    }, []);
    const panStart = useCallback((x, y) => { panning.current = true; lastPoint.current = { x, y }; }, []);
    const panMove = useCallback((x, y) => {
        if (!panning.current) return false;
        const dx = x - lastPoint.current.x;
        const dy = y - lastPoint.current.y;
        lastPoint.current = { x, y };
        setState((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        return true;
    }, []);
    const panEnd = useCallback(() => { panning.current = false; }, []);
    const isZoomed = state.scale > 1;
    const transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    return { reset, zoomAt, panStart, panMove, panEnd, isZoomed, transform, panning };
}

// 点击缩放的图片容器（对齐官方 Hd）。
function ZoomableImage({ src, alt }) {
    const containerRef = useRef(null);
    const { reset, zoomAt, panStart, panMove, panEnd, isZoomed, transform, panning } = useZoomPan();
    const moved = useRef(false);
    const onPointerDown = (e) => {
        moved.current = false;
        e.target.setPointerCapture?.(e.pointerId);
        if (isZoomed) panStart(e.clientX, e.clientY);
    };
    const onPointerMove = (e) => { if (panMove(e.clientX, e.clientY)) moved.current = true; };
    const onPointerUp = (e) => {
        panEnd();
        if (!moved.current && containerRef.current) zoomAt(e.clientX, e.clientY, containerRef.current.getBoundingClientRect());
    };
    return (
        <div
            ref={containerRef}
            className="mps-zoom-image"
            style={{ cursor: isZoomed ? 'grab' : 'zoom-in' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        >
            <img src={src} alt={alt} draggable={false} style={{ transform, transformOrigin: 'center', transition: panning.current ? 'none' : 'transform .2s ease' }} />
            {isZoomed && (
                <button type="button" className="mps-slider-compare__zoom" onClick={(e) => { e.stopPropagation(); reset(); }} title="恢复原始大小">↺</button>
            )}
        </div>
    );
}

// 拖动对比（对齐官方 tP：分割线随手柄移动，点击缩放、拖动平移）。
function SliderCompare({ before, after, resultLabel }) {
    const [position, setPosition] = useState(50);
    const containerRef = useRef(null);
    const { reset, zoomAt, panStart, panMove, panEnd, isZoomed, transform, panning } = useZoomPan();
    const dragging = useRef(false);
    const moved = useRef(false);
    const downPoint = useRef({ x: 0, y: 0 });
    const DRAG_THRESHOLD = 5;

    const updatePosition = useCallback((clientX) => {
        if (!containerRef.current || dragging.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        setPosition(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
    }, []);

    const onPointerDown = (e) => {
        moved.current = false;
        downPoint.current = { x: e.clientX, y: e.clientY };
        e.target.setPointerCapture?.(e.pointerId);
        dragging.current = true;
        panStart(e.clientX, e.clientY);
    };
    const onPointerMove = (e) => {
        updatePosition(e.clientX);
        const dx = e.clientX - downPoint.current.x;
        const dy = e.clientY - downPoint.current.y;
        if (!moved.current && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) moved.current = true;
        if (moved.current) panMove(e.clientX, e.clientY);
    };
    const onPointerUp = (e) => {
        const wasMoved = moved.current;
        dragging.current = false;
        panEnd();
        if (!wasMoved && containerRef.current) zoomAt(e.clientX, e.clientY, containerRef.current.getBoundingClientRect());
    };

    const imgStyle = { transform, transformOrigin: 'center', transition: panning.current ? 'none' : 'transform .2s ease' };
    return (
        <div style={{ position: 'relative' }}>
            <div
                ref={containerRef}
                className="mps-slider-compare"
                style={{ cursor: isZoomed ? 'grab' : 'zoom-in' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
            >
                <img src={after} alt="处理后" draggable={false} style={imgStyle} />
                <img src={before} alt="原图" draggable={false} style={{ ...imgStyle, clipPath: `inset(0 ${100 - position}% 0 0)` }} />
                <div className="mps-slider-compare__divider" style={{ left: `${position}%` }} />
                <div className="mps-slider-compare__handle" style={{ left: `${position}%` }}>◀▶</div>
                <span className="mps-slider-compare__label mps-slider-compare__label--before">原图</span>
                <span className="mps-slider-compare__label mps-slider-compare__label--after">{resultLabel}</span>
                {isZoomed && (
                    <button type="button" className="mps-slider-compare__zoom" onClick={(e) => { e.stopPropagation(); reset(); }} title="恢复原始大小">↺</button>
                )}
            </div>
        </div>
    );
}

// 左右对比（对齐官方 vU：原始/处理后两张卡片同步缩放，可点击放大、拖动平移）。
function SideBySide({ before, after, resultLabel }) {
    const containerRef = useRef(null);
    const { reset, zoomAt, panStart, panMove, panEnd, isZoomed, transform, panning } = useZoomPan();
    const moved = useRef(false);
    const onPointerDown = (e) => {
        moved.current = false;
        e.target.setPointerCapture?.(e.pointerId);
        if (isZoomed) panStart(e.clientX, e.clientY);
    };
    const onPointerMove = (e) => { if (panMove(e.clientX, e.clientY)) moved.current = true; };
    const onPointerUp = (e) => {
        panEnd();
        if (!moved.current && containerRef.current) zoomAt(e.clientX, e.clientY, containerRef.current.getBoundingClientRect());
    };
    const imgStyle = { transform, transformOrigin: 'center', transition: panning.current ? 'none' : 'transform .2s ease' };
    return (
        <div style={{ position: 'relative' }}>
            <div ref={containerRef} className="mps-side-by-side" style={{ cursor: isZoomed ? 'grab' : 'zoom-in' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
                <div className="mps-side-by-side__card">
                    <div className="mps-side-by-side__title">原始</div>
                    <div className="mps-side-by-side__body"><img src={before} alt="原图" draggable={false} style={imgStyle} /></div>
                </div>
                <div className="mps-side-by-side__card">
                    <div className="mps-side-by-side__title mps-side-by-side__title--primary">{resultLabel}</div>
                    <div className="mps-side-by-side__body"><img src={after} alt="处理后" draggable={false} style={imgStyle} /></div>
                </div>
            </div>
            {isZoomed && (
                <button type="button" className="mps-slider-compare__zoom" style={{ position: 'absolute', top: 8, right: 8 }} onClick={(e) => { e.stopPropagation(); reset(); }} title="恢复原始大小">↺</button>
            )}
        </div>
    );
}

/**
 * MPS 原子能力工作台（MPS Image Studio 风格，对齐官方截图）。
 * 左侧输入区 + 右侧参数面板；提交后切换到结果页。
 */
export { SliderCompare, SideBySide, ZoomableImage };

export default function MpsImageTaskTool({ tool, onBack }) {
    const inputRef = useRef(null);
    const extraInputRef = useRef(null);
    const [inputMode, setInputMode] = useState('upload');
    const [source, setSource] = useState(null);
    const [extraSources, setExtraSources] = useState([]);
    const [urlValue, setUrlValue] = useState('');
    const [dragging, setDragging] = useState(false);
    const [storage, setStorage] = useState({ bucket: '', region: 'ap-guangzhou', configured: false });
    const [loading, setLoading] = useState(false);
    const [stage, setStage] = useState('');
    const [error, setError] = useState('');
    const [taskId, setTaskId] = useState('');
    const [results, setResults] = useState([]);
    const [textResult, setTextResult] = useState('');
    const [showDryRun, setShowDryRun] = useState(false);
    const [phase, setPhase] = useState('config');
    const [taskStatus, setTaskStatus] = useState('idle');
    const [elapsed, setElapsed] = useState(0);
    const [resultMode, setResultMode] = useState('result');
    const [fieldValues, setFieldValues] = useState(() =>
        Object.fromEntries((tool.fields || []).map((field) => [field.key, field.defaultValue ?? '']))
    );

    useEffect(() => () => {
        if (source?.kind === 'file' && source.preview) URL.revokeObjectURL(source.preview);
        extraSources.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    }, [source, extraSources]);

    useEffect(() => {
        if (phase !== 'result' || !['submitting', 'waiting', 'processing'].includes(taskStatus)) return undefined;
        setElapsed(0);
        const timer = setInterval(() => setElapsed((v) => v + 1), 1000);
        return () => clearInterval(timer);
    }, [phase, taskStatus]);

    useEffect(() => {
        listCredentials().then((items) => {
            const credential = items.find((item) => item.provider === 'tencent-cloud' && item.has_data);
            setStorage({
                bucket: credential?.config?.mps_bucket || '',
                region: credential?.config?.mps_region || credential?.config?.region || 'ap-guangzhou',
                configured: Boolean(credential),
            });
        }).catch(() => {});
    }, []);

    const dryRunPayload = useMemo(() => tool.createPayload({
        input: {
            bucket: storage.bucket || '<MPS 输出 COS Bucket>',
            region: storage.region,
            object: source ? (source.kind === 'url' ? '<URL 转存后>' : '<本地上传后>') : '<待上传>',
        },
        extraImages: extraSources.map(() => ({ bucket: storage.bucket || '<COS>', region: storage.region, object: '<附加图>' })),
        outputBucket: storage.bucket || '<MPS 输出 COS Bucket>',
        outputRegion: storage.region,
        ...fieldValues,
    }), [source, extraSources, storage, tool, fieldValues]);

    const setFileSource = (file) => {
        try {
            validateFile(file);
            if (source?.kind === 'file' && source.preview) URL.revokeObjectURL(source.preview);
            setSource({ kind: 'file', file, preview: URL.createObjectURL(file), name: file.name });
            setError(''); setResults([]); setTaskId(''); setTextResult('');
        } catch (e) { setError(e.message || '图片无效'); }
    };

    const setURLSource = () => {
        try {
            const url = validateURL(urlValue.trim());
            if (source?.kind === 'file' && source.preview) URL.revokeObjectURL(source.preview);
            setSource({ kind: 'url', url, preview: url, name: url });
            setUrlValue(''); setError(''); setResults([]); setTaskId(''); setTextResult('');
        } catch (e) { setError(e.message || '图片 URL 无效'); }
    };

    const addExtraSource = (file) => {
        try {
            validateFile(file);
            const preview = URL.createObjectURL(file);
            setExtraSources((prev) => [...prev, { kind: 'file', file, preview, name: file.name }]);
        } catch (e) { setError(e.message || '图片无效'); }
    };

    const removeExtraSource = (index) => {
        setExtraSources((prev) => {
            const r = prev[index];
            if (r?.preview) URL.revokeObjectURL(r.preview);
            return prev.filter((_, i) => i !== index);
        });
    };

    const reset = () => {
        if (source?.kind === 'file' && source.preview) URL.revokeObjectURL(source.preview);
        extraSources.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
        setSource(null); setExtraSources([]); setResults([]); setTaskId(''); setError(''); setStage(''); setUrlValue(''); setTextResult('');
        setPhase('config'); setTaskStatus('idle'); setResultMode('result');
    };

    const backToConfig = () => { setPhase('config'); setTaskStatus('idle'); setError(''); };

    const downloadAll = () => {
        results.forEach((url, index) => {
            const link = document.createElement('a');
            link.href = url; link.download = `${tool.id}-${index + 1}.png`; link.target = '_blank'; link.rel = 'noreferrer';
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
        });
    };

    const submit = async () => {
        setError(''); setResults([]); setTaskId(''); setTextResult('');
        if (!source) { setError('请先上传图片或输入图片 URL'); return; }
        if (!storage.configured) { setError('请先在右上角 API 设置中配置腾讯云媒体服务凭证'); return; }
        if (!storage.bucket) { setError('请先在 API 设置中填写 MPS 输出 COS Bucket'); return; }
        const missingField = (tool.fields || []).find((f) => f.required && !String(fieldValues[f.key] || '').trim());
        if (missingField) { setError(`请填写：${missingField.label}`); return; }
        // 动态校验钩子：如背景融合「未上传背景图时背景描述必填」。
        if (typeof tool.validate === 'function') {
            const message = tool.validate(fieldValues, extraSources);
            if (message) { setError(message); return; }
        }

        setLoading(true);
        setTaskStatus('submitting'); setStage(tool.submittingText); setPhase('result');
        const tracker = await createGenerationTracker({
            source: 'mps_tool', type: 'mps', provider: 'tencent-mps', prompt: '',
            modelName: tool.title, modelVersion: tool.id, storageMode: 'Permanent',
            parameters: { bucket: storage.bucket, region: storage.region, input_mode: source.kind },
            assets: [{ role: 'reference', ordinal: 0, media_type: 'image', mime_type: source.file?.type || '', file_size: source.file?.size || 0, metadata: { name: source.name || '', direct_url: source.kind === 'url' } }],
        });
        try {
            setStage(source.kind === 'file' ? '正在上传图片到 COS…' : '正在安全转存 URL 图片到 COS…');
            await tracker?.stage('upload_start', { progress: 8, message: '正在上传输入图片' });
            const input = source.kind === 'file' ? await uploadMpsImage(source.file) : await uploadMpsImageFromURL(source.url);
            let extraImages = [];
            if (extraSources.length) {
                setStage('正在上传附加参考图到 COS…');
                extraImages = await Promise.all(extraSources.map((item) => uploadMpsImage(item.file)));
            }
            await tracker?.stage('upload_done', { progress: 25, message: '输入图片已保存到 COS' });
            setStage(tool.submittingText);
            const created = await tool.createTask({ input, extraImages, outputBucket: storage.bucket, outputRegion: storage.region, ...fieldValues });
            setTaskId(created.taskId); setTaskStatus('processing');
            await tracker?.stage('task_created', { progress: 40, message: tool.submittingText, taskId: created.taskId });
            setStage(tool.processingText);
            const completed = await tool.pollTask(created.taskId, storage.region, {
                onPoll: ({ attempt, status }) => {
                    setTaskStatus(String(status || '').toUpperCase().includes('WAIT') ? 'waiting' : 'processing');
                    setStage(`${tool.processingText} · 第 ${attempt} 次查询`);
                    tracker?.stage('polling', { progress: 60, status, message: tool.processingText });
                },
            });
            setResults(completed.urls || []);
            if (tool.isTextResult) setTextResult(completed.text || '');
            setTaskStatus('finish');
            await tracker?.complete({ urls: completed.urls || [], mediaType: 'image' });
        } catch (e) {
            setTaskStatus('fail'); setError(e?.message || `${tool.title}任务失败`); setStage('');
            await tracker?.fail(e);
        } finally { setLoading(false); }
    };

    const statusTitle = { submitting: '任务提交中', waiting: '排队中', processing: '任务处理中', finish: '任务完成', fail: '任务失败' }[taskStatus] || '处理结果';
    const statusChip = taskStatus === 'finish' ? <span className="mps-status-chip mps-status-chip--ok">✓ 已完成</span>
        : taskStatus === 'fail' ? <span className="mps-status-chip" style={{ background: 'rgba(239,68,68,.15)', color: 'var(--mps-color-error)' }}>✕ 失败</span>
        : <span className="mps-status-chip mps-status-chip--pending"><Loader2 size={11} className="animate-spin" />{taskStatus === 'waiting' ? '等待中' : '处理中'}</span>;
    const supportsComparison = Boolean(tool.comparison && source?.preview && results[0]);
    const activeResultMode = supportsComparison ? resultMode : 'result';
    return (
        <div className="mps-studio">
            {phase === 'config' ? (
                <div className="mps-page">
                    <header className="mps-page__header">
                        {onBack && (
                            <button type="button" className="mps-page__back" onClick={onBack}>
                                <span aria-hidden="true">←</span> 返回
                            </button>
                        )}
                        <h1 className="mps-page__title">
                            {tool.emoji && <span className="mps-page__title-emoji">{tool.emoji}</span>}
                            {tool.title}
                        </h1>
                        {tool.badge && <span className="mps-page__badge">{tool.badge}</span>}
                    </header>

                    <div className="mps-page__body">
                        <div>
                            <section className="mps-section">
                                <h2 className="mps-section__title">{tool.inputSectionTitle || '图片输入'}</h2>
                                <p className="mps-section__sub">{tool.inputDescription}</p>
                                <div className="mps-input-method">
                                    <button type="button" onClick={() => setInputMode('upload')} className={`mps-input-method__option ${inputMode === 'upload' ? 'mps-input-method__option--active' : ''}`}>本地上传</button>
                                    <button type="button" onClick={() => setInputMode('url')} className={`mps-input-method__option ${inputMode === 'url' ? 'mps-input-method__option--active' : ''}`}>URL 输入</button>
                                </div>

                                {source && (
                                    <div className="mps-image-preview">
                                        <img src={source.preview} alt={tool.title} className="mps-image-preview__img" />
                                        <button type="button" onClick={reset} className="mps-image-preview__remove" title="移除图片"><X size={13} /></button>
                                        <div className="mps-image-preview__info">{source.kind === 'file' ? source.name : source.url}</div>
                                    </div>
                                )}

                                {!source && inputMode === 'upload' && (
                                    <div
                                        role="button" tabIndex={0}
                                        onClick={() => inputRef.current?.click()}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
                                        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                                        onDragLeave={() => setDragging(false)}
                                        onDrop={(e) => { e.preventDefault(); setDragging(false); setFileSource(e.dataTransfer.files?.[0]); }}
                                        className={`mps-upload-zone ${dragging ? 'mps-upload-zone--dragging' : ''}`}
                                    >
                                        <input ref={inputRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { setFileSource(e.target.files?.[0]); e.target.value = ''; }} />
                                        <div className="mps-upload-zone__icon"><UploadCloud size={32} strokeWidth={1.5} /></div>
                                        <div className="mps-upload-zone__text">点击或拖拽文件到此处上传</div>
                                        <div className="mps-upload-zone__hint">支持 JPG / PNG / WEBP · 最大 20MB</div>
                                    </div>
                                )}

                                {!source && inputMode === 'url' && (
                                    <div>
                                        <label className="mps-param-field__hint" style={{ display: 'block', marginBottom: 6 }}>公开可访问的图片 URL</label>
                                        <div className="mps-url-row">
                                            <input value={urlValue} onChange={(e) => setUrlValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setURLSource(); }} placeholder="https://example.com/photo.png" className="mps-url-input" />
                                            <button type="button" onClick={setURLSource} disabled={!urlValue.trim()} className="mps-btn mps-btn-secondary">添加</button>
                                        </div>
                                    </div>
                                )}
                            </section>

                            {tool.maxExtraImages > 0 && (
                                <section className="mps-section">
                                    <h2 className="mps-section__title">{tool.extraImagesLabel || '附加参考图（可选）'}</h2>
                                    <p className="mps-section__sub">{tool.extraImagesHint || `最多 ${tool.maxExtraImages} 张`}</p>
                                    <div className="mps-input-method">
                                        <button type="button" onClick={() => extraInputRef.current?.click()} disabled={extraSources.length >= tool.maxExtraImages} className="mps-input-method__option">本地上传</button>
                                    </div>
                                    <input ref={extraInputRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { if (e.target.files?.[0]) addExtraSource(e.target.files[0]); e.target.value = ''; }} />
                                    <button type="button" onClick={() => extraInputRef.current?.click()} disabled={extraSources.length >= tool.maxExtraImages} className="mps-upload-zone__add" style={{ marginTop: 12 }}>+ 添加第 {extraSources.length + 1} 张附加图</button>
                                    {extraSources.length > 0 && (
                                        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                                            {extraSources.map((item, index) => (
                                                <div key={`${item.name}-${index}`} style={{ position: 'relative', borderRadius: 'var(--mps-rounded-md)', border: '1px solid var(--mps-color-hairline)', overflow: 'hidden', aspectRatio: '1' }}>
                                                    <img src={item.preview} alt={`附加图 ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'var(--mps-color-surface-soft)' }} />
                                                    <button type="button" onClick={() => removeExtraSource(index)} className="mps-image-preview__remove"><X size={11} /></button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            )}
                        </div>

                        <section className="mps-section">
                            <h2 className="mps-section__title">参数配置</h2>
                            <p className="mps-section__sub">{tool.parameterLabel}</p>
                            <div className="mps-param-form">
                                {(tool.fields || []).map((field) => {
                                    if (field.type === 'slider') {
                                        const value = Number(fieldValues[field.key] ?? field.min ?? 0);
                                        return (
                                            <div key={field.key} className="mps-param-field">
                                                <div className="mps-slider">
                                                    <span className="mps-slider__label">{field.label}</span>
                                                    <input
                                                        type="range"
                                                        min={field.min ?? 0}
                                                        max={field.max ?? 100}
                                                        step={field.step ?? 1}
                                                        value={value}
                                                        onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.key]: Number(e.target.value) }))}
                                                        className="mps-slider__range"
                                                    />
                                                    <span className="mps-slider__value">{value}</span>
                                                </div>
                                                {field.hint && <span className="mps-slider__hint">{field.hint}</span>}
                                            </div>
                                        );
                                    }
                                    if (field.type === 'effects') {
                                        // 效果列表编辑器：{type, value} 数组，value 可为 0-100（美颜/滤镜）或枚举（增强）。
                                        const items = Array.isArray(fieldValues[field.key]) ? fieldValues[field.key] : (field.defaultValue || []);
                                        const setItems = (next) => setFieldValues((prev) => ({ ...prev, [field.key]: next }));
                                        const typeLabel = (t) => (field.typeOptions || []).find((opt) => opt.value === t)?.label || t;
                                        return (
                                            <div key={field.key} className="mps-param-field">
                                                <div className="mps-slider" style={{ marginBottom: 6 }}>
                                                    <span className="mps-slider__label">{field.label}（{items.length} 项）</span>
                                                </div>
                                                {items.map((item, index) => (
                                                    <div key={`${item.type}-${index}`} style={{ marginBottom: 10 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--mps-color-body-strong)' }}>{typeLabel(item.type)}</span>
                                                            <button type="button" onClick={() => setItems(items.filter((_, i) => i !== index))} style={{ background: 'none', border: 'none', color: 'var(--mps-color-muted)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }} title="移除">×</button>
                                                        </div>
                                                        {item.valueType === 'enum' ? (
                                                            <select value={item.value} onChange={(e) => setItems(items.map((it, i) => i === index ? { ...it, value: e.target.value } : it))} className="mps-param-field__select">
                                                                {(field.valueOptions || []).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                                            </select>
                                                        ) : item.valueType === 'switch' ? (
                                                            <select value={String(item.value)} onChange={(e) => setItems(items.map((it, i) => i === index ? { ...it, value: e.target.value === 'true' } : it))} className="mps-param-field__select">
                                                                <option value="true">开启</option>
                                                                <option value="false">关闭</option>
                                                            </select>
                                                        ) : (
                                                            <div className="mps-slider">
                                                                <input type="range" min={0} max={100} step={1} value={item.value} onChange={(e) => setItems(items.map((it, i) => i === index ? { ...it, value: Number(e.target.value) } : it))} className="mps-slider__range" />
                                                                <span className="mps-slider__value">{item.value}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                                <select value="" onChange={(e) => {
                                                    const t = e.target.value;
                                                    if (!t) return;
                                                    const meta = (field.typeOptions || []).find((opt) => opt.value === t) || {};
                                                    setItems([...items, { type: t, value: meta.defaultValue ?? 50, valueType: meta.valueType || 'number' }]);
                                                    e.target.value = '';
                                                }} className="mps-param-field__select">
                                                    <option value="">+ 添加效果…</option>
                                                    {(field.typeOptions || []).filter((opt) => !items.some((it) => it.type === opt.value)).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                                </select>
                                                {field.hint && <span className="mps-param-field__hint">{field.hint}</span>}
                                            </div>
                                        );
                                    }
                                    if (field.type === 'select') {
                                        return (
                                            <label key={field.key} className="mps-param-field">
                                                <span className="mps-param-field__label">{field.label}</span>
                                                <select value={fieldValues[field.key] ?? ''} onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))} className="mps-param-field__select">
                                                    {(field.options || []).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                                </select>
                                            </label>
                                        );
                                    }
                                    return (
                                        <label key={field.key} className="mps-param-field">
                                            <span className="mps-param-field__label">{field.label}{field.required ? ' *' : ''}</span>
                                            <input type="text" value={fieldValues[field.key] || ''} onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))} placeholder={field.placeholder || ''} maxLength={field.maxLength || undefined} className="mps-param-field__input" />
                                            {field.hint && <span className="mps-param-field__hint">{field.hint}</span>}
                                        </label>
                                    );
                                })}

                                {(tool.fields || []).length === 0 && (
                                    <div style={{ fontSize: 12, color: 'var(--mps-color-muted)', lineHeight: 1.5 }}>{tool.parameterDescription || '此能力无需额外参数'}</div>
                                )}

                                {error && <div className="mps-error-box">{error}</div>}
                                {stage && !error && <div className="mps-stage-box">{loading ? <Loader2 size={13} className="animate-spin" /> : <span style={{ color: 'var(--mps-color-success)' }}>✓</span>}{stage}</div>}

                                <button type="button" onClick={submit} disabled={loading} className="mps-btn mps-btn-primary mps-btn--block">
                                    {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                                    {loading ? '提交中…' : '提交任务'}
                                </button>
                                <button type="button" onClick={() => setShowDryRun((v) => !v)} className="mps-btn mps-btn-secondary mps-btn--block">Dry Run（预览请求体）</button>
                                {showDryRun && (
                                    <div className="mps-dry-run">
                                        <pre className="mps-dry-run__code">{JSON.stringify(dryRunPayload, null, 2)}</pre>
                                        <button type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(dryRunPayload, null, 2))} className="mps-dry-run__copy" title="复制"><Clipboard size={12} /></button>
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>
                </div>
            ) : (
                <div className="mps-result">
                    <div className="mps-result__header">
                        <div>
                            <button type="button" className="mps-page__back" onClick={backToConfig} style={{ marginBottom: 8 }}>
                                <span aria-hidden="true">←</span> 返回配置
                            </button>
                            <h2 className="mps-result__title">{statusTitle}</h2>
                            {taskId && <p className="mps-result__meta">TaskId: {taskId}</p>}
                        </div>
                        <div className="mps-result__actions">
                            {statusChip}
                            {taskStatus === 'finish' && results.length > 1 && (
                                <button type="button" onClick={downloadAll} className="mps-btn mps-btn-secondary" style={{ height: 32, fontSize: 12 }}><Download size={12} />下载全部</button>
                            )}
                            {['finish', 'fail'].includes(taskStatus) && (
                                <button type="button" onClick={submit} className="mps-btn mps-btn-secondary" style={{ height: 32, fontSize: 12 }}><RotateCcw size={12} />重新运行</button>
                            )}
                        </div>
                    </div>

                    {['submitting', 'waiting', 'processing'].includes(taskStatus) && (
                        <section className="mps-section">
                            <div className="mps-loading-state">
                                <Loader2 size={28} className="animate-spin" style={{ color: 'var(--mps-color-primary)' }} />
                                <div className="mps-loading-state__text">{stage || tool.processingText}</div>
                                <div className="mps-loading-state__sub">正在轮询结果，预计 {tool.badge && tool.badge.startsWith('~') ? tool.badge : '片刻'} · 已等待 {formatElapsed(elapsed)}</div>
                                <div className="mps-progress-bar"><div className="mps-progress-bar__fill" style={{ width: `${Math.min(95, 8 + elapsed * 2)}%` }} /></div>
                            </div>
                        </section>
                    )}

                    {taskStatus === 'fail' && (
                        <section className="mps-section">
                            <div className="mps-error-box" style={{ fontSize: 14 }}>错误信息：{error || `${tool.title}任务失败`}</div>
                        </section>
                    )}

                    {taskStatus === 'finish' && tool.isTextResult && (
                        <div className="mps-text-result">
                            {source?.preview && (
                                <div className="mps-image-preview" style={{ marginTop: 0 }}>
                                    <img src={source.preview} alt="原图" className="mps-image-preview__img" />
                                </div>
                            )}
                            <div className="mps-text-result__content">
                                <div className="mps-text-result__label">{tool.textResultLabel || '结果'}</div>
                                {tool.longTextResult ? (
                                    <div className="mps-text-result__text" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 14, fontWeight: 400 }}>{textResult || '（无返回内容）'}</div>
                                ) : (
                                    <div className="mps-text-result__text" style={{ fontFamily: 'var(--mps-font-mono)', fontSize: 20, fontWeight: 600 }}>{textResult || tool.emptyTextResult || '（空）'}</div>
                                )}
                            </div>
                        </div>
                    )}

                    {taskStatus === 'finish' && results.length > 0 && !tool.isTextResult && (
                        <>
                            {supportsComparison && (
                                <div className="mps-mode-switch" role="tablist" aria-label="结果查看模式" style={{ marginBottom: 12 }}>
                                    <button type="button" role="tab" aria-selected={activeResultMode === 'result'} onClick={() => setResultMode('result')} className={`mps-mode-switch__btn ${activeResultMode === 'result' ? 'mps-mode-switch__btn--active' : ''}`}>仅结果</button>
                                    <button type="button" role="tab" aria-selected={activeResultMode === 'slider'} onClick={() => setResultMode('slider')} className={`mps-mode-switch__btn ${activeResultMode === 'slider' ? 'mps-mode-switch__btn--active' : ''}`}>拖动对比</button>
                                    <button type="button" role="tab" aria-selected={activeResultMode === 'side'} onClick={() => setResultMode('side')} className={`mps-mode-switch__btn ${activeResultMode === 'side' ? 'mps-mode-switch__btn--active' : ''}`}>左右对比</button>
                                </div>
                            )}

                            {activeResultMode === 'slider' ? (
                                <SliderCompare before={source.preview} after={results[0]} resultLabel={tool.resultTitle || '处理后'} />
                            ) : activeResultMode === 'side' ? (
                                <SideBySide before={source.preview} after={results[0]} resultLabel={tool.resultTitle || '处理后'} />
                            ) : (
                                <div className="mps-result-grid">
                                    {results.map((url, index) => (
                                        <article key={`${url}-${index}`} className="mps-result-card">
                                            <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${tool.resultTitle} ${index + 1}`} className="mps-result-card__img" /></a>
                                            <div className="mps-result-card__bar">
                                                <span>结果 {index + 1}</span>
                                                <a href={url} target="_blank" rel="noreferrer" className="mps-result-card__action"><ExternalLink size={12} /></a>
                                                <a href={url} download={`${tool.id}-${index + 1}.png`} className="mps-result-card__action"><Download size={12} /></a>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}