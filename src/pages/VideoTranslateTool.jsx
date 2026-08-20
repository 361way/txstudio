/**
 * 视频译制·全球投放工作台 — 基于腾讯云 MPS「视频译制」接口 ProcessMedia(AiAnalysisTask Definition=25)
 *
 * 对接官方文档:https://cloud.tencent.com/document/product/862/124504
 * 一站式完成:字幕提取(OCR/ASR) → 翻译 → 原字幕擦除 → 压制译文字幕 → AI 克隆配音。
 * 后端: /api/translate/translate (backend/internal/translate/run.go)
 */
import React, { useState, useRef, useMemo } from 'react';
import { Loader2, ChevronDown, Film, UploadCloud, RotateCcw, Languages, Globe, Captions, Volume2, Check } from 'lucide-react';
import { uploadTranslateFile, translateVideo } from '../api/videoTranslate';
import { createGenerationTracker } from '../api/generationHistory';
import i18n from '../i18n';

const t = (s) => (i18n.t ? i18n.t(s) : s);

const STORAGE_KEY = 'video_translate_state';

// ---- 视频译制支持语种(与腾讯云文档 https://cloud.tencent.com/document/product/862/124504#language 对齐) ----
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
    React.useEffect(() => {
        if (!videoUrl) { setDims(null); return; }
        if (checkedRef.current === videoUrl) return;
        checkedRef.current = videoUrl;
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => setDims({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
        video.onerror = () => setDims(null);
        video.src = videoUrl;
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

export default function VideoTranslateTool({ onBack, embedded = false }) {
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
    const abortRef = useRef(null);
    const dims = useVideoDimensions(videoAsset?.url);

    // 刷新后重置进行中态(防御性)
    React.useEffect(() => { setPhase((p) => (p === 'generating' ? 'empty' : p)); }, []);

    // 本地持久化(生成中不写)
    React.useEffect(() => {
        if (phase === 'generating') return undefined;
        const data = { videoAsset, sourceLang, selectedLangs, enableSubtitles, subtitleMode, results, resultCreatedAt };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
    }, [phase, videoAsset, sourceLang, selectedLangs, enableSubtitles, subtitleMode, results, resultCreatedAt]);

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

    const canGenerate = !!videoAsset && selectedLangs.length > 0 && phase !== 'generating';
    const successCount = results.filter((r) => r.status === 'success').length;

    const steps = [
        { key: 'empty', label: t('上传') },
        { key: 'generating', label: t('译制') },
        { key: 'result', label: t('预览') },
    ];
    const stepIdx = Math.max(0, steps.findIndex((s) => s.key === phase));
    const primaryAction = (() => {
        if (phase === 'generating') return { label: t('取消'), onClick: cancelCurrent, disabled: false, icon: <Loader2 className="w-4 h-4 animate-spin" /> };
        if (phase === 'result') return { label: t('重新译制'), onClick: handleGenerate, disabled: false, icon: null };
        return { label: t('开始译制'), onClick: handleGenerate, disabled: !canGenerate, icon: null };
    })();

    return (
        <div className={embedded ? 'h-full' : 'min-h-full bg-[#f6f5ef] text-[#292720]'}>
            {/* ===== 顶部 sticky 步骤条 ===== */}
            <div className="sticky top-0 z-30 flex items-center gap-4 px-5 py-3.5 bg-[rgba(246,245,239,0.9)] backdrop-blur-[10px] border-b border-[#e2ddcf] flex-wrap">
                <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-[#8a7440] hover:text-[#5c4510] transition">
                    <ChevronDown className="w-4 h-4 rotate-90" />{t('创作台')}
                </button>
                <div className="flex items-center gap-2">
                    <div className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-gradient-to-br from-[#7ea6b8] to-[#5e7e8e]">
                        <Languages className="w-3.5 h-3.5 text-white" />
                    </div>
                    <span className="text-[15px] font-semibold text-[#26231d]">{t('视频译制')}</span>
                </div>

                <div className="flex items-center ml-2">
                    {steps.map((s, i) => {
                        const active = s.key === phase;
                        const done = i < stepIdx;
                        return (
                            <React.Fragment key={s.key}>
                                {i > 0 && <span className="w-6 h-[1.5px] bg-[#e2ddcf] mx-1" />}
                                <div className={`flex items-center gap-[6px] text-[12px] ${active ? 'text-[#3f6473] font-medium' : done ? 'text-[#5e7e8e]' : 'text-gray-400'}`}>
                                    <span className={`w-[20px] h-[20px] rounded-full grid place-items-center text-[10px] font-semibold border transition-all ${active ? 'bg-[#7ea6b8] border-[#7ea6b8] text-white' : done ? 'bg-[#e6eef1] border-[#9fc0cd] text-[#5e7e8e]' : 'border-[#e2ddcf] bg-white text-gray-400'}`}>
                                        {done ? '✓' : i + 1}
                                    </span>
                                    <span className="whitespace-nowrap">{s.label}</span>
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>

                <div className="ml-auto flex items-center gap-2">
                    <button className="btn-ghost text-xs" onClick={restart} disabled={phase === 'empty'}>
                        <RotateCcw className="w-3 h-3" />{t('重新开始')}
                    </button>
                    <button className="btn-primary" onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
                        {primaryAction.icon}
                        {primaryAction.label}
                    </button>
                </div>
            </div>

            {/* ===== 主内容区 ===== */}
            {phase === 'generating' ? (
                <div className="p-8 max-w-[640px] mx-auto">
                    <div className="glass-card rounded-2xl p-16 text-center">
                        <Loader2 className="animate-spin w-8 h-8 text-[#5e7e8e] mx-auto mb-4" />
                        <p className="text-[14px] text-[#26231d]">{t('视频译制中,每种语言约 1-3 分钟...')}</p>
                        <p className="text-[11.5px] text-gray-400 mt-1">{stage}</p>
                        <button onClick={cancelCurrent} className="btn-ghost px-4 py-2 text-xs mt-4">{t('取消')}</button>
                    </div>
                    {taskLogs.length > 0 && (
                        <div className="mt-4 rounded-xl border border-[#e2ddcf] bg-[#1c1b18] overflow-hidden">
                            <div className="flex items-center gap-2 px-3 py-2 bg-[#26241f] border-b border-[#3a372f]">
                                <span className="w-2 h-2 rounded-full bg-red-500/80" />
                                <span className="w-2 h-2 rounded-full bg-yellow-500/80" />
                                <span className="w-2 h-2 rounded-full bg-green-500/80" />
                                <span className="ml-2 text-[11px] text-gray-400">{t('运行日志')} · {taskLogs.length}</span>
                            </div>
                            <div className="max-h-[240px] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.7] text-[#c9d1b8] whitespace-pre-wrap break-all">
                                {taskLogs.map((line, i) => (
                                    <div key={i} className={line.includes('失败') || line.includes('超时') ? 'text-red-400' : line.includes('成功') || line.includes('完成') ? 'text-[#7cc17c]' : undefined}>{line}</div>
                                ))}
                                <div className="text-gray-500 animate-pulse">▋</div>
                            </div>
                        </div>
                    )}
                </div>
            ) : phase === 'result' ? (
                <div className="p-[24px_44px_24px] max-w-[900px] mx-auto px-5 sm:px-11">
                    <ResultView results={results} successCount={successCount} createdAt={resultCreatedAt}
                        onRegenerate={handleGenerate} onRestart={restart} />
                </div>
            ) : (
                <>
                    <div className="max-w-[1200px] mx-auto px-5 sm:px-8 pt-6 pb-[60px]">
                        <div className="mb-5 flex items-center gap-3 flex-wrap">
                            <div className="inline-flex items-center gap-2 rounded-full bg-[#e6eef1] border border-[#9fc0cd] px-3 py-1">
                                <Globe className="w-3 h-3 text-[#5e7e8e]" />
                                <span className="text-[11.5px] font-medium text-[#3f6473]">{t('上传中文视频,一键生成多语言译制版本')}</span>
                            </div>
                            <span className="text-[11px] text-gray-400">{t('字幕擦除 · 提取 · 翻译 · 压制 · AI 克隆配音')}</span>
                        </div>

                        {/* 上排:上传素材(窄) / 译制参数 / 预览画布(宽) 三卡并排等高 */}
                        <div className="grid grid-cols-1 lg:grid-cols-[300px_360px_1fr] gap-5 items-stretch">
                            <UploadPanel
                                videoAsset={videoAsset}
                                dims={dims}
                                uploading={uploading}
                                uploadProgress={uploadProgress}
                                onUpload={handleUpload}
                                onRemove={removeVideo}
                                error={error}
                                stage={stage}
                            />
                            <TranslateParamPanel
                                sourceLang={sourceLang}
                                onSourceLangChange={changeSourceLang}
                                selectedLangs={selectedLangs}
                                toggleLang={toggleLang}
                                enableSubtitles={enableSubtitles}
                                setEnableSubtitles={setEnableSubtitles}
                                subtitleMode={subtitleMode}
                                setSubtitleMode={setSubtitleMode}
                            />
                            <div className="min-w-0">
                                <PreviewCanvas videoAsset={videoAsset} dims={dims} />
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

/* ============================ 上传面板 ============================ */

function UploadZone({ onFile, accept, title, subtitle, formats, uploading, progress }) {
    const inputRef = useRef(null);
    const [dragOver, setDragOver] = useState(false);
    return (
        <>
            <input ref={inputRef} type="file" accept={accept} className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files); e.target.value = ''; }} />
            <button
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.[0]) onFile(e.dataTransfer.files); }}
                className={`w-full rounded-xl border-2 border-dashed transition flex flex-col items-center justify-center text-center px-3 py-[18px] ${dragOver ? 'border-[#7ea6b8] bg-[#e6eef1]' : 'border-[#e2ded3] bg-[#faf9f6] hover:border-[#9fc0cd] hover:bg-[#eef4f6]'}`}
            >
                <div className="rounded-full grid place-items-center w-[38px] h-[38px] text-[#5e7e8e] bg-[#e6eef1]">
                    {uploading ? <Loader2 className="animate-spin w-5 h-5" /> : <UploadCloud className="w-5 h-5" />}
                </div>
                <div className="text-[#1f2329] font-medium text-[13.5px] mt-1.5">
                    {uploading ? `上传中 ${progress}%` : title}
                </div>
                {subtitle && <div className="text-[11.5px] text-gray-400 mt-0.5">{subtitle}</div>}
                {formats && <div className="text-[10.5px] text-gray-400 mt-0.5">{formats}</div>}
            </button>
        </>
    );
}

function UploadPanel({ videoAsset, dims, uploading, uploadProgress, onUpload, onRemove, error, stage }) {
    const videoBadge = dims ? `${dims.width}×${dims.height}${dims.duration ? ` · ${formatDuration(dims.duration)}` : ''}` : null;
    return (
        <div className="glass-card rounded-2xl flex flex-col h-full">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#ece9e0] flex-shrink-0 bg-[#faf9f5]">
                <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-[#7ea6b8] to-[#5e7e8e]">
                    <UploadCloud className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                    <h3 className="text-[14px] font-semibold text-[#26231d]">{t('上传视频')}</h3>
                    <p className="text-[10px] text-gray-400">{t('中文原视频,自动译制成多语言')}</p>
                </div>
            </div>

            <div className="p-3.5 flex-1 overflow-y-auto min-h-0 space-y-3">
                <div>
                    <div className="text-[11.5px] font-semibold text-[#26231d] mb-2 flex items-center gap-1.5">
                        {t('源视频')} <span className="text-[#5e7e8e]">*</span>
                        <span className="ml-auto font-normal text-[10.5px] text-gray-400">{t('≤500MB')}</span>
                    </div>
                    {videoAsset ? (
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[9px] bg-[#f4f2ec] border border-[#e8e5dc]">
                            <div className="w-[38px] h-[38px] rounded-[9px] flex-shrink-0 overflow-hidden relative bg-[#e6eef1]">
                                {videoAsset.url ? (
                                    <video src={videoAsset.url} className="w-full h-full object-cover" muted />
                                ) : (
                                    <Film className="w-4 h-4 text-[#5e7e8e] m-auto" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-[12px] text-[#1f2329] font-medium truncate flex items-center gap-1.5">
                                    <span className="truncate">{videoAsset.name}</span>
                                    {videoBadge && <span className="text-[9.5px] px-1.5 py-px rounded bg-[#e6eef1] text-[#5e7e8e] flex-shrink-0">{videoBadge}</span>}
                                </div>
                                <div className="text-[10.5px] text-gray-400 mt-px">{formatSize(videoAsset.size)}</div>
                            </div>
                            <button onClick={onRemove} className="text-gray-400 text-base leading-none p-1 hover:text-red-500">×</button>
                        </div>
                    ) : (
                        <UploadZone onFile={onUpload} accept="video/mp4,video/quicktime"
                            title={t('点击或拖拽上传视频')} subtitle={t('中文视频,画面带硬字幕效果最佳')} formats="mp4 / mov / webm · ≤500MB"
                            uploading={uploading} progress={uploadProgress} />
                    )}
                </div>

                <div className="p-2.5 rounded-[9px] bg-[#faf9f5] border border-[#ece9e0]">
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-500 leading-relaxed">
                        <Volume2 className="w-3.5 h-3.5 text-[#5e7e8e] flex-shrink-0" />
                        <span>{t('AI 克隆配音:保留原片音色与情感,自动完成配音')}</span>
                    </div>
                </div>

                {error && <div className="p-2 rounded-[9px] bg-red-50 border border-red-200 text-[11.5px] text-red-600">{error}</div>}
                {stage && <div className="p-2 rounded-[9px] bg-amber-50 border border-amber-200 text-[11.5px] text-amber-700">{stage}</div>}
            </div>
        </div>
    );
}

/* ============================ 译制参数面板 ============================ */

// 目标语言多选下拉框:按钮展示已选语言,点开展开勾选列表(最多 max 个),点外部自动收起。
function LangMultiSelect({ options, selected, onToggle, max }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);

    React.useEffect(() => {
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
        <div className="relative" ref={rootRef}>
            <button type="button" onClick={() => setOpen(!open)}
                className="compact-field flex items-center justify-between gap-2 text-left">
                <span className={`truncate ${selectedLabels.length ? 'text-[#26231d]' : 'text-gray-400'}`}>
                    {selectedLabels.length ? selectedLabels.join('、') : t('选择目标语言')}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="absolute z-20 mt-1 w-full rounded-xl border border-[#e2ddcf] bg-white shadow-[0_12px_30px_rgba(30,25,12,0.12)] overflow-hidden">
                    <div className="max-h-[240px] overflow-y-auto p-1.5">
                        {options.map((l) => {
                            const active = selected.includes(l.value);
                            const disabled = !active && full;
                            return (
                                <button key={l.value} type="button" disabled={disabled}
                                    onClick={() => onToggle(l.value)}
                                    className={`w-full flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-[12px] transition ${active
                                        ? 'bg-[#e6eef1] text-[#2f4d5c] font-medium'
                                        : disabled
                                            ? 'text-gray-300'
                                            : 'text-[#26231d] hover:bg-[#f4f8fa]'}`}>
                                    <span>{l.label}</span>
                                    {active && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                                </button>
                            );
                        })}
                    </div>
                    {full && (
                        <div className="px-2 py-1.5 text-[10px] text-gray-400 border-t border-[#ece9e0]">
                            {t('最多可选')} {max} {t('种')}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function TranslateParamPanel({ sourceLang, onSourceLangChange, selectedLangs, toggleLang, enableSubtitles, setEnableSubtitles, subtitleMode, setSubtitleMode }) {
    return (
        <div className="glass-card rounded-2xl flex flex-col h-full">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#ece9e0] flex-shrink-0 bg-[#faf9f5]">
                <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-[#7ea6b8] to-[#5e7e8e]">
                    <Languages className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                    <h3 className="text-[14px] font-semibold text-[#26231d]">{t('译制参数')}</h3>
                    <p className="text-[10px] text-gray-400">{t('源语言 → 目标语言,可多选')}</p>
                </div>
            </div>

            <div className="p-3.5 flex-1 min-h-0 space-y-4 overflow-visible">
                {/* 源语言 */}
                <div>
                    <div className="text-[11.5px] font-semibold text-[#26231d] mb-2">{t('源语言')}</div>
                    <select className="compact-field w-full" value={sourceLang} onChange={(e) => onSourceLangChange(e.target.value)}>
                        {LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                </div>

                {/* 目标语言 */}
                <div>
                    <div className="text-[11.5px] font-semibold text-[#26231d] mb-2 flex items-center">
                        {t('目标语言')} <span className="text-[#5e7e8e]">*</span>
                        <span className="ml-auto font-normal text-[10.5px] text-gray-400">{selectedLangs.length}/{MAX_TARGET_LANGS}</span>
                    </div>
                    <LangMultiSelect
                        options={LANGS.filter((l) => l.value !== sourceLang)}
                        selected={selectedLangs}
                        onToggle={toggleLang}
                        max={MAX_TARGET_LANGS}
                    />
                </div>

                {/* 字幕模式 */}
                <div>
                    <div className="text-[11.5px] font-semibold text-[#26231d] mb-2">{t('字幕模式')}</div>
                    <div className="flex flex-col gap-1.5">
                        {SUBTITLE_MODES.map((m) => {
                            const active = subtitleMode === m.value;
                            return (
                                <button key={m.value} type="button" onClick={() => setSubtitleMode(m.value)}
                                    className={`flex items-center gap-2 rounded-[9px] border px-2.5 py-2 text-left transition ${active
                                        ? 'border-[#5e7e8e] bg-[#e6eef1]'
                                        : 'border-[#e2ded3] bg-white hover:border-[#9fc0cd]'}`}>
                                    <span className={`w-3.5 h-3.5 rounded-full border grid place-items-center flex-shrink-0 ${active ? 'border-[#5e7e8e]' : 'border-gray-300'}`}>
                                        {active && <span className="w-1.5 h-1.5 rounded-full bg-[#5e7e8e]" />}
                                    </span>
                                    <span className="min-w-0">
                                        <span className={`block text-[12px] font-medium ${active ? 'text-[#2f4d5c]' : 'text-[#26231d]'}`}>{m.label}</span>
                                        <span className="block text-[10px] text-gray-400">{m.hint}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* 字幕压制 */}
                <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-[9px] border border-[#e2ded3] bg-white px-2.5 py-2 hover:border-[#9fc0cd] transition">
                    <button
                        type="button"
                        role="switch"
                        aria-checked={enableSubtitles}
                        onClick={() => setEnableSubtitles(!enableSubtitles)}
                        className={`relative w-8 h-[18px] rounded-full transition-colors ${enableSubtitles ? 'bg-[#5e7e8e]' : 'bg-gray-300'}`}
                    >
                        <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all ${enableSubtitles ? 'left-[16px]' : 'left-[2px]'}`} />
                    </button>
                    <span className="min-w-0">
                        <span className="block text-[12px] font-medium text-[#26231d] flex items-center gap-1">
                            <Captions className="w-3.5 h-3.5 text-[#5e7e8e]" />{t('压制译文字幕到画面')}
                        </span>
                        <span className="block text-[10px] text-gray-400">{t('关闭后仅翻译配音,不烧录字幕')}</span>
                    </span>
                </label>
            </div>
        </div>
    );
}

/* ============================ 预览画布 ============================ */

function PreviewCanvas({ videoAsset, dims }) {
    return (
        <div className="glass-card rounded-2xl flex flex-col h-full">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#ece9e0] flex-shrink-0 bg-[#faf9f5]">
                <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-[#7ea6b8] to-[#5e7e8e]">
                    <Film className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                    <h3 className="text-[14px] font-semibold text-[#26231d]">{t('预览')}</h3>
                    <p className="text-[10px] text-gray-400">{t('源视频预览,译制结果在完成后展示')}</p>
                </div>
            </div>
            <div className="p-4 flex-1 min-h-0 flex flex-col justify-center">
                {videoAsset?.url ? (
                    <div className="rounded-xl overflow-hidden bg-black">
                        <video src={videoAsset.url} controls muted className="w-full max-h-[420px]" />
                    </div>
                ) : (
                    <div className="rounded-xl border-2 border-dashed border-[#e2ded3] bg-[#faf9f6] aspect-video grid place-items-center text-center">
                        <div>
                            <Film className="w-8 h-8 text-[#b8c8d0] mx-auto mb-2" />
                            <p className="text-[12px] text-gray-400">{t('上传视频后在此预览')}</p>
                        </div>
                    </div>
                )}
                {dims && (
                    <p className="mt-2 text-[10.5px] text-gray-400 text-center">
                        {dims.width}×{dims.height}{dims.duration ? ` · ${formatDuration(dims.duration)}` : ''}
                    </p>
                )}
            </div>
        </div>
    );
}

/* ============================ 结果视图 ============================ */

function ResultView({ results, successCount, createdAt, onRegenerate, onRestart }) {
    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                    <h3 className="text-sm font-semibold text-[#26231d]">{t('译制结果')}</h3>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                        {t('成功')} {successCount}/{results.length}
                        {createdAt && <> · {new Date(createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</>}
                    </p>
                </div>
                <div className="flex gap-2">
                    <button onClick={onRegenerate} className="btn-ghost px-3 py-1.5 text-xs">{t('重新译制')}</button>
                    <button onClick={onRestart} className="btn-ghost px-3 py-1.5 text-xs">{t('重新开始')}</button>
                </div>
            </div>

            {results.map((r) => (
                <div key={r.lang} className="glass-card rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#ece9e0] bg-[#faf9f5]">
                        <div className="flex items-center gap-2">
                            <span className={`text-[9.5px] px-1.5 py-0.5 rounded-pill ${r.status === 'success' ? 'bg-[#e6f0e3] text-[#52703f]' : 'bg-red-50 text-red-600'}`}>
                                {r.status === 'success' ? t('成功') : t('失败')}
                            </span>
                            <span className="text-[13px] font-semibold text-[#26231d]">{r.langName}</span>
                            {r.taskId && <span className="text-[10px] text-gray-400 font-mono truncate">{r.taskId.slice(-20)}</span>}
                        </div>
                        {r.status === 'success' && r.videoUrl && (
                            <button onClick={() => window.open(r.videoUrl, '_blank')} className="btn-ghost px-2.5 py-1 text-[11px]">
                                {t('在新窗口打开')}
                            </button>
                        )}
                    </div>
                    <div className="p-4">
                        {r.status === 'success' && r.videoUrl ? (
                            <video src={r.videoUrl} controls className="w-full max-h-[420px] bg-black rounded-lg" />
                        ) : (
                            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-4 text-[12px] text-red-600">
                                {r.error || t('该语言译制失败')}
                            </div>
                        )}
                    </div>
                </div>
            ))}

            <p className="text-[11px] text-gray-400 text-center leading-relaxed">
                {t('提示:译制结果在 COS 保留 7 天,请及时下载保存')}
            </p>
        </div>
    );
}
