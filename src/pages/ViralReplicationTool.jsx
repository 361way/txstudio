/**
 * 爆款复刻工作台 — 基于腾讯云 MPS「爆款复刻」接口 CloneViral
 *
 * 对接官方文档:https://cloud.tencent.com/document/product/862/135652
 * 输入:爆款视频 + 商品图 + 生成参数 + 内容参数 + 人物 Persona → 一键生成复刻视频。
 * 后端: /api/viral/clone (backend/internal/viral/clone.go)
 * UI 采用 mps-studio 浅色工作台风格,与其他电商助手能力(MpsImageTaskTool)保持一致:
 * 左侧输入区 + 右侧参数面板;提交后切换到结果页。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Film, Loader2, Sparkles, UploadCloud, X } from 'lucide-react';
import { uploadViralFile, cloneViralVideo } from '../api/viral';
import { createGenerationTracker } from '../api/generationHistory';
import i18n from '../i18n';
import '../styles/mpsStudio.css';

const t = (s) => (i18n.t ? i18n.t(s) : s);

const STORAGE_KEY = 'viral_workbench_state';

/* ---- CloneViral 参数选项(对应官方文档) ---- */
const ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];
const RESOLUTIONS = ['720p', '1080p', '2k', '4k'];
const MODEL_TIERS = [
    { value: 'flagship', label: '旗舰版(默认)' },
    { value: 'standard', label: '标准版' },
];
const LANGUAGES = [
    { value: 'zh', label: '中文' },
    { value: 'en', label: '英语' },
    { value: 'ja', label: '日语' },
    { value: 'ko', label: '韩语' },
    { value: 'es', label: '西班牙语' },
    { value: 'pt', label: '葡萄牙语' },
    { value: 'instrumental', label: '纯音乐(无口播)' },
];
const MARKETS = [
    { value: 'china', label: '中国大陆' },
    { value: 'north_america', label: '北美' },
    { value: 'europe', label: '欧洲' },
    { value: 'japan', label: '日本' },
    { value: 'korea', label: '韩国' },
    { value: 'sea', label: '东南亚' },
    { value: 'brazil', label: '巴西' },
];
const FISSION_LEVELS = [
    { value: 'exact', label: '1:1 复刻(默认)' },
    { value: 'low', label: '轻度改编' },
    { value: 'medium', label: '中度改编' },
    { value: 'high', label: '重度改编' },
];
const GENDERS = [
    { value: 'any', label: '不限(默认)' },
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
];
const AGES = [
    { value: '', label: '不限(默认)' },
    { value: 'teenager', label: '少年' },
    { value: 'youth', label: '青年' },
    { value: 'middle_aged', label: '中年' },
    { value: 'senior', label: '老年' },
];
const ETHNICITIES = [
    { value: '', label: '不限(默认)' },
    { value: 'caucasian', label: '白种人' },
    { value: 'asian', label: '亚裔' },
    { value: 'latino', label: '拉美裔' },
    { value: 'african', label: '非裔' },
    { value: 'middle_eastern', label: '中东裔' },
];
const BODY_TYPES = [
    { value: '', label: '不限(默认)' },
    { value: 'slim', label: '苗条' },
    { value: 'standard', label: '标准' },
    { value: 'athletic', label: '健美' },
    { value: 'chubby', label: '丰满' },
];

// 视频尺寸检测
function useVideoDimensions(videoUrl) {
    const [dims, setDims] = useState(null);
    const checkedRef = useRef(null);
    useEffect(() => {
        if (!videoUrl) { setDims(null); return undefined; }
        if (checkedRef.current === videoUrl) return undefined;
        checkedRef.current = videoUrl;
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => setDims({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
        video.onerror = () => setDims(null);
        video.src = videoUrl;
        return undefined;
    }, [videoUrl]);
    return dims;
}

function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/* ============================ 通用小组件 ============================ */

// 上传区(与其他电商助手工具的 mps-upload-zone 样式一致)
function UploadZone({ onFile, accept, text, hint }) {
    const inputRef = useRef(null);
    const [dragOver, setDragOver] = useState(false);
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.[0]) onFile(e.dataTransfer.files); }}
            className={`mps-upload-zone ${dragOver ? 'mps-upload-zone--dragging' : ''}`}
        >
            <input ref={inputRef} type="file" hidden accept={accept} onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files); e.target.value = ''; }} />
            <div className="mps-upload-zone__icon"><UploadCloud size={32} strokeWidth={1.5} /></div>
            <div className="mps-upload-zone__text">{text}</div>
            {hint && <div className="mps-upload-zone__hint">{hint}</div>}
        </div>
    );
}

// 任务运行日志(终端风格,复用 mps 深色代码块样式)
function TaskLogConsole({ logs }) {
    if (!logs.length) return null;
    return (
        <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--mps-color-muted)', marginBottom: 6 }}>{t('运行日志')} · {logs.length}</div>
            <pre className="mps-dry-run__code" style={{ maxHeight: 240, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {logs.map((line, i) => (
                    <div key={i} style={line.includes('失败') || line.includes('超时') ? { color: '#f87171' } : line.includes('成功') || line.includes('完成') ? { color: '#7cc17c' } : undefined}>{line}</div>
                ))}
            </pre>
        </div>
    );
}

export default function ViralReplicationTool({ onBack }) {
    const [phase, setPhase] = useState('empty'); // empty | generating | result
    const [videoAsset, setVideoAsset] = useState(null);
    const [productAssets, setProductAssets] = useState([]);
    const [productName, setProductName] = useState('');
    const [productDesc, setProductDesc] = useState('');
    const [videoUrl, setVideoUrl] = useState(null);
    const [stage, setStage] = useState('');
    const [error, setError] = useState('');
    const [taskLogs, setTaskLogs] = useState([]);
    const [elapsed, setElapsed] = useState(0);
    const [params, setParams] = useState({
        duration: 5,
        aspectRatio: '9:16',
        resolution: '720p',
        modelTier: 'flagship',
        language: 'zh',
        market: 'china',
        fissionLevel: 'exact',
        userPrompt: '',
        gender: 'any',
        age: '',
        ethnicity: '',
        bodyType: '',
    });
    const abortRef = useRef(null);
    const productInputRef = useRef(null);

    const dims = useVideoDimensions(videoAsset?.url);

    // 持久化
    useEffect(() => {
        if (phase === 'generating') return undefined;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                phase, videoAsset, productAssets, productName, productDesc, videoUrl, params,
            }));
        } catch {}
        return undefined;
    }, [phase, videoAsset, productAssets, productName, productDesc, videoUrl, params]);

    // 生成中计时(与其他工具的进度条体验一致)
    useEffect(() => {
        if (phase !== 'generating') return undefined;
        setElapsed(0);
        const timer = setInterval(() => setElapsed((v) => v + 1), 1000);
        return () => clearInterval(timer);
    }, [phase]);

    // 上传
    const handleUpload = async (kind, files) => {
        const file = files?.[0];
        if (!file) return;
        if (kind !== 'video' && productAssets.length >= 9) { setError('商品图最多 9 张'); return; }
        try {
            setError(''); setStage(`上传 ${file.name}...`);
            const asset = await uploadViralFile(file);
            if (kind === 'video') {
                setVideoAsset(asset);
                setVideoUrl(null);
            } else if (kind === 'product') {
                setProductAssets((p) => [...p, asset]);
            }
            setStage('');
        } catch (e) {
            setError(e.message || '上传失败'); setStage('');
        }
    };

    const removeAsset = (kind, id) => {
        if (kind === 'video') setVideoAsset(null);
        else if (kind === 'product') setProductAssets((p) => p.filter((a) => a.id !== id));
    };

    // 生成
    const handleGenerate = async () => {
        if (!videoAsset) { setError('请先上传爆款视频'); return; }
        if (productAssets.length === 0) { setError('请至少上传一张商品图'); return; }
        setError(''); setPhase('generating'); setStage('创建爆款复刻任务...');
        setTaskLogs([]);
        const controller = new AbortController();
        abortRef.current = controller;
        // 复用项目已有生成历史追踪(生成历史页可见)
        const tracker = await createGenerationTracker({
            source: 'viral_replication',
            type: 'video',
            provider: 'tencent-mps',
            prompt: [productName?.trim(), productDesc?.trim()].filter(Boolean).join(' · ') || '爆款复刻',
            modelName: params.modelTier,
            modelVersion: `${params.aspectRatio} ${params.resolution}`,
            storageMode: 'Permanent',
            parameters: {
                duration: params.duration,
                aspect_ratio: params.aspectRatio,
                resolution: params.resolution,
                language: params.language,
                market: params.market,
                fission_level: params.fissionLevel,
                has_custom_prompt: !!params.userPrompt?.trim(),
            },
            assets: [
                ...productAssets.map((a, i) => ({ role: 'reference', ordinal: i, media_type: 'image', cloud_url: a.url, storage_provider: 'tencent-mps' })),
                ...(videoAsset ? [{ role: 'reference_video', ordinal: 0, media_type: 'video', cloud_url: videoAsset.url, storage_provider: 'tencent-mps' }] : []),
            ],
        });
        try {
            await tracker?.stage('create_task', { message: '创建爆款复刻任务' });
            const result = await cloneViralVideo({
                videoUrl: videoAsset.url,
                product: {
                    images: productAssets.map((a) => a.url),
                    name: productName?.trim() || undefined,
                    description: productDesc?.trim() || undefined,
                },
                aigcParam: {
                    duration: params.duration,
                    aspectRatio: params.aspectRatio,
                    resolution: params.resolution,
                    modelTier: params.modelTier,
                },
                content: {
                    userPrompt: params.userPrompt?.trim() || undefined,
                    language: params.language,
                    market: params.market,
                    fissionLevel: params.fissionLevel,
                },
                persona: {
                    gender: params.gender,
                    ...(params.age ? { age: params.age } : {}),
                    ...(params.ethnicity ? { ethnicity: params.ethnicity } : {}),
                    ...(params.bodyType ? { bodyType: params.bodyType } : {}),
                },
            }, controller.signal, (lines) => setTaskLogs((prev) => [...prev, ...lines]));
            await tracker?.stage('polling', { message: '爆款复刻任务处理中' });
            const urls = result?.videoUrls || [];
            if (!urls.length) throw new Error('爆款复刻任务完成但未返回视频');
            setVideoUrl(urls[0]);
            setPhase('result');
            await tracker?.complete({ urls, mediaType: 'video' });
        } catch (e) {
            await tracker?.fail(e, e.name === 'AbortError' ? 'cancelled' : 'failed');
            if (e.name === 'AbortError') setPhase('empty');
            else { setError(e.message || '生成失败'); setPhase('empty'); }
        } finally { setStage(''); abortRef.current = null; }
    };

    const cancelCurrent = () => {
        abortRef.current?.abort();
        setStage(''); setPhase('empty');
    };

    const restart = () => {
        abortRef.current?.abort();
        localStorage.removeItem(STORAGE_KEY);
        setPhase('empty'); setVideoAsset(null); setProductAssets([]);
        setProductName(''); setProductDesc(''); setVideoUrl(null);
        setError(''); setStage(''); setTaskLogs([]);
    };

    const backToConfig = () => { setError(''); setPhase('empty'); };

    const canGenerate = !!videoAsset && productAssets.length > 0 && phase !== 'generating';
    const updateParam = (key, value) => setParams((p) => ({ ...p, [key]: value }));

    return (
        <div className="mps-studio">
            {phase === 'empty' ? (
                /* ==================== 配置页(与其他电商助手工具一致) ==================== */
                <div className="mps-page">
                    <header className="mps-page__header">
                        {onBack && (
                            <button type="button" className="mps-page__back" onClick={onBack}>
                                <span aria-hidden="true">←</span> {t('返回')}
                            </button>
                        )}
                        <h1 className="mps-page__title">
                            <span className="mps-page__title-emoji">⚡</span>
                            {t('爆款复刻')}
                        </h1>
                        <span className="mps-page__badge">MPS CloneViral</span>
                    </header>

                    <div className="mps-page__body">
                        <div>
                            {/* 上传素材 */}
                            <section className="mps-section">
                                <h2 className="mps-section__title">{t('上传素材')}</h2>
                                <p className="mps-section__sub">{t('上传爆款视频与商品图,AI 拆解爆款结构,一键生成同款视频。')}</p>

                                <div className="mps-param-form" style={{ gap: 16 }}>
                                    {/* 爆款视频 */}
                                    <div className="mps-param-field">
                                        <span className="mps-param-field__label">{t('爆款视频')} *</span>
                                        <span className="mps-param-field__hint">{t('AI 直接学习运镜 / 节奏 / 场景 · 建议 9:16 竖屏')}</span>
                                        {videoAsset ? (
                                            <div className="mps-image-preview" style={{ marginTop: 4 }}>
                                                <video src={videoAsset.url} controls muted style={{ display: 'block', width: '100%', maxHeight: 280, background: '#000' }} />
                                                <button type="button" onClick={() => removeAsset('video')} className="mps-image-preview__remove" title={t('移除视频')}><X size={13} /></button>
                                                <div className="mps-image-preview__info">
                                                    {videoAsset.name} · {formatSize(videoAsset.size)}
                                                    {dims ? ` · ${dims.width}×${dims.height}${dims.duration ? ` · ${dims.duration.toFixed(1)}s` : ''}` : ''}
                                                </div>
                                            </div>
                                        ) : (
                                            <UploadZone
                                                onFile={(f) => handleUpload('video', f)}
                                                accept="video/mp4,video/quicktime"
                                                text={t('点击或拖拽上传爆款视频')}
                                                hint="mp4 / mov"
                                            />
                                        )}
                                    </div>

                                    {/* 商品图 */}
                                    <div className="mps-param-field">
                                        <span className="mps-param-field__label" style={{ display: 'flex', alignItems: 'center' }}>
                                            {t('商品图')} *
                                            <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 11, color: 'var(--mps-color-muted-soft)' }}>{productAssets.length}/9</span>
                                        </span>
                                        <span className="mps-param-field__hint">{t('jpg / png / webp · 最多 9 张,建议不同角度')}</span>
                                        {productAssets.length > 0 && (
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 4 }}>
                                                {productAssets.map((a) => (
                                                    <div key={a.id} style={{ position: 'relative', borderRadius: 'var(--mps-rounded-md)', border: '1px solid var(--mps-color-hairline)', overflow: 'hidden', aspectRatio: '1', background: 'var(--mps-color-surface-soft)' }}>
                                                        {a.url
                                                            ? <img src={a.url} alt={a.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                                            : <div style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%' }}><Film size={16} style={{ color: 'var(--mps-color-muted-soft)' }} /></div>}
                                                        <button type="button" onClick={() => removeAsset('product', a.id)} className="mps-image-preview__remove" style={{ width: 20, height: 20 }} title={t('移除商品图')}><X size={11} /></button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {productAssets.length < 9 && (
                                            <button
                                                type="button"
                                                onClick={() => productInputRef.current?.click()}
                                                className="mps-upload-zone__add"
                                                style={{ marginTop: productAssets.length > 0 ? 12 : 4 }}
                                                disabled={productAssets.length >= 9}
                                            >
                                                + {t('添加商品图')}
                                            </button>
                                        )}
                                        <input
                                            ref={productInputRef}
                                            type="file"
                                            hidden
                                            accept="image/jpeg,image/png,image/webp"
                                            onChange={(e) => { if (e.target.files?.[0]) handleUpload('product', e.target.files); e.target.value = ''; }}
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* 商品信息与自定义指令 */}
                            <section className="mps-section">
                                <h2 className="mps-section__title">{t('商品信息与自定义指令')}</h2>
                                <p className="mps-section__sub">{t('帮助 AI 更准确地理解商品卖点;对成片的额外要求,像对话一样描述。')}</p>
                                <div className="mps-param-form">
                                    <label className="mps-param-field">
                                        <span className="mps-param-field__label">{t('商品名称')}<span style={{ fontWeight: 400, color: 'var(--mps-color-muted-soft)' }}>（{t('选填')}）</span></span>
                                        <input
                                            type="text"
                                            value={productName}
                                            onChange={(e) => setProductName(e.target.value)}
                                            placeholder={t('商品名称,如:便携挂脖风扇')}
                                            maxLength={60}
                                            className="mps-param-field__input"
                                        />
                                    </label>
                                    <label className="mps-param-field">
                                        <span className="mps-param-field__label">{t('商品卖点 / 描述')}<span style={{ fontWeight: 400, color: 'var(--mps-color-muted-soft)' }}>（{t('选填')}）</span></span>
                                        <textarea
                                            value={productDesc}
                                            onChange={(e) => setProductDesc(e.target.value)}
                                            placeholder={t('商品卖点/描述,如:风力强劲、静音设计')}
                                            maxLength={300}
                                            className="mps-param-field__textarea"
                                        />
                                    </label>
                                    <label className="mps-param-field">
                                        <span className="mps-param-field__label" style={{ display: 'flex', alignItems: 'center' }}>
                                            {t('自定义指令')}
                                            <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 11, color: 'var(--mps-color-muted-soft)' }}>{(params.userPrompt || '').length}/500</span>
                                        </span>
                                        <textarea
                                            value={params.userPrompt}
                                            onChange={(e) => updateParam('userPrompt', e.target.value)}
                                            placeholder={t('例如:让画面更有高级感,节奏更紧凑,突出产品质感...')}
                                            maxLength={500}
                                            className="mps-param-field__textarea"
                                        />
                                    </label>
                                </div>
                            </section>
                        </div>

                        {/* 参数配置 */}
                        <section className="mps-section">
                            <h2 className="mps-section__title">{t('参数配置')}</h2>
                            <p className="mps-section__sub">{t('调整生成效果,默认值即可直接出片。')}</p>
                            <div className="mps-param-form">
                                <div className="mps-text-result__label" style={{ marginTop: 0 }}>{t('生成参数')}</div>
                                <div className="mps-slider">
                                    <span className="mps-slider__label">{t('时长')}</span>
                                    <input
                                        type="range"
                                        min={4}
                                        max={15}
                                        step={1}
                                        value={params.duration}
                                        onChange={(e) => updateParam('duration', Number(e.target.value))}
                                        className="mps-slider__range"
                                    />
                                    <span className="mps-slider__value">{params.duration}s</span>
                                </div>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">{t('画面比例')}</span>
                                    <select className="mps-param-field__select" value={params.aspectRatio} onChange={(e) => updateParam('aspectRatio', e.target.value)}>
                                        {ASPECT_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                </label>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">{t('分辨率')}</span>
                                    <select className="mps-param-field__select" value={params.resolution} onChange={(e) => updateParam('resolution', e.target.value)}>
                                        {RESOLUTIONS.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                                    </select>
                                </label>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">{t('模型档位')}</span>
                                    <select className="mps-param-field__select" value={params.modelTier} onChange={(e) => updateParam('modelTier', e.target.value)}>
                                        {MODEL_TIERS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                                    </select>
                                </label>

                                <div className="mps-text-result__label">{t('内容参数')}</div>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">{t('语言')}</span>
                                    <select className="mps-param-field__select" value={params.language} onChange={(e) => updateParam('language', e.target.value)}>
                                        {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                                    </select>
                                </label>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">{t('目标市场')}</span>
                                    <select className="mps-param-field__select" value={params.market} onChange={(e) => updateParam('market', e.target.value)}>
                                        {MARKETS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                                    </select>
                                </label>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">{t('复刻程度')}</span>
                                    <select className="mps-param-field__select" value={params.fissionLevel} onChange={(e) => updateParam('fissionLevel', e.target.value)}>
                                        {FISSION_LEVELS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                                    </select>
                                </label>

                                <div className="mps-text-result__label">{t('人物形象')}（{t('可选')}）</div>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">{t('性别')}</span>
                                    <select className="mps-param-field__select" value={params.gender} onChange={(e) => updateParam('gender', e.target.value)}>
                                        {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                                    </select>
                                </label>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">{t('年龄')}</span>
                                    <select className="mps-param-field__select" value={params.age} onChange={(e) => updateParam('age', e.target.value)}>
                                        {AGES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                                    </select>
                                </label>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">{t('种族')}</span>
                                    <select className="mps-param-field__select" value={params.ethnicity} onChange={(e) => updateParam('ethnicity', e.target.value)}>
                                        {ETHNICITIES.map((e2) => <option key={e2.value} value={e2.value}>{e2.label}</option>)}
                                    </select>
                                </label>
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">{t('体型')}</span>
                                    <select className="mps-param-field__select" value={params.bodyType} onChange={(e) => updateParam('bodyType', e.target.value)}>
                                        {BODY_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                                    </select>
                                </label>

                                {error && <div className="mps-error-box">{error}</div>}
                                {stage && !error && (
                                    <div className="mps-stage-box"><Loader2 size={13} className="animate-spin" />{stage}</div>
                                )}

                                <button type="button" onClick={handleGenerate} disabled={!canGenerate} className="mps-btn mps-btn-primary mps-btn--block">
                                    {!canGenerate ? null : <Sparkles size={15} />}
                                    {t('一键复刻')}
                                </button>
                                <button type="button" onClick={restart} className="mps-btn mps-btn-secondary mps-btn--block">{t('重新开始')}</button>
                            </div>
                        </section>
                    </div>
                </div>
            ) : phase === 'generating' ? (
                /* ==================== 生成中(与其他工具的任务处理页一致) ==================== */
                <div className="mps-result">
                    <div className="mps-result__header">
                        <div>
                            <button type="button" className="mps-page__back" onClick={cancelCurrent} style={{ marginBottom: 8 }}>
                                <span aria-hidden="true">←</span> {t('取消任务')}
                            </button>
                            <h2 className="mps-result__title">{t('任务处理中')}</h2>
                            <p className="mps-result__meta">{stage || t('创建爆款复刻任务…')}</p>
                        </div>
                        <div className="mps-result__actions">
                            <span className="mps-status-chip mps-status-chip--pending"><Loader2 size={11} className="animate-spin" />{t('处理中')}</span>
                        </div>
                    </div>

                    <section className="mps-section">
                        <div className="mps-loading-state">
                            <Loader2 size={28} className="animate-spin" style={{ color: 'var(--mps-color-primary)' }} />
                            <div className="mps-loading-state__text">{t('爆款复刻生成中,可能需数分钟…')}</div>
                            <div className="mps-loading-state__sub">{stage || t('正在提交任务')} · {t('已等待')} {elapsed}s</div>
                            <div className="mps-progress-bar"><div className="mps-progress-bar__fill" style={{ width: `${Math.min(95, 8 + elapsed * 2)}%` }} /></div>
                            <button type="button" onClick={cancelCurrent} className="mps-btn mps-btn-secondary" style={{ height: 32, fontSize: 12 }}>{t('取消任务')}</button>
                        </div>
                        <TaskLogConsole logs={taskLogs} />
                    </section>
                </div>
            ) : (
                /* ==================== 结果页 ==================== */
                <div className="mps-result">
                    <div className="mps-result__header">
                        <div>
                            <button type="button" className="mps-page__back" onClick={backToConfig} style={{ marginBottom: 8 }}>
                                <span aria-hidden="true">←</span> {t('返回配置')}
                            </button>
                            <h2 className="mps-result__title">{t('生成结果')}</h2>
                            <p className="mps-result__meta">{videoAsset?.name}</p>
                        </div>
                        <div className="mps-result__actions">
                            <span className="mps-status-chip mps-status-chip--ok">✓ {t('已完成')}</span>
                            <button type="button" onClick={handleGenerate} className="mps-btn mps-btn-secondary" style={{ height: 32, fontSize: 12 }}>{t('重新生成')}</button>
                            <button type="button" onClick={restart} className="mps-btn mps-btn-secondary" style={{ height: 32, fontSize: 12 }}>{t('重新开始')}</button>
                        </div>
                    </div>

                    <section className="mps-section">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                            {videoAsset?.url && (
                                <div>
                                    <div className="mps-text-result__label">{t('原视频')}</div>
                                    <video src={videoAsset.url} controls muted style={{ display: 'block', width: '100%', maxHeight: 420, borderRadius: 'var(--mps-rounded-md)', background: '#000' }} />
                                </div>
                            )}
                            {videoUrl && (
                                <div>
                                    <div className="mps-text-result__label">{t('复刻结果')}</div>
                                    <video src={videoUrl} controls style={{ display: 'block', width: '100%', maxHeight: 420, borderRadius: 'var(--mps-rounded-md)', background: '#000' }} />
                                </div>
                            )}
                        </div>
                        {videoUrl && (
                            <div style={{ marginTop: 16, textAlign: 'center' }}>
                                <a href={videoUrl} target="_blank" rel="noreferrer" className="mps-btn mps-btn-secondary">{t('在新窗口打开视频')}</a>
                            </div>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}
