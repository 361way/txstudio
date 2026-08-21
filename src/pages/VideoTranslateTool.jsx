/**
 * 视频译制·全球投放工作台 — 基于腾讯云 MPS「视频译制」接口 ProcessMedia(AiAnalysisTask Definition=25)
 *
 * 对接官方文档:https://cloud.tencent.com/document/product/862/124504
 * 一站式完成:字幕提取(OCR/ASR) → 翻译 → 原字幕擦除 → 压制译文字幕 → AI 克隆配音。
 * 后端: /api/translate/translate (backend/internal/translate/run.go)
 * UI 采用 mps-studio 浅色工作台风格,与其他电商助手能力(MpsImageTaskTool)保持一致:
 * 左侧输入区 + 右侧参数面板;提交后切换到结果页。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, UploadCloud, X } from 'lucide-react';
import { uploadTranslateFile, translateVideo } from '../api/videoTranslate';
import { createGenerationTracker } from '../api/generationHistory';
import i18n from '../i18n';
import '../styles/mpsStudio.css';

const t = (s) => (i18n.t ? i18n.t(s) : s);

const STORAGE_KEY = 'video_translate_state';

/* ---- 视频译制支持语种(与腾讯云文档 https://cloud.tencent.com/document/product/862/124504#language 对齐) ---- */
const LANGS = [
    { value: 'zh', label: '中文' },
    { value: 'en', label: '英语' },
    { value: 'ja', label: '日语' },
    { value: 'ko', label: '韩语' },
    { value: 'de', label: '德语' },
    { value: 'fr', label: '法语' },
    { value: 'es', label: '西班牙语' },
    { value: 'pt', label: '葡萄牙语' },
    { value: 'ru', label: '俄语' },
    { value: 'uk', label: '乌克兰语' },
    { value: 'it', label: '意大利语' },
    { value: 'id', label: '印度尼西亚语' },
    { value: 'nl', label: '荷兰语' },
    { value: 'tr', label: '土耳其语' },
    { value: 'fil', label: '菲律宾语' },
    { value: 'ms', label: '马来语' },
    { value: 'el', label: '希腊语' },
    { value: 'fi', label: '芬兰语' },
    { value: 'hr', label: '克罗地亚语' },
    { value: 'sk', label: '斯洛伐克语' },
    { value: 'pl', label: '波兰语' },
    { value: 'sv', label: '瑞典语' },
    { value: 'hi', label: '印地语' },
    { value: 'bg', label: '保加利亚语' },
    { value: 'ro', label: '罗马尼亚语' },
    { value: 'cs', label: '捷克语' },
    { value: 'da', label: '丹麦语' },
    { value: 'ta', label: '泰米尔语' },
    { value: 'hun', label: '匈牙利语' },
    { value: 'vi', label: '越南语' },
    { value: 'th', label: '泰语' },
    { value: 'ar', label: '阿拉伯语' },
];

const MAX_TARGET_LANGS = 6;

const SUBTITLE_MODES = [
    { value: 'auto', label: '自动检测', hint: '检测到硬字幕走擦除+OCR,否则走 ASR' },
    { value: 'yes', label: '有硬字幕', hint: '擦除原字幕 + OCR 提取 + 翻译 + 配音' },
    { value: 'no', label: '无硬字幕', hint: 'ASR 语音识别 + 翻译 + 配音(不擦除)' },
];

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

function loadPersisted() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch { return null; }
}

function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

function langLabel(code) {
    return LANGS.find((l) => l.value === code)?.label || code;
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

/* ============================ 目标语言多选下拉 ============================ */

// 按钮展示已选语言,点开展开勾选列表(最多 max 个),点外部自动收起。样式与其他工具的表单控件一致。
function LangMultiSelect({ options, selected, onToggle, max }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onDocMouseDown = (e) => {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDocMouseDown);
        return () => document.removeEventListener('mousedown', onDocMouseDown);
    }, [open]);

    const selectedLabels = options.filter((o) => selected.includes(o.value)).map((o) => o.label);
    const full = selected.length >= max;

    return (
        <div ref={rootRef} style={{ position: 'relative' }}>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="mps-param-field__select"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left', cursor: 'pointer' }}
            >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selectedLabels.length ? 'var(--mps-color-ink)' : 'var(--mps-color-muted-soft)' }}>
                    {selectedLabels.length ? selectedLabels.join('、') : t('选择目标语言')}
                </span>
                <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--mps-color-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
            </button>
            {open && (
                <div style={{ position: 'absolute', zIndex: 20, top: 'calc(100% + 4px)', left: 0, right: 0, background: '#fff', border: '1px solid var(--mps-color-hairline)', borderRadius: 'var(--mps-rounded-md)', boxShadow: '0 12px 30px rgba(30,25,12,.12)', overflow: 'hidden' }}>
                    <div style={{ maxHeight: 240, overflowY: 'auto', padding: 6 }}>
                        {options.map((l) => {
                            const active = selected.includes(l.value);
                            const disabled = !active && full;
                            return (
                                <button
                                    key={l.value}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => onToggle(l.value)}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                                        width: '100%', padding: '6px 8px', borderRadius: 'var(--mps-rounded-sm)',
                                        fontSize: 13, fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer',
                                        transition: 'background .12s ease',
                                        background: active ? 'rgba(244,199,79,.18)' : 'transparent',
                                        color: active ? '#5c4510' : disabled ? 'var(--mps-color-muted-soft)' : 'var(--mps-color-body-strong)',
                                        fontWeight: active ? 600 : 400,
                                        border: 'none', textAlign: 'left',
                                    }}
                                    onMouseEnter={(e) => { if (!active && !disabled) e.currentTarget.style.background = 'var(--mps-color-surface-elevated)'; }}
                                    onMouseLeave={(e) => { if (!active && !disabled) e.currentTarget.style.background = 'transparent'; }}
                                >
                                    <span>{l.label}</span>
                                    {active && <Check size={14} style={{ flexShrink: 0 }} />}
                                </button>
                            );
                        })}
                    </div>
                    {full && (
                        <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--mps-color-muted-soft)', borderTop: '1px solid var(--mps-color-hairline-soft)' }}>
                            {t('最多可选')} {max} {t('种')}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default function VideoTranslateTool({ onBack }) {
    const saved = useMemo(loadPersisted, []);
    // 初始源语言与目标语言:目标语言必须剔除源语言,避免"英语→英语"这类无效组合
    const initialSource = saved?.sourceLang ?? 'zh';
    const initialTargets = (() => {
        const list = (saved?.selectedLangs?.length ? saved.selectedLangs : ['en']).filter((l) => l !== initialSource);
        if (!list.length) list.push(initialSource === 'en' ? 'zh' : 'en');
        return list;
    })();
    const [phase, setPhase] = useState('empty'); // empty | generating | result
    const [videoAsset, setVideoAsset] = useState(saved?.videoAsset ?? null);
    const [sourceLang, setSourceLang] = useState(initialSource);
    const [selectedLangs, setSelectedLangs] = useState(initialTargets);
    const [enableSubtitles, setEnableSubtitles] = useState(saved?.enableSubtitles ?? true);
    const [subtitleMode, setSubtitleMode] = useState(saved?.subtitleMode ?? 'auto');
    const [results, setResults] = useState(saved?.results ?? []);
    const [resultCreatedAt, setResultCreatedAt] = useState(saved?.resultCreatedAt ?? null);
    const [stage, setStage] = useState('');
    const [error, setError] = useState('');
    const [taskLogs, setTaskLogs] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [elapsed, setElapsed] = useState(0);
    const abortRef = useRef(null);
    const dims = useVideoDimensions(videoAsset?.url);

    // 刷新后重置进行中态(防御性)
    useEffect(() => { setPhase((p) => (p === 'generating' ? 'empty' : p)); }, []);

    // 本地持久化(生成中不写)
    useEffect(() => {
        if (phase === 'generating') return undefined;
        const data = { videoAsset, sourceLang, selectedLangs, enableSubtitles, subtitleMode, results, resultCreatedAt };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
        return undefined;
    }, [phase, videoAsset, sourceLang, selectedLangs, enableSubtitles, subtitleMode, results, resultCreatedAt]);

    // 生成中计时(与其他工具的进度条体验一致)
    useEffect(() => {
        if (phase !== 'generating') return undefined;
        setElapsed(0);
        const timer = setInterval(() => setElapsed((v) => v + 1), 1000);
        return () => clearInterval(timer);
    }, [phase]);

    const handleUpload = async (files) => {
        const file = files?.[0];
        if (!file) return;
        try {
            setError(''); setUploading(true); setUploadProgress(0); setStage(`上传 ${file.name}...`);
            const asset = await uploadTranslateFile(file, setUploadProgress);
            setVideoAsset(asset);
            setResults([]);
            setStage('');
        } catch (e) {
            setError(e.message || '上传失败'); setStage('');
        } finally {
            setUploading(false); setUploadProgress(0);
        }
    };

    const removeVideo = () => { setVideoAsset(null); setResults([]); };

    const toggleLang = (code) => {
        setSelectedLangs((prev) => {
            if (prev.includes(code)) return prev.filter((l) => l !== code);
            if (prev.length >= MAX_TARGET_LANGS) return prev;
            return [...prev, code];
        });
    };

    // 切换源语言时,自动把该语言从目标语言中剔除(避免"英语→英语")
    const changeSourceLang = (code) => {
        setSourceLang(code);
        setSelectedLangs((prev) => {
            const next = prev.filter((l) => l !== code);
            if (!next.length) next.push(code === 'zh' ? 'en' : 'zh');
            return next;
        });
    };

    const handleGenerate = async () => {
        if (!videoAsset) { setError('请先上传视频'); return; }
        if (selectedLangs.length === 0) { setError('至少选择一个目标语言'); return; }
        setError(''); setPhase('generating'); setStage('创建视频译制任务...'); setTaskLogs([]);
        const controller = new AbortController();
        abortRef.current = controller;
        // 字幕模式 → hasSubtitle:auto 不传(后端自动探测),yes=true,no=false
        const hasSubtitle = subtitleMode === 'auto' ? undefined : subtitleMode === 'yes';
        const payload = {
            videoUrl: videoAsset.url,
            sourceLang,
            targetLangs: selectedLangs,
            enableSubtitles,
            hasSubtitle,
        };
        // 生成历史记录(生成历史页可见,复用项目统一追踪)
        const tracker = await createGenerationTracker({
            source: 'video_translate',
            type: 'video',
            provider: 'tencent-mps',
            prompt: `${langLabel(sourceLang)} → ${selectedLangs.map(langLabel).join('、')}${enableSubtitles ? ' · 压制字幕' : ''} · AI 配音`,
            modelName: 'MPS 视频译制',
            modelVersion: 'Definition=25',
            storageMode: 'Permanent',
            parameters: { sourceLang, targetLangs: selectedLangs, enableSubtitles, subtitleMode },
            assets: [{ role: 'reference', ordinal: 0, media_type: 'video', cloud_url: videoAsset.url, storage_provider: 'tencent-cos' }],
        });
        try {
            await tracker?.stage('create_task', { message: '创建视频译制任务' });
            const result = await translateVideo(payload, controller.signal, (lines) => setTaskLogs((prev) => [...prev, ...lines]));
            await tracker?.stage('polling', { message: '视频译制任务处理中' });
            const items = result?.results || [];
            if (!items.length) throw new Error('译制任务完成但未返回结果');
            // 部分语言失败 → completed_with_errors,全部成功 → completed
            const status = items.some((r) => r.status === 'failed') ? 'completed_with_errors' : 'completed';
            await tracker?.complete({
                urls: items.filter((r) => r.status === 'success').map((r) => r.videoUrl),
                mediaType: 'video',
                status,
                parameters: { ...payload, results: items.map((r) => ({ lang: r.lang, status: r.status })) },
            });
            setResults(items);
            setResultCreatedAt(new Date().toISOString());
            setPhase('result');
        } catch (e) {
            await tracker?.fail(e, e.name === 'AbortError' ? 'cancelled' : 'failed');
            if (e.name === 'AbortError') { setPhase('empty'); }
            else { setError(e.message || '译制失败'); setPhase('empty'); }
        } finally {
            setStage(''); abortRef.current = null;
        }
    };

    const cancelCurrent = () => { abortRef.current?.abort(); setPhase('empty'); };

    const restart = () => {
        abortRef.current?.abort();
        setPhase('empty');
        setVideoAsset(null); setSourceLang('zh'); setSelectedLangs(['en']);
        setEnableSubtitles(true); setSubtitleMode('auto'); setResults([]);
        setResultCreatedAt(null); setError(''); setTaskLogs([]); setStage('');
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
    };

    const backToConfig = () => { setError(''); setPhase('empty'); };

    const canGenerate = !!videoAsset && selectedLangs.length > 0 && phase !== 'generating';
    const successCount = results.filter((r) => r.status === 'success').length;
    const hasFailure = results.length > 0 && successCount < results.length;

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
                            <span className="mps-page__title-emoji">🌐</span>
                            {t('视频译制')}
                        </h1>
                        <span className="mps-page__badge">MPS ProcessMedia</span>
                    </header>

                    <div className="mps-page__body">
                        <div>
                            {/* 上传视频 */}
                            <section className="mps-section">
                                <h2 className="mps-section__title">{t('上传视频')}</h2>
                                <p className="mps-section__sub">{t('上传中文原视频,自动译制成多语言版本,面向全球投放。')}</p>
                                <div className="mps-param-field">
                                    <span className="mps-param-field__label" style={{ display: 'flex', alignItems: 'center' }}>
                                        {t('源视频')} *
                                        <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 11, color: 'var(--mps-color-muted-soft)' }}>≤500MB</span>
                                    </span>
                                    <span className="mps-param-field__hint">{t('画面带硬字幕效果最佳 · mp4 / mov / webm')}</span>
                                    {videoAsset ? (
                                        <div className="mps-image-preview" style={{ marginTop: 4 }}>
                                            <video src={videoAsset.url} controls muted style={{ display: 'block', width: '100%', maxHeight: 280, background: '#000' }} />
                                            <button type="button" onClick={removeVideo} className="mps-image-preview__remove" title={t('移除视频')}><X size={13} /></button>
                                            <div className="mps-image-preview__info">
                                                {videoAsset.name} · {formatSize(videoAsset.size)}
                                                {dims ? ` · ${dims.width}×${dims.height}${dims.duration ? ` · ${formatDuration(dims.duration)}` : ''}` : ''}
                                            </div>
                                        </div>
                                    ) : (
                                        <UploadZone
                                            onFile={handleUpload}
                                            accept="video/mp4,video/quicktime,video/webm"
                                            text={uploading ? `${t('上传中')} ${uploadProgress}%` : t('点击或拖拽上传视频')}
                                            hint="mp4 / mov / webm · ≤500MB"
                                        />
                                    )}
                                </div>
                            </section>

                            {/* 流程说明 */}
                            <div className="mps-tip">
                                <span className="mps-tip__icon">💡</span>
                                <div>
                                    <div className="mps-tip__title">{t('一站式译制流程')}</div>
                                    <div className="mps-tip__body">{t('字幕擦除 · 提取 · 翻译 · 压制 · AI 克隆配音(保留原片音色与情感,自动完成配音)。')}</div>
                                </div>
                            </div>
                        </div>

                        {/* 译制参数 */}
                        <section className="mps-section">
                            <h2 className="mps-section__title">{t('参数配置')}</h2>
                            <p className="mps-section__sub">{t('源语言 → 目标语言,可多选。')}</p>
                            <div className="mps-param-form">
                                <label className="mps-param-field">
                                    <span className="mps-param-field__label">{t('源语言')}</span>
                                    <select className="mps-param-field__select" value={sourceLang} onChange={(e) => changeSourceLang(e.target.value)}>
                                        {LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                                    </select>
                                </label>

                                <div className="mps-param-field">
                                    <span className="mps-param-field__label" style={{ display: 'flex', alignItems: 'center' }}>
                                        {t('目标语言')} *
                                        <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 11, color: 'var(--mps-color-muted-soft)' }}>{selectedLangs.length}/{MAX_TARGET_LANGS}</span>
                                    </span>
                                    <LangMultiSelect
                                        options={LANGS.filter((l) => l.value !== sourceLang)}
                                        selected={selectedLangs}
                                        onToggle={toggleLang}
                                        max={MAX_TARGET_LANGS}
                                    />
                                </div>

                                <div className="mps-param-field">
                                    <span className="mps-param-field__label">{t('字幕模式')}</span>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {SUBTITLE_MODES.map((m) => {
                                            const active = subtitleMode === m.value;
                                            return (
                                                <button
                                                    key={m.value}
                                                    type="button"
                                                    onClick={() => setSubtitleMode(m.value)}
                                                    style={{
                                                        display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%',
                                                        padding: '8px 10px', borderRadius: 'var(--mps-rounded-md)',
                                                        border: `1px solid ${active ? '#c89c2f' : '#ddd8cc'}`,
                                                        background: active ? '#fdf6e3' : 'var(--mps-color-surface-card)',
                                                        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                                                        transition: 'border-color .15s ease, background .15s ease',
                                                    }}
                                                >
                                                    <span style={{ marginTop: 3, width: 14, height: 14, borderRadius: '50%', border: `1.5px solid ${active ? '#c89c2f' : '#c9c3b6'}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                        {active && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#c89c2f' }} />}
                                                    </span>
                                                    <span style={{ minWidth: 0 }}>
                                                        <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--mps-color-ink)' }}>{m.label}</span>
                                                        <span style={{ display: 'block', fontSize: 11, color: 'var(--mps-color-muted-soft)', marginTop: 1 }}>{m.hint}</span>
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* 字幕压制开关 */}
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setEnableSubtitles((v) => !v)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEnableSubtitles((v) => !v); } }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none',
                                        padding: '8px 10px', border: '1px solid #ddd8cc', borderRadius: 'var(--mps-rounded-md)',
                                        background: 'var(--mps-color-surface-card)', transition: 'border-color .15s ease',
                                    }}
                                >
                                    <span style={{ position: 'relative', width: 32, height: 18, borderRadius: 999, background: enableSubtitles ? '#c89c2f' : '#d4d0c4', flexShrink: 0, transition: 'background .15s ease' }}>
                                        <span style={{ position: 'absolute', top: 2, left: enableSubtitles ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .15s ease' }} />
                                    </span>
                                    <span style={{ minWidth: 0 }}>
                                        <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--mps-color-ink)' }}>{t('压制译文字幕到画面')}</span>
                                        <span style={{ display: 'block', fontSize: 11, color: 'var(--mps-color-muted-soft)', marginTop: 1 }}>{t('关闭后仅翻译配音,不烧录字幕')}</span>
                                    </span>
                                </div>

                                {error && <div className="mps-error-box">{error}</div>}
                                {stage && !error && (
                                    <div className="mps-stage-box"><Loader2 size={13} className="animate-spin" />{stage}</div>
                                )}

                                <button type="button" onClick={handleGenerate} disabled={!canGenerate} className="mps-btn mps-btn-primary mps-btn--block">
                                    {t('开始译制')}
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
                            <p className="mps-result__meta">{stage || t('创建视频译制任务…')}</p>
                        </div>
                        <div className="mps-result__actions">
                            <span className="mps-status-chip mps-status-chip--pending"><Loader2 size={11} className="animate-spin" />{t('处理中')}</span>
                        </div>
                    </div>

                    <section className="mps-section">
                        <div className="mps-loading-state">
                            <Loader2 size={28} className="animate-spin" style={{ color: 'var(--mps-color-primary)' }} />
                            <div className="mps-loading-state__text">{t('视频译制中,每种语言约 1-3 分钟…')}</div>
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
                            <h2 className="mps-result__title">{t('译制结果')}</h2>
                            <p className="mps-result__meta">
                                {t('成功')} {successCount}/{results.length}
                                {resultCreatedAt && <> · {new Date(resultCreatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</>}
                            </p>
                        </div>
                        <div className="mps-result__actions">
                            <span className={`mps-status-chip ${hasFailure ? 'mps-status-chip--warn' : 'mps-status-chip--ok'}`}>
                                {hasFailure ? `⚠ ${t('部分失败')}` : `✓ ${t('已完成')}`}
                            </span>
                            <button type="button" onClick={handleGenerate} className="mps-btn mps-btn-secondary" style={{ height: 32, fontSize: 12 }}>{t('重新译制')}</button>
                            <button type="button" onClick={restart} className="mps-btn mps-btn-secondary" style={{ height: 32, fontSize: 12 }}>{t('重新开始')}</button>
                        </div>
                    </div>

                    {results.map((r) => (
                        <section className="mps-section" key={r.lang}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                                <span className={`mps-status-chip ${r.status === 'success' ? 'mps-status-chip--ok' : 'mps-status-chip--warn'}`}>
                                    {r.status === 'success' ? `✓ ${t('成功')}` : `✕ ${t('失败')}`}
                                </span>
                                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--mps-color-ink)' }}>{r.langName || langLabel(r.lang)}</span>
                                {r.taskId && <span style={{ fontSize: 11, color: 'var(--mps-color-muted-soft)', fontFamily: 'var(--mps-font-mono)' }}>{r.taskId.slice(-20)}</span>}
                                {r.status === 'success' && r.videoUrl && (
                                    <button
                                        type="button"
                                        onClick={() => window.open(r.videoUrl, '_blank')}
                                        className="mps-btn mps-btn-secondary"
                                        style={{ height: 28, fontSize: 12, marginLeft: 'auto' }}
                                    >
                                        {t('在新窗口打开')}
                                    </button>
                                )}
                            </div>
                            {r.status === 'success' && r.videoUrl ? (
                                <video src={r.videoUrl} controls style={{ display: 'block', width: '100%', maxHeight: 420, borderRadius: 'var(--mps-rounded-md)', background: '#000' }} />
                            ) : (
                                <div className="mps-error-box">{r.error || t('该语言译制失败')}</div>
                            )}
                        </section>
                    ))}

                    <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--mps-color-muted)', marginTop: 16 }}>
                        {t('提示:译制结果在 COS 保留 7 天,请及时下载保存')}
                    </p>
                </div>
            )}
        </div>
    );
}
