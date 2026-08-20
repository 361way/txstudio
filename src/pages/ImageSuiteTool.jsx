import React, { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Loader2, UploadCloud, X } from 'lucide-react';
import { listCredentials } from '../api/credential';
import { uploadMpsImage, uploadMpsImageFromURL, createImageSuiteTask, pollImageTask } from '../api/mps';
import { createGenerationTracker } from '../api/generationHistory';
import '../styles/mpsStudio.css';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 20 * 1024 * 1024;

// 官方平台模板 → Definition 映射。
const PLATFORMS = [
    { definition: 50, label: '淘宝/天猫' },
    { definition: 51, label: '亚马逊' },
    { definition: 52, label: '京东' },
    { definition: 53, label: '拼多多' },
    { definition: 54, label: 'Temu' },
    { definition: 55, label: 'TikTok' },
];

// 官方主题配置（Recipe Theme 枚举）。
const THEMES = [
    { key: 'hero', label: '主图' },
    { key: 'selling', label: '卖点图' },
    { key: 'detail', label: '细节图' },
    { key: 'scene', label: '场景图' },
    { key: 'atmosphere', label: '氛围图' },
    { key: 'angles', label: '多角度图' },
];

// 官方文案变量（Role → CustomVariables.Type / ExtPrompt.Role）。
const COPY_FIELDS = [
    { role: 'BrandName', label: '品牌名' },
    { role: 'Headline', label: '主标语', hint: '4-8 字' },
    { role: 'SellingPointsText', label: '卖点列表', hint: "3-4 条，' / ' 拼接" },
    { role: 'ProductCategory', label: '商品类目', hint: '主类-子类' },
    { role: 'ProductVisualIdentity', label: '视觉特征' },
    { role: 'TextureDescription', label: '质地描述' },
    { role: 'ColorPalette', label: '品牌色板', hint: '3 个 HEX' },
    { role: 'TargetAudience', label: '目标人群' },
    { role: 'SceneContext', label: '场景推荐' },
    { role: 'UserPrompt', label: '自由文', hint: '补充硬性事实' },
];

const STEPS = [
    { id: 1, title: '素材准备', desc: '上传商品图' },
    { id: 2, title: '生成配置', desc: '平台 / 主题 / 文案' },
    { id: 3, title: 'AI 生成', desc: '一键生成套图' },
    { id: 4, title: '审核调整', desc: '勾选重生成' },
];

const DEFAULT_THEMES = THEMES.map((t) => ({ key: t.key, enabled: true, num: 1 }));

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

// 按 Recipe 顺序展开每张结果图的主题标签。
function expandRecipeLabels(recipe) {
    const labels = [];
    (recipe || []).forEach((item) => {
        const theme = THEMES.find((t) => t.key === item.Theme);
        for (let i = 0; i < (item.Num || 0); i += 1) {
            labels.push(theme ? `${theme.label}${item.Num > 1 ? ` ${i + 1}` : ''}` : `结果 ${labels.length + 1}`);
        }
    });
    return labels;
}

/**
 * 套图生成（对齐官方 /workflow?solution=poster-suite 的 4 步向导）：
 * 1 素材准备 → 2 生成配置（平台/主题/文案） → 3 AI 生成 → 4 审核调整（modify 重生成）。
 */
export default function ImageSuiteTool({ onBack }) {
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
    const [definition, setDefinition] = useState(50);
    const [themes, setThemes] = useState(DEFAULT_THEMES);
    const [copyValues, setCopyValues] = useState(() => Object.fromEntries(COPY_FIELDS.map((f) => [f.role, ''])));
    const [panelRatio, setPanelRatio] = useState('1:1');
    const [panelResolution, setPanelResolution] = useState('2K');
    const [language, setLanguage] = useState('zh-CN');
    const [model, setModel] = useState('flash');
    // Step 3/4 生成与审核
    const [storage, setStorage] = useState({ bucket: '', region: 'ap-guangzhou', configured: false });
    const [loading, setLoading] = useState(false);
    const [stage, setStage] = useState('');
    const [error, setError] = useState('');
    const [taskId, setTaskId] = useState('');
    const [results, setResults] = useState([]);
    const [resultLabels, setResultLabels] = useState([]);
    const [elapsed, setElapsed] = useState(0);
    const [round, setRound] = useState(1);
    const sessionIdRef = useRef(null);
    // Step 4 审核
    const [selected, setSelected] = useState([]);
    const [regenCounts, setRegenCounts] = useState(() => Object.fromEntries(THEMES.map((t) => [t.key, 1])));
    const [showCopyEdit, setShowCopyEdit] = useState(false);

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

    const setMainFile = (file) => {
        try {
            validateFile(file);
            if (mainSource?.kind === 'file' && mainSource.preview) URL.revokeObjectURL(mainSource.preview);
            setMainSource({ kind: 'file', file, preview: URL.createObjectURL(file), name: file.name });
            setError(''); setResults([]); setTaskId('');
        } catch (e) { setError(e.message || '图片无效'); }
    };

    const setMainURL = () => {
        try {
            const url = validateURL(urlValue.trim());
            setMainSource({ kind: 'url', url, preview: url, name: url });
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
        setStep(1); setDefinition(50); setThemes(DEFAULT_THEMES);
        setCopyValues(Object.fromEntries(COPY_FIELDS.map((f) => [f.role, ''])));
        setPanelRatio('1:1'); setPanelResolution('2K'); setLanguage('zh-CN'); setModel('flash');
        setRound(1); setSelected([]); setShowCopyEdit(false);
    };

    const clearConfig = () => {
        setDefinition(50); setThemes(DEFAULT_THEMES);
        setCopyValues(Object.fromEntries(COPY_FIELDS.map((f) => [f.role, ''])));
        setPanelRatio('1:1'); setPanelResolution('2K'); setLanguage('zh-CN'); setModel('flash');
    };

    const activeRecipe = themes.filter((t) => t.enabled && t.num > 0).map((t) => ({ Theme: t.key, Num: t.num }));
    const totalPanels = activeRecipe.reduce((sum, t) => sum + t.Num, 0);
    const filledCopyCount = COPY_FIELDS.filter((f) => String(copyValues[f.role] || '').trim()).length;
    const extPrompts = COPY_FIELDS
        .filter((f) => String(copyValues[f.role] || '').trim())
        .map((f) => ({ Role: f.role, Prompt: String(copyValues[f.role]).trim() }));

    const platformLabel = PLATFORMS.find((p) => p.definition === definition)?.label || `自定义 (${definition})`;

    const runTask = async (mode, recipe, nextRound) => {
        setError('');
        if (!sessionIdRef.current) sessionIdRef.current = crypto.randomUUID?.() || `${Date.now()}`;
        setLoading(true);
        const outputDir = `/mps-saas/output/poster_suite/${sessionIdRef.current}/v${nextRound}/`;
        const tracker = await createGenerationTracker({
            source: 'mps_tool', type: 'mps', provider: 'tencent-mps', prompt: '',
            modelName: '套图生成', modelVersion: `poster-suite-${mode}`, storageMode: 'Permanent',
            parameters: { definition, recipe, mode, panelRatio, panelResolution, language, model, round: nextRound },
            assets: [mainSource, ...extraSources].map((item, index) => ({ role: index === 0 ? 'reference' : 'extra_reference', ordinal: index, media_type: 'image', mime_type: item.file?.type || '', file_size: item.file?.size || 0, metadata: { name: item.name || '', direct_url: item.kind === 'url' } })),
        });
        try {
            setStage('正在上传商品图到 COS…');
            await tracker?.stage('upload_start', { progress: 8, message: '正在上传商品图' });
            const input = mainSource.kind === 'file' ? await uploadMpsImage(mainSource.file) : await uploadMpsImageFromURL(mainSource.url);
            let extraImages = [];
            if (extraSources.length) {
                setStage('正在上传附加视角图到 COS…');
                extraImages = await Promise.all(extraSources.map((item) => uploadMpsImage(item.file)));
            }
            await tracker?.stage('upload_done', { progress: 25, message: '素材上传完成' });
            setStage('正在提交套图生成任务…');
            const created = await createImageSuiteTask({ input, extraImages, definition, recipe, mode, language, panelRatio, panelResolution, model, extPrompts, outputDir, outputBucket: storage.bucket, outputRegion: storage.region });
            setTaskId(created.taskId);
            await tracker?.stage('task_created', { progress: 40, message: '任务已创建', taskId: created.taskId });
            setStage('AI 套图生成中…');
            const completed = await pollImageTask(created.taskId, storage.region, {
                onPoll: ({ attempt }) => {
                    setStage(`AI 套图生成中 · 第 ${attempt} 次查询`);
                    tracker?.stage('polling', { progress: 60, message: '套图生成中' });
                },
            });
            setResults(completed.urls || []);
            setResultLabels(expandRecipeLabels(recipe));
            setStage('');
            setRound(nextRound);
            await tracker?.complete({ urls: completed.urls || [], mediaType: 'image' });
            return true;
        } catch (e) {
            setError(e?.message || '套图生成任务失败');
            setStage('');
            await tracker?.fail(e);
            return false;
        } finally {
            setLoading(false);
        }
    };

    const generate = async () => {
        if (!mainSource) { setError('请上传商品主图'); return; }
        if (!storage.configured) { setError('请先在右上角 API 设置中配置腾讯云媒体服务凭证'); return; }
        if (!storage.bucket) { setError('请先在 API 设置中填写 MPS 输出 COS Bucket'); return; }
        if (totalPanels < 4 || totalPanels > 12) { setError(`总 panel 数需在 4-12，当前 ${totalPanels}`); return; }
        setSelected([]);
        await runTask('auto', activeRecipe, 1);
    };

    // 审核重生成：勾选主题（modify 模式），重生成总数需 4-12（官方 modifyCountError）。
    const regenRecipe = Object.entries(regenCounts)
        .filter(([key]) => selected.includes(key))
        .map(([key, num]) => ({ Theme: key, Num: Math.max(1, num) }));
    const regenTotal = regenRecipe.reduce((sum, t) => sum + t.Num, 0);

    const regenerate = async () => {
        if (!selected.length) { setError('请勾选需要重生成的主题'); return; }
        if (regenTotal < 4 || regenTotal > 12) { setError(`重新生成的总 panel 数需在 4-12，当前 ${regenTotal}`); return; }
        await runTask('modify', regenRecipe, round + 1);
    };

    const downloadAll = () => {
        results.forEach((url, index) => {
            const link = document.createElement('a');
            link.href = url; link.download = `poster-${index + 1}.png`; link.target = '_blank'; link.rel = 'noreferrer';
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
        });
    };

    const toggleTheme = (key) => setThemes((prev) => prev.map((t) => (t.key === key ? { ...t, enabled: !t.enabled } : t)));
    const changeThemeNum = (key, delta) => setThemes((prev) => prev.map((t) => (t.key === key ? { ...t, num: Math.max(1, Math.min(4, t.num + delta)) } : t)));

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
                        <h1 className="mps-wizard__title"><span className="mps-page__title-emoji">🖼️</span>套图生成</h1>
                        <p className="mps-wizard__desc">上传商品图，批量生成多主题广告海报</p>
                    </div>
                    <div className="mps-wizard__actions">
                        <button type="button" onClick={clearWorkspace} className="mps-btn mps-btn-secondary" style={{ height: 32, fontSize: 12 }}>清理工作空间</button>
                    </div>
                </header>

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
                                <div className="mps-tip__title">商品图建议保持背景干净</div>
                                <div className="mps-tip__body">背景越干净，套图生成效果越稳定。可上传 1 张主图 + 最多 3 张附加视角图。</div>
                            </div>
                        </div>

                        <section className="mps-section">
                            <h2 className="mps-section__title">商品主图 <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--mps-color-muted)' }}>必填，作为套图生成的主体</span></h2>
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
                            <h2 className="mps-section__title">附加商品视角图 <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--mps-color-muted)' }}>{extraSources.length}/3 张</span></h2>
                            {extraSources.length > 0 && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
                                    {extraSources.map((item, index) => (
                                        <div key={`${item.name}-${index}`} style={{ position: 'relative', borderRadius: 'var(--mps-rounded-md)', border: '1px solid var(--mps-color-hairline)', overflow: 'hidden', aspectRatio: '1', background: 'var(--mps-color-surface-soft)' }}>
                                            <img src={item.preview} alt={`视角图 ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                            <button type="button" onClick={() => removeExtra(index)} className="mps-image-preview__remove"><X size={11} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {extraSources.length < 3 && (
                                <button type="button" onClick={() => extraInputRef.current?.click()} className="mps-upload-zone__add">+ 添加视角图</button>
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
                                <h2 className="mps-section__title">平台模板</h2>
                                <button type="button" onClick={clearConfig} className="mps-btn mps-btn-ghost" style={{ fontSize: 12, height: 28, padding: '0 8px' }}>清空配置</button>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                                {PLATFORMS.map((p) => (
                                    <button key={p.definition} type="button" onClick={() => setDefinition(p.definition)} className={`mps-input-method__option ${definition === p.definition ? 'mps-input-method__option--active' : ''}`}>{p.label}</button>
                                ))}
                            </div>
                            <label className="mps-param-field" style={{ maxWidth: 260 }}>
                                <span className="mps-param-field__label">自定义模板 ID{!PLATFORMS.some((p) => p.definition === definition) ? `（自定义 (${definition})）` : ''}</span>
                                <input type="number" min={1} value={definition} onChange={(e) => setDefinition(Math.max(1, Math.floor(Number(e.target.value) || 0)))} className="mps-param-field__input" />
                                <span className="mps-param-field__hint">可输入自定义值</span>
                            </label>
                        </section>

                        <section className="mps-section">
                            <h2 className="mps-section__title">主题配置 <span style={{ fontSize: 12, fontWeight: 400, color: totalPanels < 4 || totalPanels > 12 ? 'var(--mps-color-error)' : 'var(--mps-color-muted)' }}>总 panel = {totalPanels}（需 4-12）{totalPanels < 4 ? ' · 至少 4 张' : ''}{totalPanels > 12 ? ' · 最多 12 张' : ''}</span></h2>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                                {themes.map((t) => {
                                    const label = THEMES.find((x) => x.key === t.key)?.label || t.key;
                                    return (
                                        <div key={t.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', border: '1px solid var(--mps-color-hairline)', borderRadius: 'var(--mps-rounded-md)', background: t.enabled ? '#fdf9ec' : 'var(--mps-color-surface-soft)' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--mps-color-body-strong)' }}>
                                                <input type="checkbox" checked={t.enabled} onChange={() => toggleTheme(t.key)} style={{ accentColor: '#f4c74f' }} />
                                                {label}
                                            </label>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <button type="button" onClick={() => changeThemeNum(t.key, -1)} disabled={!t.enabled || t.num <= 1} className="mps-btn mps-btn-secondary" style={{ height: 24, width: 24, padding: 0, fontSize: 14 }}>−</button>
                                                <span style={{ minWidth: 18, textAlign: 'center', fontFamily: 'var(--mps-font-mono)', fontSize: 13 }}>{t.num}</span>
                                                <button type="button" onClick={() => changeThemeNum(t.key, 1)} disabled={!t.enabled || t.num >= 4} className="mps-btn mps-btn-secondary" style={{ height: 24, width: 24, padding: 0, fontSize: 14 }}>+</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>

                        <section className="mps-section">
                            <h2 className="mps-section__title">文案变量（可选） <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--mps-color-muted)' }}>{filledCopyCount} 个已填写</span></h2>
                            <p className="mps-section__sub">填写后覆盖自动提取值，留空使用默认</p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                                {COPY_FIELDS.map((f) => (
                                    <label key={f.role} className="mps-param-field">
                                        <span className="mps-param-field__label">{f.label}</span>
                                        <input type="text" value={copyValues[f.role] || ''} onChange={(e) => setCopyValues((prev) => ({ ...prev, [f.role]: e.target.value }))} placeholder={`输入${f.label}`} className="mps-param-field__input" />
                                        {f.hint && <span className="mps-param-field__hint">{f.hint}</span>}
                                    </label>
                                ))}
                            </div>
                        </section>

                        <section className="mps-section">
                            <h2 className="mps-section__title">输出参数</h2>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">输出比例</span>
                                    <select value={panelRatio} onChange={(e) => setPanelRatio(e.target.value)} className="mps-param-field__select">
                                        <option value="1:1">1:1</option>
                                        <option value="3:4">3:4</option>
                                        <option value="4:3">4:3</option>
                                        <option value="9:16">9:16</option>
                                        <option value="16:9">16:9</option>
                                    </select>
                                </label>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">分辨率</span>
                                    <select value={panelResolution} onChange={(e) => setPanelResolution(e.target.value)} className="mps-param-field__select">
                                        <option value="1K">1K</option>
                                        <option value="2K">2K（默认）</option>
                                        <option value="4K">4K</option>
                                    </select>
                                </label>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">语言</span>
                                    <select value={language} onChange={(e) => setLanguage(e.target.value)} className="mps-param-field__select">
                                        <option value="zh-CN">中文</option>
                                        <option value="en-US">English</option>
                                    </select>
                                </label>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">模型</span>
                                    <select value={model} onChange={(e) => setModel(e.target.value)} className="mps-param-field__select">
                                        <option value="flash">Flash（默认）</option>
                                        <option value="lite">Lite（速度优先）</option>
                                    </select>
                                </label>
                            </div>
                        </section>

                        <div className="mps-wizard__footer">
                            <button type="button" onClick={() => setStep(1)} className="mps-btn mps-btn-secondary">← 上一步</button>
                            <button type="button" onClick={() => { setError(''); setStep(3); }} className="mps-btn mps-btn-primary">下一步：AI 生成</button>
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
                                        <img src={item.preview} alt={`视角图 ${index + 1}`} style={{ width: '100%', aspectRatio: '1', objectFit: 'contain' }} />
                                        <div style={{ padding: '6px 8px', fontSize: 11, color: 'var(--mps-color-muted)', borderTop: '1px solid var(--mps-color-hairline)' }}>视角图 {index + 1}</div>
                                    </div>
                                ))}
                            </div>
                            <div className="mps-param-field__hint" style={{ marginTop: 8 }}>平台：{platformLabel} · {totalPanels} 张 · {panelRatio} · {panelResolution}</div>
                        </section>

                        <section className="mps-section">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                <h2 className="mps-section__title" style={{ marginBottom: 0 }}>AI 套图生成</h2>
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
                                                <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={resultLabels[index] || `结果 ${index + 1}`} className="mps-result-card__img" /></a>
                                                <div className="mps-result-card__bar">
                                                    <span>{resultLabels[index] || `结果 ${index + 1}`}</span>
                                                    <span style={{ display: 'flex', gap: 4 }}>
                                                        <a href={url} target="_blank" rel="noreferrer" className="mps-result-card__action"><ExternalLink size={12} /></a>
                                                        <a href={url} download={`poster-${index + 1}.png`} className="mps-result-card__action"><Download size={12} /></a>
                                                    </span>
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                        <button type="button" onClick={downloadAll} className="mps-btn mps-btn-secondary" style={{ height: 32, fontSize: 12 }}><Download size={12} />下载结果</button>
                                        <button type="button" onClick={() => setStep(4)} className="mps-btn mps-btn-primary" style={{ height: 32, fontSize: 12 }}>查看结果，开始审核 →</button>
                                    </div>
                                </>
                            ) : (
                                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--mps-color-muted-soft)', fontSize: 13, border: '1px dashed var(--mps-color-hairline)', borderRadius: 'var(--mps-rounded-md)' }}>
                                    {loading ? 'AI 套图生成中，请稍候…' : '点击下方「发起 AI 生成」开始'}
                                </div>
                            )}
                        </section>

                        <div className="mps-wizard__footer">
                            <button type="button" onClick={() => setStep(2)} disabled={loading} className="mps-btn mps-btn-secondary">← 上一步</button>
                            <button type="button" onClick={generate} disabled={loading} className="mps-btn mps-btn-primary">
                                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                                {loading ? '生成中…' : '发起 AI 生成'}
                            </button>
                        </div>
                    </>
                )}

                {/* ============ Step 4 审核调整 ============ */}
                {step === 4 && (
                    <>
                        <div className="mps-tip">
                            <span className="mps-tip__icon">💡</span>
                            <div>
                                <div className="mps-tip__title">审核调整</div>
                                <div className="mps-tip__body">勾选需要重生成的主题（至少 1 张），调整该主题的“重生成数量”，编辑文案后重新生成。未勾选的主题保留不变。</div>
                            </div>
                        </div>

                        <section className="mps-section">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                <h2 className="mps-section__title" style={{ marginBottom: 0 }}>生成结果 <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--mps-color-muted)' }}>已选 {selected.length}/{results.length} 张</span></h2>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button type="button" onClick={() => setSelected(THEMES.map((t) => t.key))} className="mps-btn mps-btn-ghost" style={{ fontSize: 12, height: 28 }}>全选</button>
                                    <button type="button" onClick={() => setSelected([])} className="mps-btn mps-btn-ghost" style={{ fontSize: 12, height: 28 }}>取消全选</button>
                                </div>
                            </div>
                            {results.length > 0 ? (
                                <div className="mps-result-grid">
                                    {results.map((url, index) => {
                                        const themeKey = themes[index]?.key;
                                        const isSelected = selected.includes(themeKey);
                                        return (
                                            <article key={`${url}-${index}`} className="mps-result-card" style={{ outline: isSelected ? '2px solid #f4c74f' : 'none' }}>
                                                <div style={{ position: 'relative' }}>
                                                    <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={resultLabels[index] || `结果 ${index + 1}`} className="mps-result-card__img" /></a>
                                                    <label style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(255,255,255,.92)', borderRadius: 6, padding: '2px 8px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <input type="checkbox" checked={isSelected} onChange={() => setSelected((prev) => (isSelected ? prev.filter((k) => k !== themeKey) : [...prev, themeKey]))} style={{ accentColor: '#f4c74f' }} />
                                                        {resultLabels[index] || `结果 ${index + 1}`}
                                                    </label>
                                                </div>
                                                <div className="mps-result-card__bar">
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>数量
                                                        <button type="button" onClick={() => setRegenCounts((prev) => ({ ...prev, [themeKey]: Math.max(1, (prev[themeKey] || 1) - 1) }))} disabled={!isSelected} className="mps-btn mps-btn-secondary" style={{ height: 22, width: 22, padding: 0, fontSize: 13 }}>−</button>
                                                        <span style={{ fontFamily: 'var(--mps-font-mono)' }}>{regenCounts[themeKey] || 1}</span>
                                                        <button type="button" onClick={() => setRegenCounts((prev) => ({ ...prev, [themeKey]: Math.min(4, (prev[themeKey] || 1) + 1) }))} disabled={!isSelected} className="mps-btn mps-btn-secondary" style={{ height: 22, width: 22, padding: 0, fontSize: 13 }}>+</button>
                                                    </span>
                                                    <span style={{ display: 'flex', gap: 4 }}>
                                                        <a href={url} target="_blank" rel="noreferrer" className="mps-result-card__action"><ExternalLink size={12} /></a>
                                                        <a href={url} download={`poster-${index + 1}.png`} className="mps-result-card__action"><Download size={12} /></a>
                                                    </span>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--mps-color-muted-soft)', fontSize: 13, border: '1px dashed var(--mps-color-hairline)', borderRadius: 'var(--mps-rounded-md)' }}>请先在第 3 步发起 AI 生成</div>
                            )}
                        </section>

                        <section className="mps-section">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                <h2 className="mps-section__title">编辑文案变量 <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--mps-color-muted)' }}>{filledCopyCount} 个已填写</span></h2>
                                <button type="button" onClick={() => setShowCopyEdit((v) => !v)} className="mps-btn mps-btn-ghost" style={{ fontSize: 12, height: 28 }}>{showCopyEdit ? '收起' : '展开编辑'}</button>
                            </div>
                            <p className="mps-section__sub">填写后覆盖自动提取值，留空使用默认；重新生成时随 modify 模式传入。</p>
                            {showCopyEdit && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                                    {COPY_FIELDS.map((f) => (
                                        <label key={f.role} className="mps-param-field">
                                            <span className="mps-param-field__label">{f.label}</span>
                                            <input type="text" value={copyValues[f.role] || ''} onChange={(e) => setCopyValues((prev) => ({ ...prev, [f.role]: e.target.value }))} placeholder={`输入${f.label}`} className="mps-param-field__input" />
                                            {f.hint && <span className="mps-param-field__hint">{f.hint}</span>}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </section>

                        <section className="mps-section">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                <h2 className="mps-section__title" style={{ marginBottom: 0 }}>重新生成</h2>
                                {loading ? <span className="mps-status-chip mps-status-chip--pending"><Loader2 size={11} className="animate-spin" />重新生成中 · 耗时 {formatElapsed(elapsed)}</span> : null}
                            </div>
                            {stage && <div className="mps-stage-box" style={{ marginBottom: 12 }}><Loader2 size={13} className="animate-spin" />{stage}</div>}
                            <div className="mps-param-field__hint">modify 模式 · 重生成总数 {regenTotal}（需 4-12）· 输出目录 v{round + 1}</div>
                        </section>

                        <div className="mps-wizard__footer">
                            <button type="button" onClick={() => setStep(3)} disabled={loading} className="mps-btn mps-btn-secondary">← 回到生成</button>
                            <button type="button" onClick={regenerate} disabled={loading || !results.length} className="mps-btn mps-btn-primary">
                                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                                {loading ? '重新生成中…' : `重新生成 (modify)${selected.length ? ` · ${selected.length} 主题` : ''}`}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}