/**
 * 爆款复刻工作台 — 基于腾讯云 MPS「爆款复刻」接口 CloneViral
 *
 * 对接官方文档:https://cloud.tencent.com/document/product/862/135652
 * 输入:爆款视频 + 商品图 + 生成参数 + 内容参数 + 人物 Persona → 一键生成复刻视频。
 * 后端: /api/viral/clone (backend/internal/viral/clone.go)
 */
import React, { useState, useRef, useMemo } from 'react';
import { Loader2, ChevronDown, Film, UploadCloud, X, RotateCcw, Settings, MessageSquare, Users, Sparkles, Columns } from 'lucide-react';
import { uploadViralFile, cloneViralVideo } from '../api/viral';
import { createGenerationTracker } from '../api/generationHistory';
import i18n from '../i18n';

const t = (s) => (i18n.t ? i18n.t(s) : s);

const STORAGE_KEY = 'viral_workbench_state';

// ---- CloneViral 参数选项(对应官方文档) ----
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

export default function ViralReplicationTool({ onBack, embedded = false }) {
    const saved = useMemo(loadPersisted, []);
    const [phase, setPhase] = useState('empty'); // empty | generating | result
    const [videoAsset, setVideoAsset] = useState(null);
    const [productAssets, setProductAssets] = useState([]);
    const [productName, setProductName] = useState('');
    const [productDesc, setProductDesc] = useState('');
    const [videoUrl, setVideoUrl] = useState(null);
    const [loading, setLoading] = useState(false);
    const [stage, setStage] = useState('');
    const [error, setError] = useState('');
    const [taskLogs, setTaskLogs] = useState([]);
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

    const dims = useVideoDimensions(videoAsset?.url);

    // 持久化
    React.useEffect(() => {
        if (phase === 'generating') return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                phase, videoAsset, productAssets, productName, productDesc, videoUrl, params,
            }));
        } catch {}
    }, [phase, videoAsset, productAssets, productName, productDesc, videoUrl, params]);

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
        setStage(''); setLoading(false);
        setPhase('empty');
    };

    const restart = () => {
        abortRef.current?.abort();
        localStorage.removeItem(STORAGE_KEY);
        setPhase('empty'); setVideoAsset(null); setProductAssets([]);
        setProductName(''); setProductDesc(''); setVideoUrl(null);
        setError(''); setStage(''); setTaskLogs([]);
    };

    const canGenerate = !!videoAsset && productAssets.length > 0 && phase !== 'generating';

    // 步骤条
    const steps = [
        { key: 'empty', label: '上传' },
        { key: 'generating', label: '生成' },
        { key: 'result', label: '预览' },
    ];
    const stepIdx = Math.max(0, steps.findIndex((s) => s.key === phase));

    const primaryAction = (() => {
        if (phase === 'generating') return { label: '取消生成', onClick: cancelCurrent, disabled: false, icon: <Loader2 className="w-4 h-4 animate-spin" /> };
        if (phase === 'result') return { label: '重新生成', onClick: handleGenerate, disabled: false, icon: null };
        return { label: '一键复刻', onClick: handleGenerate, disabled: !canGenerate, icon: null };
    })();

    return (
        <div className={embedded ? 'h-full' : 'min-h-full bg-[#f6f5ef] text-[#292720]'}>
            {/* ===== 顶部 sticky 步骤条 ===== */}
            <div className="sticky top-0 z-30 flex items-center gap-4 px-5 py-3.5 bg-[rgba(246,245,239,0.9)] backdrop-blur-[10px] border-b border-[#e2ddcf] flex-wrap">
                <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-[#8a7440] hover:text-[#5c4510] transition">
                    <ChevronDown className="w-4 h-4 rotate-90" />{t('创作台')}
                </button>
                <div className="flex items-center gap-2">
                    <div className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-gradient-to-br from-[#f2c54e] to-[#ddb64d]">
                        <ZapIcon className="w-3.5 h-3.5 text-[#362a0d]" />
                    </div>
                    <span className="text-[15px] font-semibold text-[#26231d]">{t('爆款复刻')}</span>
                </div>

                <div className="flex items-center ml-2">
                    {steps.map((s, i) => {
                        const active = s.key === phase;
                        const done = i < stepIdx;
                        return (
                            <React.Fragment key={s.key}>
                                {i > 0 && <span className="w-6 h-[1.5px] bg-[#e2ddcf] mx-1" />}
                                <div className={`flex items-center gap-[6px] text-[12px] ${active ? 'text-[#5c4510] font-medium' : done ? 'text-[#8a7440]' : 'text-gray-400'}`}>
                                    <span className={`w-[20px] h-[20px] rounded-full grid place-items-center text-[10px] font-semibold border transition-all ${active ? 'bg-[#f2c54e] border-[#f2c54e] text-[#362a0d]' : done ? 'bg-[#f6f0dd] border-[#e2c56a] text-[#8a7440]' : 'border-[#e2ddcf] bg-white text-gray-400'}`}>
                                        {done ? '✓' : i + 1}
                                    </span>
                                    <span className="whitespace-nowrap">{t(s.label)}</span>
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
                        <Loader2 className="animate-spin w-8 h-8 text-amber-500 mx-auto mb-4" />
                        <p className="text-[14px] text-[#26231d]">{t('爆款复刻生成中,可能需数分钟...')}</p>
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
                <div className="p-[24px_44px_24px] max-w-[720px] mx-auto px-5 sm:px-11">
                    <ResultView videoUrl={videoUrl} onRegenerate={handleGenerate} onRestart={restart} />
                </div>
            ) : (
                <>
                    <div className="max-w-[1200px] mx-auto px-5 sm:px-8 pt-6 pb-[60px]">
                        <div className="mb-5 flex items-center gap-3">
                            <div className="inline-flex items-center gap-2 rounded-full bg-[#f6f0dd] border border-[#e2c56a] px-3 py-1">
                                <ZapIcon className="w-3 h-3 text-[#8a7440]" />
                                <span className="text-[11.5px] font-medium text-[#5c4510]">{t('上传爆款视频与商品图,一键生成同款视频')}</span>
                            </div>
                        </div>

                        {/* 上排:上传素材(窄) / 复刻参数 / 预览画布(宽) 三卡并排等高 */}
                        <div className="grid grid-cols-1 lg:grid-cols-[280px_340px_1fr] gap-5 items-stretch">
                            <UploadPanel
                                videoAsset={videoAsset}
                                productAssets={productAssets}
                                productName={productName}
                                setProductName={setProductName}
                                productDesc={productDesc}
                                setProductDesc={setProductDesc}
                                dims={dims}
                                onUpload={handleUpload}
                                onRemove={removeAsset}
                                error={error}
                                stage={stage}
                            />
                            <CloneParamPanel params={params} setParams={setParams} />
                            <div className="min-w-0">
                                <PreviewCanvas videoAsset={videoAsset} videoUrl={videoUrl} dims={dims} />
                            </div>
                        </div>

                        {/* 下排:自定义指令横跨整行 */}
                        <div className="mt-5">
                            <AgentPromptBox value={params.userPrompt} onChange={(v) => setParams((p) => ({ ...p, userPrompt: v }))} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

function ZapIcon({ className }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
    );
}

/* ============================ 上传面板 ============================ */

function UploadZone({ onFile, accept, title, subtitle, formats, compact, uploading, progress }) {
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
                className={`w-full rounded-xl border-2 border-dashed transition flex flex-col items-center justify-center text-center px-3 ${compact ? 'py-[14px]' : 'py-6'} ${dragOver ? 'border-amber-400 bg-amber-50' : 'border-[#e2ded3] bg-[#faf9f6] hover:border-amber-300 hover:bg-amber-50/40'}`}
            >
                <div className={`rounded-full grid place-items-center text-amber-600 ${compact ? 'w-[30px] h-[30px]' : 'w-[42px] h-[42px]'} bg-amber-50`}>
                    {uploading ? <Loader2 className="animate-spin w-5 h-5" /> : <UploadCloud className={compact ? 'w-4 h-4' : 'w-5 h-5'} />}
                </div>
                <div className={`text-[#1f2329] font-medium ${compact ? 'text-[12px]' : 'text-[13.5px]'} mt-1.5`}>
                    {uploading ? `上传中 ${progress}%` : title}
                </div>
                {subtitle && <div className="text-[11.5px] text-gray-400 mt-0.5">{subtitle}</div>}
                {formats && <div className="text-[10.5px] text-gray-400 mt-0.5">{formats}</div>}
            </button>
        </>
    );
}

function AssetItem({ asset, onRemove, color, badge }) {
    return (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[9px] bg-[#f4f2ec] border border-[#e8e5dc]">
            <div className="w-[38px] h-[38px] rounded-[9px] flex-shrink-0 overflow-hidden relative bg-amber-50">
                {asset.type === 'image' && asset.url ? (
                    <img src={asset.url} alt="" className="w-full h-full object-cover" />
                ) : asset.type === 'video' && asset.url ? (
                    <video src={asset.url} className="w-full h-full object-cover" muted />
                ) : (
                    <Film className="w-4 h-4 text-amber-500 m-auto" />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-[12px] text-[#1f2329] font-medium truncate flex items-center gap-1.5">
                    <span className="truncate">{asset.name}</span>
                    {badge && <span className="text-[9.5px] px-1.5 py-px rounded bg-amber-100 text-amber-700 flex-shrink-0">{badge}</span>}
                </div>
                <div className="text-[10.5px] text-gray-400 mt-px">{formatSize(asset.size)}</div>
            </div>
            <button onClick={onRemove} className="text-gray-400 text-base leading-none p-1 hover:text-red-500">×</button>
        </div>
    );
}

function UploadPanel({ videoAsset, productAssets, productName, setProductName, productDesc, setProductDesc, dims, onUpload, onRemove, error, stage }) {
    const videoSizeBadge = dims ? `${dims.width}×${dims.height}` : null;
    return (
        <div className="glass-card rounded-2xl flex flex-col h-full">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#ece9e0] flex-shrink-0 bg-[#faf9f5]">
                <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-[#f2c54e] to-[#ddb64d]">
                    <UploadCloud className="w-3.5 h-3.5 text-[#362a0d]" />
                </div>
                <div>
                    <h3 className="text-[14px] font-semibold text-[#26231d]">{t('上传素材')}</h3>
                    <p className="text-[10px] text-gray-400">{t('爆款视频 + 商品图')}</p>
                </div>
            </div>

            <div className="p-3.5 flex-1 overflow-y-auto min-h-0 space-y-3">
                {/* 爆款视频 */}
                <div>
                    <div className="text-[11.5px] font-semibold text-[#26231d] mb-2 flex items-center gap-1.5">
                        {t('爆款视频')} <span className="text-amber-500">*</span>
                        <span className="font-normal text-[10.5px] text-gray-400 ml-1">— AI 直接学习运镜/节奏/场景</span>
                    </div>
                    {videoAsset ? (
                        <AssetItem asset={videoAsset} onRemove={() => onRemove('video')} badge={videoSizeBadge} />
                    ) : (
                        <UploadZone onFile={(f) => onUpload('video', f)} accept="video/mp4,video/quicktime"
                            title={t('点击或拖拽上传爆款视频')} formats="mp4 / mov · 建议 9:16 竖屏" compact />
                    )}
                </div>

                {/* 商品图 */}
                <div>
                    <div className="text-[11.5px] font-semibold text-[#26231d] mb-2 flex items-center gap-1.5">
                        {t('商品图')} <span className="text-amber-500">*</span>
                        <span className="ml-auto font-normal text-[10.5px] text-gray-400">{productAssets.length}/9 张</span>
                    </div>
                    {productAssets.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                            {productAssets.map((a) => <AssetItem key={a.id} asset={a} onRemove={() => onRemove('product', a.id)} />)}
                            {productAssets.length < 9 && (
                                <UploadZone onFile={(f) => onUpload('product', f)} accept="image/jpeg,image/png,image/webp"
                                    title={t('继续添加商品图')} formats="jpg / png · 不同角度" compact />
                            )}
                        </div>
                    ) : (
                        <UploadZone onFile={(f) => onUpload('product', f)} accept="image/jpeg,image/png,image/webp"
                            title={t('把商品图放进来')} formats="jpg / png · 最多 9 张" compact />
                    )}
                </div>

                {/* 商品信息 */}
                <div>
                    <div className="text-[11.5px] font-semibold text-[#26231d] mb-2">
                        {t('商品信息')} <span className="font-normal text-[10.5px] text-gray-400">（选填）</span>
                    </div>
                    <div className="flex flex-col gap-2">
                        <input type="text" className="field" placeholder={t('商品名称,如:便携挂脖风扇')} value={productName}
                            onChange={(e) => setProductName(e.target.value)} />
                        <textarea className="field min-h-[60px] resize-none py-2" placeholder={t('商品卖点/描述,如:风力强劲、静音设计')} value={productDesc}
                            onChange={(e) => setProductDesc(e.target.value)} />
                    </div>
                </div>

                {error && <div className="p-2 rounded-[9px] bg-red-50 border border-red-200 text-[11.5px] text-red-600">{error}</div>}
                {stage && <div className="p-2 rounded-[9px] bg-amber-50 border border-amber-200 text-[11.5px] text-amber-700">{stage}</div>}
            </div>
        </div>
    );
}

/* ============================ 预览画布 ============================ */

function PreviewCanvas({ videoAsset, videoUrl, dims }) {
    const [compareMode, setCompareMode] = useState(false);
    const hasResult = !!videoUrl;
    const hasOriginal = !!videoAsset?.url;

    return (
        <div className="glass-card rounded-2xl flex flex-col h-full">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#ece9e0] flex-shrink-0 bg-[#faf9f5]">
                <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-[#f2c54e] to-[#ddb64d]">
                    <Film className="w-3.5 h-3.5 text-[#362a0d]" />
                </div>
                <div>
                    <h3 className="text-[14px] font-semibold text-[#26231d]">{t('预览画布')}</h3>
                    <p className="text-[10px] text-gray-400">
                        {compareMode ? t('原视频 vs 复刻') : hasResult ? t('复刻结果') : t('上传后实时预览')}
                    </p>
                </div>
                {dims && !compareMode && <span className="ml-auto text-[10.5px] text-gray-400">{dims.width}×{dims.height} · {dims.duration?.toFixed?.(1)}s</span>}
                {hasResult && hasOriginal && (
                    <button
                        onClick={() => setCompareMode((v) => !v)}
                        className={`ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium border transition ${
                            compareMode ? 'bg-[#f2c54e] border-[#ddb64d] text-[#5c4510]' : 'bg-white border-[#e2ddcf] text-gray-500 hover:border-[#d4aa42] hover:text-[#5c4510]'
                        }`}
                    >
                        <Columns className="w-3 h-3" />
                        {compareMode ? t('退出对比') : t('对比原视频')}
                    </button>
                )}
            </div>
            <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
                {compareMode && hasOriginal && hasResult ? (
                    <div className="grid grid-cols-2 gap-2 w-full h-full">
                        <div className="flex flex-col gap-1.5 min-h-0">
                            <span className="text-center text-[10px] font-medium text-gray-400 flex-shrink-0">{t('原视频')}</span>
                            <video src={videoAsset.url} controls className="flex-1 w-full min-h-0 rounded-lg bg-black object-contain" />
                        </div>
                        <div className="flex flex-col gap-1.5 min-h-0">
                            <span className="text-center text-[10px] font-medium text-amber-600 flex-shrink-0">{t('复刻结果')}</span>
                            <video src={videoUrl} controls className="flex-1 w-full min-h-0 rounded-lg bg-black object-contain" />
                        </div>
                    </div>
                ) : videoUrl ? (
                    <video src={videoUrl} controls className="max-w-full max-h-full rounded-xl bg-black" />
                ) : videoAsset ? (
                    <video src={videoAsset.url} muted className="max-w-full max-h-full rounded-xl" />
                ) : (
                    <div className="text-center text-gray-300">
                        <Film className="w-12 h-12 mx-auto mb-3 opacity-40" />
                        <p className="text-[13px]">{t('上传爆款视频后,此处实时预览')}</p>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ============================ CloneViral 参数面板 ============================ */

function CloneParamPanel({ params, setParams }) {
    const update = (key, value) => setParams((p) => ({ ...p, [key]: value }));
    return (
        <div className="glass-card rounded-2xl overflow-hidden flex flex-col h-full">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-[#faf9f5] border-b border-[#e8e4d8]">
                <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-[#f2c54e] to-[#ddb64d]">
                    <Settings className="w-3.5 h-3.5 text-[#362a0d]" />
                </div>
                <div>
                    <h3 className="text-[14.5px] font-semibold text-[#26231d]">{t('复刻参数')}</h3>
                    <p className="text-[10.5px] text-gray-400">{t('调整生成效果,默认值即可直接出片')}</p>
                </div>
            </div>

            {/* 生成参数 */}
            <div className="px-4 pt-4">
                <SectionTitle icon={<Film className="w-3 h-3" />} title={t('生成参数')} />
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <ParamField label={t('时长')}>
                        <div className="flex items-center gap-1.5 h-5 mt-0.5">
                            <input type="range" min={4} max={15} value={params.duration}
                                onChange={(e) => update('duration', Number(e.target.value))}
                                className="flex-1 h-[4px] rounded-[2px] bg-[#e2ddcf] appearance-none cursor-pointer
                                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f2c54e]
                                    [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-[#ddb64d]" />
                            <span className="text-[11.5px] text-amber-600 font-semibold w-[28px] text-right">{params.duration}s</span>
                        </div>
                    </ParamField>
                    <ParamField label={t('画面比例')}>
                        <select className="compact-field" value={params.aspectRatio} onChange={(e) => update('aspectRatio', e.target.value)}>
                            {ASPECT_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </ParamField>
                    <ParamField label={t('分辨率')}>
                        <select className="compact-field" value={params.resolution} onChange={(e) => update('resolution', e.target.value)}>
                            {RESOLUTIONS.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                        </select>
                    </ParamField>
                    <ParamField label={t('模型档位')}>
                        <select className="compact-field" value={params.modelTier} onChange={(e) => update('modelTier', e.target.value)}>
                            {MODEL_TIERS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                    </ParamField>
                </div>
            </div>

            {/* 内容参数 */}
            <div className="px-4 py-3 mt-2 border-t border-[#e8e4d8]">
                <SectionTitle icon={<MessageSquare className="w-3 h-3" />} title={t('内容参数')} />
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <ParamField label={t('语言')}>
                        <select className="compact-field" value={params.language} onChange={(e) => update('language', e.target.value)}>
                            {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                        </select>
                    </ParamField>
                    <ParamField label={t('目标市场')}>
                        <select className="compact-field" value={params.market} onChange={(e) => update('market', e.target.value)}>
                            {MARKETS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                    </ParamField>
                    <ParamField label={t('复刻程度')}>
                        <select className="compact-field" value={params.fissionLevel} onChange={(e) => update('fissionLevel', e.target.value)}>
                            {FISSION_LEVELS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                    </ParamField>
                </div>
            </div>

            {/* 人物 Persona */}
            <div className="px-4 py-3 mt-2 border-t border-[#e8e4d8]">
                <SectionTitle icon={<Users className="w-3 h-3" />} title={t('人物形象')} hint={t('可选')} />
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <ParamField label={t('性别')}>
                        <select className="compact-field" value={params.gender} onChange={(e) => update('gender', e.target.value)}>
                            {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                        </select>
                    </ParamField>
                    <ParamField label={t('年龄')}>
                        <select className="compact-field" value={params.age} onChange={(e) => update('age', e.target.value)}>
                            {AGES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                        </select>
                    </ParamField>
                    <ParamField label={t('种族')}>
                        <select className="compact-field" value={params.ethnicity} onChange={(e) => update('ethnicity', e.target.value)}>
                            {ETHNICITIES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                        </select>
                    </ParamField>
                    <ParamField label={t('体型')}>
                        <select className="compact-field" value={params.bodyType} onChange={(e) => update('bodyType', e.target.value)}>
                            {BODY_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                        </select>
                    </ParamField>
                </div>
            </div>
        </div>
    );
}

function SectionTitle({ icon, title, hint }) {
    return (
        <div className="flex items-center gap-1.5 mb-3">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-[#f6f0dd] text-[#8a7440]">{icon}</span>
            <span className="text-[12px] font-semibold text-[#5c4510]">{title}</span>
            {hint && <span className="text-[10px] text-gray-400 font-normal">({hint})</span>}
        </div>
    );
}

function ParamField({ label, children }) {
    return (
        <div>
            <div className="text-[11.5px] font-semibold text-[#26231d] mb-1.5">{label}</div>
            {children}
        </div>
    );
}

/* ============================ Agent 自定义指令输入框 ============================ */

function AgentPromptBox({ value, onChange }) {
    return (
        <div className="glass-card rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#e8e4d8] bg-[#faf9f5]">
                <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-[#8b7ec8] to-[#6b5fa8]">
                    <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                    <h3 className="text-[14px] font-semibold text-[#26231d]">{t('自定义指令')}</h3>
                    <p className="text-[10px] text-gray-400">{t('对成片的额外要求,像对话一样描述')}</p>
                </div>
            </div>
            <div className="p-3">
                <div className="flex items-end gap-2 rounded-xl border border-[#e2ddcf] bg-white px-3 py-2 focus-within:border-[#8b7ec8] focus-within:ring-2 focus-within:ring-[#8b7ec8]/20 transition">
                    <textarea
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        rows={2}
                        maxLength={500}
                        placeholder={t('例如:让画面更有高级感,节奏更紧凑,突出产品质感...')}
                        className="flex-1 bg-transparent text-[12.5px] text-[#26231d] outline-none resize-none leading-relaxed placeholder:text-gray-300"
                    />
                    <button
                        className="flex-shrink-0 inline-flex items-center gap-1 rounded-lg bg-gradient-to-br from-[#8b7ec8] to-[#6b5fa8] px-3 py-1.5 text-[11.5px] font-medium text-white hover:opacity-90 transition disabled:opacity-40"
                        disabled={!value?.trim()}
                        onClick={() => onChange('')}
                    >
                        {value?.trim() ? '✓' : t('输入指令')}
                    </button>
                </div>
                <p className="mt-1.5 text-[10px] text-gray-400 text-right">{value?.length || 0}/500</p>
            </div>
        </div>
    );
}

/* ============================ 结果视图 ============================ */

function ResultView({ videoUrl, onRegenerate, onRestart }) {
    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-sm font-semibold text-[#26231d]">{t('生成结果')}</h3>
                <div className="flex gap-2">
                    <button onClick={onRegenerate} className="btn-ghost px-3 py-1.5 text-xs">{t('重新生成')}</button>
                    <button onClick={onRestart} className="btn-ghost px-3 py-1.5 text-xs">{t('重新开始')}</button>
                </div>
            </div>
            {videoUrl && (
                <div className="glass-card rounded-2xl overflow-hidden">
                    <video src={videoUrl} controls className="w-full max-h-[480px] bg-black" />
                </div>
            )}
            {videoUrl && (
                <button onClick={() => window.open(videoUrl, '_blank')} className="btn-primary w-full py-3">
                    {t('在新窗口打开视频')}
                </button>
            )}
        </div>
    );
}
