import React, { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Loader2, Plus, UploadCloud, X } from 'lucide-react';
import { listCredentials } from '../api/credential';
import { uploadMpsImage, uploadMpsImageFromURL, createMultiviewSuiteTask, pollImageTask } from '../api/mps';
import { createGenerationTracker } from '../api/generationHistory';
import '../styles/mpsStudio.css';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const DEFAULT_ANGLES = [
    { label: '左侧 45° 视角', horizontal: -45, vertical: 0, zoom: 'medium' },
    { label: '右侧 45° 视角', horizontal: 45, vertical: 0, zoom: 'medium' },
    { label: '正面俯视 30° 视角', horizontal: 0, vertical: 30, zoom: 'medium' },
    { label: '左侧 45° + 俯视 30° 视角', horizontal: -45, vertical: 30, zoom: 'medium' },
];

const ZOOM_OPTIONS = [
    { value: 'ultra-wide', label: '超远景' },
    { value: 'wide', label: '远景' },
    { value: 'medium', label: '中景' },
    { value: 'close', label: '近景' },
    { value: 'macro', label: '特写' },
];

const RATIO_VALUES = [
    { value: '1:1', ratio: 1 },
    { value: '3:4', ratio: 3 / 4 },
    { value: '4:3', ratio: 4 / 3 },
    { value: '9:16', ratio: 9 / 16 },
    { value: '16:9', ratio: 16 / 9 },
];

// 根据图片宽高自动匹配最近的画面比例（官方 ratioAutoDetected 行为）。
function detectRatio(width, height) {
    if (!width || !height) return null;
    const target = width / height;
    return RATIO_VALUES.reduce((best, item) => (
        Math.abs(item.ratio - target) < Math.abs(best.ratio - target) ? item : best
    ), RATIO_VALUES[0]).value;
}

const STEPS = [
    { id: 1, title: '素材准备', desc: '上传商品参考图' },
    { id: 2, title: '生成配置', desc: '视角 / 比例 / 清晰度' },
    { id: 3, title: 'AI 生成', desc: '一键生成多视角图' },
];

function validateFile(file) {
    if (!ACCEPTED_TYPES.has(file.type)) throw new Error('仅支持 JPG、PNG、WEBP 图片');
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) throw new Error('图片大小必须在 20MB 以内');
}
function validateURL(value) {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('请输入公开可访问的 HTTP 或 HTTPS 图片 URL');
    return parsed.toString();
}
function formatElapsed(s) {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), r = s % 60;
    return `${m}m${r ? ` ${r}s` : ''}`;
}

/**
 * 电商产品多视角（对齐官方 /workflow?solution=multiview-suite 的 3 步向导）：
 * 1 素材准备 → 2 生成配置（视角覆盖/比例/清晰度/模型） → 3 AI 生成。
 */
export default function MultiviewSuiteTool({ onBack }) {
    const [step, setStep] = useState(1);
    // Step 1 素材
    const [mainSource, setMainSource] = useState(null);
    const [extraSources, setExtraSources] = useState([]);
    const [inputMode, setInputMode] = useState('upload');
    const [urlValue, setUrlValue] = useState('');
    const [dragging, setDragging] = useState(false);
    const mainInputRef = useRef(null);
    const extraInputRef = useRef(null);
    // Step 2 配置
    const [overrides, setOverrides] = useState(DEFAULT_ANGLES.map((a) => ({ enabled: false, horizontal: a.horizontal, vertical: a.vertical, zoom: a.zoom })));
    const [definition, setDefinition] = useState(20194);
    const [panelRatio, setPanelRatio] = useState('1:1');
    const [ratioSource, setRatioSource] = useState('manual'); // 'auto' | 'manual'
    const [panelResolution, setPanelResolution] = useState('1K');
    const [model, setModel] = useState('flash');
    // Step 3 生成
    const [storage, setStorage] = useState({ bucket: '', region: 'ap-guangzhou', configured: false });
    const [loading, setLoading] = useState(false);
    const [stage, setStage] = useState('');
    const [error, setError] = useState('');
    const [taskId, setTaskId] = useState('');
    const [results, setResults] = useState([]);
    const [elapsed, setElapsed] = useState(0);

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

    useEffect(() => {
        if (!loading) return undefined;
        setElapsed(0);
        const timer = setInterval(() => setElapsed((v) => v + 1), 1000);
        return () => clearInterval(timer);
    }, [loading]);

    useEffect(() => () => {
        if (mainSource?.kind === 'file' && mainSource.preview) URL.revokeObjectURL(mainSource.preview);
        extraSources.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    }, [mainSource, extraSources]);

    // 上传主图后自动检测画面比例并匹配（对齐官方 ratioAutoDetected）。
    const applyMainSource = (next) => {
        setMainSource(next);
        if (next?.preview) {
            const img = new Image();
            img.onload = () => {
                const detected = detectRatio(img.naturalWidth, img.naturalHeight);
                if (detected) {
                    setPanelRatio(detected);
                    setRatioSource('auto');
                }
            };
            img.src = next.preview;
        }
    };

    const setMainFile = (file) => {
        try {
            validateFile(file);
            if (mainSource?.kind === 'file' && mainSource.preview) URL.revokeObjectURL(mainSource.preview);
            applyMainSource({ kind: 'file', file, preview: URL.createObjectURL(file), name: file.name });
            setError(''); setResults([]); setTaskId('');
        } catch (e) { setError(e.message || '图片无效'); }
    };

    const setMainURL = () => {
        try {
            const url = validateURL(urlValue.trim());
            applyMainSource({ kind: 'url', url, preview: url, name: url });
            setUrlValue(''); setError(''); setResults([]); setTaskId('');
        } catch (e) { setError(e.message || '图片 URL 无效'); }
    };

    const addExtra = (file) => {
        try {
            validateFile(file);
            setExtraSources((prev) => [...prev, { kind: 'file', file, preview: URL.createObjectURL(file), name: file.name }]);
            setError('');
        } catch (e) { setError(e.message || '图片无效'); }
    };

    const removeExtra = (index) => {
        setExtraSources((prev) => {
            const r = prev[index];
            if (r?.preview) URL.revokeObjectURL(r.preview);
            return prev.filter((_, i) => i !== index);
        });
    };

    const clearWorkspace = () => {
        if (mainSource?.kind === 'file' && mainSource.preview) URL.revokeObjectURL(mainSource.preview);
        extraSources.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
        setMainSource(null); setExtraSources([]); setResults([]); setTaskId(''); setError(''); setStage('');
        setStep(1);
        setOverrides(DEFAULT_ANGLES.map((a) => ({ enabled: false, horizontal: a.horizontal, vertical: a.vertical, zoom: a.zoom })));
        setDefinition(20194); setPanelRatio('1:1'); setRatioSource('manual'); setPanelResolution('1K'); setModel('flash');
    };

    const resetConfig = () => {
        setOverrides(DEFAULT_ANGLES.map((a) => ({ enabled: false, horizontal: a.horizontal, vertical: a.vertical, zoom: a.zoom })));
        setDefinition(20194); setPanelRatio('1:1'); setRatioSource('manual'); setPanelResolution('1K'); setModel('flash');
    };

    const overriddenCount = overrides.filter((o) => o.enabled).length;

    const viewPrompts = overrides.map((o) => {
        if (!o.enabled) return '';
        const zoomLabel = ZOOM_OPTIONS.find((z) => z.value === o.zoom)?.label || '中景';
        return `镜头相对物体：水平 ${o.horizontal}° · 垂直 ${o.vertical}° · ${zoomLabel}`;
    });

    const generate = async () => {
        setError(''); setResults([]); setTaskId('');
        if (!mainSource) { setError('请先上传商品主图'); return; }
        if (!storage.configured) { setError('请先在右上角 API 设置中配置腾讯云媒体服务凭证'); return; }
        if (!storage.bucket) { setError('请先在 API 设置中填写 MPS 输出 COS Bucket'); return; }

        setLoading(true);
        const tracker = await createGenerationTracker({
            source: 'mps_tool', type: 'mps', provider: 'tencent-mps', prompt: '',
            modelName: '电商产品多视角', modelVersion: 'multiview-suite', storageMode: 'Permanent',
            parameters: { definition: 20194, panelRatio, panelResolution, model, overridden: overriddenCount },
            assets: [mainSource, ...extraSources].map((item, index) => ({ role: index === 0 ? 'reference' : 'extra_reference', ordinal: index, media_type: 'image', mime_type: item.file?.type || '', file_size: item.file?.size || 0, metadata: { name: item.name || '', direct_url: item.kind === 'url' } })),
        });
        try {
            setStage('正在上传商品图到 COS…');
            await tracker?.stage('upload_start', { progress: 8, message: '正在上传商品图' });
            const input = mainSource.kind === 'file' ? await uploadMpsImage(mainSource.file) : await uploadMpsImageFromURL(mainSource.url);
            let extraImages = [];
            if (extraSources.length) {
                setStage('正在上传附加参考图到 COS…');
                extraImages = await Promise.all(extraSources.map((item) => uploadMpsImage(item.file)));
            }
            await tracker?.stage('upload_done', { progress: 25, message: '素材上传完成' });
            setStage('正在提交多视角生成任务…');
            const created = await createMultiviewSuiteTask({ input, extraImages, viewPrompts, definition, panelRatio, panelResolution, model, outputBucket: storage.bucket, outputRegion: storage.region });
            setTaskId(created.taskId);
            await tracker?.stage('task_created', { progress: 40, message: '任务已创建', taskId: created.taskId });
            setStage('AI 正在生成多视角图…');
            const completed = await pollImageTask(created.taskId, storage.region, {
                onPoll: ({ attempt }) => {
                    setStage(`AI 正在生成多视角图 · 第 ${attempt} 次查询`);
                    tracker?.stage('polling', { progress: 60, message: '多视角生成中' });
                },
            });
            setResults(completed.urls || []);
            setStage('');
            await tracker?.complete({ urls: completed.urls || [], mediaType: 'image' });
        } catch (e) {
            setError(e?.message || '多视角生成任务失败');
            setStage('');
            await tracker?.fail(e);
        } finally {
            setLoading(false);
        }
    };

    const downloadAll = () => {
        results.forEach((url, index) => {
            const link = document.createElement('a');
            link.href = url; link.download = `multiview-${index + 1}.png`; link.target = '_blank'; link.rel = 'noreferrer';
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
        });
    };

    return (
        <div className="mps-studio">
            <div className="mps-wizard">
                <header className="mps-wizard__header">
                    <div>
                        {onBack && (
                            <button type="button" className="mps-page__back" onClick={onBack} style={{ marginBottom: 6 }}>
                                <span aria-hidden="true">←</span> 返回
                            </button>
                        )}
                        <h1 className="mps-wizard__title"><span className="mps-page__title-emoji">🧭</span>电商产品多视角</h1>
                        <p className="mps-wizard__desc">上传商品图，一键生成 4 张同一产品的不同视角图</p>
                    </div>
                    <div className="mps-wizard__actions">
                        <button type="button" onClick={clearWorkspace} className="mps-btn mps-btn-secondary" style={{ height: 32, fontSize: 12 }}>清理工作空间</button>
                    </div>
                </header>

                {/* 步骤指示器 */}
                <div className="mps-steps">
                    {STEPS.map((s, i) => (
                        <React.Fragment key={s.id}>
                            {i > 0 && <span className="mps-step-arrow">›</span>}
                            <button type="button" className={`mps-step ${step === s.id ? 'mps-step--active' : ''} ${step > s.id ? 'mps-step--done' : ''}`} onClick={() => setStep(s.id)}>
                                <span className="mps-step__num">{step > s.id ? '✓' : s.id}</span>
                                <span>{s.title}<span style={{ marginLeft: 6, fontSize: 11, color: 'var(--mps-color-muted-soft)' }}>{s.desc}</span></span>
                            </button>
                        </React.Fragment>
                    ))}
                </div>

                {error && <div className="mps-error-box" style={{ marginBottom: 16 }}>{error}</div>}

                {/* ============ Step 1 素材准备 ============ */}
                {step === 1 && (
                    <>
                        <div className="mps-tip">
                            <span className="mps-tip__icon">✨</span>
                            <div>
                                <div className="mps-tip__title">主图建议正前方视角</div>
                                <div className="mps-tip__body">正前方视角的主图效果最佳。可附加 0-2 张其他角度参考图，辅助模型理解产品 3D 结构。生成结果会保留参考图原始场景与背景，产品造型/材质/Logo 完全一致。</div>
                            </div>
                        </div>

                        <section className="mps-section">
                            <h2 className="mps-section__title">商品主参考图 <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--mps-color-muted)' }}>必填，正前方视角最佳</span></h2>
                            <div className="mps-input-method">
                                <button type="button" onClick={() => setInputMode('upload')} className={`mps-input-method__option ${inputMode === 'upload' ? 'mps-input-method__option--active' : ''}`}>本地上传</button>
                                <button type="button" onClick={() => setInputMode('url')} className={`mps-input-method__option ${inputMode === 'url' ? 'mps-input-method__option--active' : ''}`}>URL 输入</button>
                            </div>
                            {mainSource ? (
                                <div className="mps-image-preview">
                                    <img src={mainSource.preview} alt="商品主图" className="mps-image-preview__img" />
                                    <button type="button" onClick={() => { if (mainSource.kind === 'file') URL.revokeObjectURL(mainSource.preview); setMainSource(null); }} className="mps-image-preview__remove"><X size={13} /></button>
                                    <div className="mps-image-preview__info">{mainSource.kind === 'file' ? mainSource.name : mainSource.url}</div>
                                </div>
                            ) : inputMode === 'upload' ? (
                                <div role="button" tabIndex={0} onClick={() => mainInputRef.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter') mainInputRef.current?.click(); }} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); setMainFile(e.dataTransfer.files?.[0]); }} className={`mps-upload-zone ${dragging ? 'mps-upload-zone--dragging' : ''}`}>
                                    <input ref={mainInputRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { setMainFile(e.target.files?.[0]); e.target.value = ''; }} />
                                    <div className="mps-upload-zone__icon"><UploadCloud size={30} strokeWidth={1.5} /></div>
                                    <div className="mps-upload-zone__text">点击或拖拽文件到此处上传</div>
                                    <div className="mps-upload-zone__hint">支持 JPG / PNG / WEBP · 最大 20MB</div>
                                </div>
                            ) : (
                                <div className="mps-url-row">
                                    <input value={urlValue} onChange={(e) => setUrlValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setMainURL(); }} placeholder="https://example.com/product.png" className="mps-url-input" />
                                    <button type="button" onClick={setMainURL} disabled={!urlValue.trim()} className="mps-btn mps-btn-secondary">添加</button>
                                </div>
                            )}
                        </section>

                        <section className="mps-section">
                            <h2 className="mps-section__title">附加参考图 <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--mps-color-muted)' }}>{extraSources.length}/2 张</span></h2>
                            {extraSources.length > 0 && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
                                    {extraSources.map((item, index) => (
                                        <div key={`${item.name}-${index}`} style={{ position: 'relative', borderRadius: 'var(--mps-rounded-md)', border: '1px solid var(--mps-color-hairline)', overflow: 'hidden', aspectRatio: '1', background: 'var(--mps-color-surface-soft)' }}>
                                            <img src={item.preview} alt={`附加图 ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                            <button type="button" onClick={() => removeExtra(index)} className="mps-image-preview__remove"><X size={11} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {extraSources.length < 2 && (
                                <button type="button" onClick={() => extraInputRef.current?.click()} className="mps-upload-zone__add">+ 添加参考图</button>
                            )}
                            <input ref={extraInputRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { if (e.target.files?.[0]) addExtra(e.target.files?.[0]); e.target.value = ''; }} />
                        </section>

                        <div className="mps-wizard__footer">
                            <span />
                            <button type="button" onClick={() => { setError(''); setStep(2); }} className="mps-btn mps-btn-primary">下一步：生成配置</button>
                        </div>
                    </>
                )}

                {/* ============ Step 2 生成配置 ============ */}
                {step === 2 && (
                    <>
                        <section className="mps-section">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                <h2 className="mps-section__title">视角覆盖 <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--mps-color-muted)' }}>选填 · 已覆盖 {overriddenCount}/4 个</span></h2>
                                <button type="button" onClick={resetConfig} className="mps-btn mps-btn-ghost" style={{ fontSize: 12, height: 28, padding: '0 8px' }}>恢复默认配置</button>
                            </div>
                            <p className="mps-section__sub">4 个视角各自可独立配置。不勾选 = 用默认视角；勾选后通过水平角度 / 垂直角度 / 焦距数值化配置。</p>
                            <div className="mps-angle-grid">
                                {overrides.map((o, index) => (
                                    <div key={index} className="mps-angle-card">
                                        <div className="mps-angle-card__title">
                                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                                <input type="checkbox" checked={o.enabled} onChange={(e) => setOverrides((prev) => prev.map((p, i) => (i === index ? { ...p, enabled: e.target.checked } : p)))} style={{ accentColor: '#f4c74f' }} />
                                                ViewAngle{index}
                                            </label>
                                            {o.enabled ? <span className="mps-angle-card__default" style={{ color: '#8a7440' }}>✓ 覆盖中</span> : <span className="mps-angle-card__default">默认</span>}
                                        </div>
                                        <div className="mps-angle-card__hint">默认：{DEFAULT_ANGLES[index].label}</div>
                                        {o.enabled && (
                                            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                                                <label style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--mps-color-body)' }}>
                                                    水平角度
                                                    <input type="number" min={-180} max={180} value={o.horizontal} onChange={(e) => setOverrides((prev) => prev.map((p, i) => (i === index ? { ...p, horizontal: Math.max(-180, Math.min(180, Number(e.target.value) || 0)) } : p)))} className="mps-param-field__input" style={{ height: 30 }} />
                                                </label>
                                                <label style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--mps-color-body)' }}>
                                                    垂直角度
                                                    <input type="number" min={-30} max={60} value={o.vertical} onChange={(e) => setOverrides((prev) => prev.map((p, i) => (i === index ? { ...p, vertical: Math.max(-30, Math.min(60, Number(e.target.value) || 0)) } : p)))} className="mps-param-field__input" style={{ height: 30 }} />
                                                </label>
                                                <label style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--mps-color-body)' }}>
                                                    焦距
                                                    <select value={o.zoom} onChange={(e) => setOverrides((prev) => prev.map((p, i) => (i === index ? { ...p, zoom: e.target.value } : p)))} className="mps-param-field__select" style={{ height: 30 }}>
                                                        {ZOOM_OPTIONS.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
                                                    </select>
                                                </label>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="mps-section">
                            <h2 className="mps-section__title">生成参数</h2>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">预设模板</span>
                                    <input
                                        type="number"
                                        min={1}
                                        value={definition}
                                        onChange={(e) => setDefinition(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
                                        className="mps-param-field__input"
                                    />
                                    <span className="mps-param-field__hint">默认预设模板，可输入自定义模板 ID</span>
                                </label>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">画面比例{ratioSource === 'auto' ? <span style={{ fontWeight: 400, color: 'var(--mps-color-success)' }}> ✅ 检测到图片比例 {panelRatio}，已自动匹配</span> : mainSource && panelRatio !== '1:1' ? <span style={{ fontWeight: 400, color: 'var(--mps-color-muted-soft)' }}> 📷 已手动调整</span> : null}</span>
                                    <select value={panelRatio} onChange={(e) => { setPanelRatio(e.target.value); setRatioSource('manual'); }} className="mps-param-field__select">
                                        <option value="1:1">1:1</option>
                                        <option value="3:4">3:4</option>
                                        <option value="4:3">4:3</option>
                                        <option value="9:16">9:16</option>
                                        <option value="16:9">16:9</option>
                                    </select>
                                </label>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">输出清晰度</span>
                                    <select value={panelResolution} onChange={(e) => setPanelResolution(e.target.value)} className="mps-param-field__select">
                                        <option value="1K">1K（默认）</option>
                                        <option value="2K">2K</option>
                                        <option value="4K">4K</option>
                                    </select>
                                </label>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">模型档位</span>
                                    <select value={model} onChange={(e) => setModel(e.target.value)} className="mps-param-field__select">
                                        <option value="flash">flash（默认）</option>
                                        <option value="lite">lite</option>
                                    </select>
                                </label>
                            </div>
                            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--mps-color-muted-soft)' }}>Recipe 固定 multiview × 4 · mode: modify</div>
                        </section>

                        <div className="mps-wizard__footer">
                            <button type="button" onClick={() => setStep(1)} className="mps-btn mps-btn-secondary">上一步</button>
                            <button type="button" onClick={() => setStep(3)} className="mps-btn mps-btn-primary">下一步：AI 生成</button>
                        </div>
                    </>
                )}

                {/* ============ Step 3 AI 生成 ============ */}
                {step === 3 && (
                    <>
                        <section className="mps-section">
                            <h2 className="mps-section__title">素材预览</h2>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                                {mainSource && (
                                    <div style={{ borderRadius: 'var(--mps-rounded-md)', border: '1px solid var(--mps-color-hairline)', overflow: 'hidden', background: 'var(--mps-color-surface-soft)' }}>
                                        <img src={mainSource.preview} alt="商品主图" style={{ width: '100%', aspectRatio: '1', objectFit: 'contain' }} />
                                        <div style={{ padding: '6px 8px', fontSize: 11, color: 'var(--mps-color-muted)', borderTop: '1px solid var(--mps-color-hairline)' }}>商品主图</div>
                                    </div>
                                )}
                                {extraSources.map((item, index) => (
                                    <div key={`${item.name}-${index}`} style={{ borderRadius: 'var(--mps-rounded-md)', border: '1px solid var(--mps-color-hairline)', overflow: 'hidden', background: 'var(--mps-color-surface-soft)' }}>
                                        <img src={item.preview} alt={`附加图 ${index + 1}`} style={{ width: '100%', aspectRatio: '1', objectFit: 'contain' }} />
                                        <div style={{ padding: '6px 8px', fontSize: 11, color: 'var(--mps-color-muted)', borderTop: '1px solid var(--mps-color-hairline)' }}>附加图 {index + 1}</div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="mps-section">
                            <h2 className="mps-section__title">生成参数</h2>
                            <p className="mps-section__sub">
                                固定输出 4 张视角图（{DEFAULT_ANGLES.map((a, i) => (overrides[i].enabled ? viewPrompts[i] : a.label)).join(' / ')}）
                            </p>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 999, background: 'var(--mps-color-surface-soft)', border: '1px solid var(--mps-color-hairline)', color: 'var(--mps-color-muted)', fontFamily: 'var(--mps-font-mono)' }}>视角覆盖 {overriddenCount}/4</span>
                                <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 999, background: 'var(--mps-color-surface-soft)', border: '1px solid var(--mps-color-hairline)', color: 'var(--mps-color-muted)', fontFamily: 'var(--mps-font-mono)' }}>Definition {definition}</span>
                                <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 999, background: 'var(--mps-color-surface-soft)', border: '1px solid var(--mps-color-hairline)', color: 'var(--mps-color-muted)', fontFamily: 'var(--mps-font-mono)' }}>{panelRatio} · {panelResolution} · {model}</span>
                                <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 999, background: 'var(--mps-color-surface-soft)', border: '1px solid var(--mps-color-hairline)', color: 'var(--mps-color-muted)', fontFamily: 'var(--mps-font-mono)' }}>modify · multiview × 4</span>
                            </div>
                        </section>

                        <section className="mps-section">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                <h2 className="mps-section__title" style={{ marginBottom: 0 }}>AI 多视角生成</h2>
                                {loading ? <span className="mps-status-chip mps-status-chip--pending"><Loader2 size={11} className="animate-spin" />处理中 · 耗时 {formatElapsed(elapsed)}</span>
                                    : results.length ? <span className="mps-status-chip mps-status-chip--ok">✅ 完成</span>
                                        : error ? <span className="mps-status-chip" style={{ background: '#fef2f2', color: 'var(--mps-color-error)' }}>❌ 失败</span>
                                            : <span style={{ fontSize: 12, color: 'var(--mps-color-muted-soft)' }}>未开始</span>}
                            </div>
                            {taskId && <p className="mps-result__meta" style={{ marginBottom: 8 }}>TaskId: {taskId}</p>}
                            {stage && <div className="mps-stage-box" style={{ marginBottom: 12 }}><Loader2 size={13} className="animate-spin" />{stage}</div>}
                            {results.length > 0 ? (
                                <>
                                    <div className="mps-result-grid">
                                        {results.map((url, index) => (
                                            <article key={`${url}-${index}`} className="mps-result-card">
                                                <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`视角 ${index + 1}`} className="mps-result-card__img" /></a>
                                                <div className="mps-result-card__bar">
                                                    <span>视角 {index + 1}{overrides[index]?.enabled ? '（覆盖）' : ''}</span>
                                                    <span style={{ display: 'flex', gap: 4 }}>
                                                        <a href={url} target="_blank" rel="noreferrer" className="mps-result-card__action"><ExternalLink size={12} /></a>
                                                        <a href={url} download={`multiview-${index + 1}.png`} className="mps-result-card__action"><Download size={12} /></a>
                                                    </span>
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                    <button type="button" onClick={downloadAll} className="mps-btn mps-btn-secondary" style={{ marginTop: 12, height: 32, fontSize: 12 }}><Download size={12} />下载全部</button>
                                </>
                            ) : (
                                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--mps-color-muted-soft)', fontSize: 13, border: '1px dashed var(--mps-color-hairline)', borderRadius: 'var(--mps-rounded-md)' }}>
                                    {loading ? 'AI 正在生成多视角图，请稍候…' : '点击下方「发起 AI 生成」开始'}
                                </div>
                            )}
                        </section>

                        <div className="mps-wizard__footer">
                            <button type="button" onClick={() => setStep(2)} disabled={loading} className="mps-btn mps-btn-secondary">上一步</button>
                            <button type="button" onClick={generate} disabled={loading} className="mps-btn mps-btn-primary">
                                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                                {loading ? '生成中…' : '发起 AI 生成'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}