import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Bot, ChevronRight, Clock, Cloud, Database, Download,
    ExternalLink, History, Image as ImageIcon, Loader2, Play, RefreshCw, Search,
    Send, Trash2, Video, X, XCircle,
} from 'lucide-react';
import { deleteGenerationJob, getGenerationJob, importVODGenerationTask, listGenerationJobs, syncGenerationJob, syncPendingGenerationJobs } from '../api/generationHistory';
import { listProjects } from '../api/project';
import { buildCanvasAssetNode, inferMediaType } from '../api/sendToCanvas';
import SendToCanvasDialog from '../components/SendToCanvasDialog';
import i18n from '../i18n';

const t = (value) => (i18n.t ? i18n.t(value) : value);
const FILTERS = [
    { id: '', label: '全部', icon: History },
    { id: 'image', label: '图片', icon: ImageIcon },
    { id: 'video', label: '视频', icon: Video },
    { id: 'agent', label: 'Agent', icon: Bot },
];
const STATUS = {
    queued: { label: '等待中', className: 'bg-slate-100 text-slate-500' },
    running: { label: '进行中', className: 'bg-amber-50 text-amber-700' },
    completed: { label: '已完成', className: 'bg-emerald-50 text-emerald-700' },
    completed_with_errors: { label: '部分完成', className: 'bg-orange-50 text-orange-700' },
    failed: { label: '失败', className: 'bg-red-50 text-red-600' },
    cancelled: { label: '已取消', className: 'bg-gray-100 text-gray-500' },
};
const SOURCE_LABEL = {
    home: '首页', image_tool: '图片工具', video_tool: '视频工具',
    agent: '智能 Agent', canvas: '画布', pipeline: '生成管线', mps_tool: '场景工具',
    viral_replication: '爆款复刻', video_translate: '视频译制', cloud_recovery: '云端恢复',
};

function formatTime(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(value));
}

function parseJSON(value) {
    try { return JSON.parse(value || '{}'); } catch { return {}; }
}

// 将素材地址转换为浏览器可访问的安全 URL：
// - 同源 /file/ 或 /api/cache/ 路径直接可用
// - 远程 http(s) 地址原样返回
// - 本地绝对路径按 cache 目录映射到后端 /file/ 静态接口
function safeMediaURL(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    if (url.startsWith('/file/') || url.startsWith('/api/')) return url;
    if (/^https?:\/\//i.test(url)) return url;
    const marker = '/cache/';
    const idx = url.lastIndexOf(marker);
    if (idx >= 0) {
        const rel = url.slice(idx + marker.length).split('\\').join('/');
        return `/file/${rel}`;
    }
    const slash = url.lastIndexOf('/');
    const name = slash >= 0 ? url.slice(slash + 1) : url;
    return `/file/${name}`;
}

function StatusBadge({ status }) {
    const info = STATUS[status] || { label: status || '未知', className: 'bg-gray-100 text-gray-500' };
    return <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${info.className}`}>{t(info.label)}</span>;
}

function HistoryVideoModal({ job, asset, onClose }) {
    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('视频预览')}>
            <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label={t('关闭视频预览')} />
            <div className="relative flex max-h-[88vh] w-full max-w-[980px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-white">
                    <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium">{job?.model_name || t('生成视频')} {job?.model_version ? `· ${job.model_version}` : ''}</div>
                        {job?.prompt && <div className="mt-0.5 truncate text-[10px] text-white/55">{job.prompt}</div>}
                    </div>
                    <button type="button" onClick={onClose} className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white" aria-label={t('关闭视频预览')}><X size={17} /></button>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-2">
                    <MediaPreview job={job} asset={asset} controls />
                </div>
            </div>
        </div>
    );
}

function MediaPreview({ job, asset, compact = false, controls = false }) {
    const url = safeMediaURL(asset?.cloud_url || asset?.local_path) || '';
    const isVideo = job?.type === 'video' || asset?.media_type === 'video';
    const [videoRatio, setVideoRatio] = useState(16 / 9);
    if (!url) {
        const Icon = job?.type === 'agent' ? Bot : isVideo ? Video : ImageIcon;
        return <div className="flex h-full w-full items-center justify-center bg-[#f2f0e9] text-[#c5bda9]"><Icon size={compact ? 20 : 28} /></div>;
    }
    if (isVideo) {
        // 播放视图必须保持文件真实长宽比，只用宽度约束高度，避免 object-cover 裁剪画面。
        if (controls) {
            return (
                <div className="w-full bg-black" style={{ aspectRatio: String(videoRatio), maxHeight: 360 }}>
                    <video
                        src={url}
                        playsInline
                        preload="metadata"
                        controls
                        className="mx-auto h-full w-full object-contain"
                        onLoadedMetadata={(event) => {
                            const width = Number(event.currentTarget.videoWidth) || 0;
                            const height = Number(event.currentTarget.videoHeight) || 0;
                            if (width > 0 && height > 0) setVideoRatio(width / height);
                        }}
                    />
                </div>
            );
        }
        return (
            <div className="relative h-full w-full">
                <video src={url} muted playsInline preload="metadata" controls={false} className="h-full w-full bg-black object-cover" />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white shadow"><Play size={16} className="ml-0.5" /></span>
                </div>
            </div>
        );
    }
    return <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />;
}

function HistoryDetail({ id, onClose, onDelete, onSynced, onSendToCanvas }) {
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const loadDetail = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setDetail(await getGenerationJob(id));
        } catch (nextError) {
            setError(nextError?.message || '加载详情失败');
        } finally {
            setLoading(false);
        }
    }, [id]);
    useEffect(() => { void loadDetail(); }, [loadDetail]);
    const sendToCanvas = () => {
        if (!detail || sending) return;
        const nodes = (detail.assets || [])
            .filter((asset) => asset?.role === 'output')
            .map((asset, index) => buildCanvasAssetNode(asset, {
                mediaType: inferMediaType(asset, detail.type),
                index,
                prompt: detail.prompt,
                modelName: detail.model_name,
            }))
            .filter(Boolean);
        if (!nodes.length) {
            setError('该任务还没有可发送的输出素材');
            return;
        }
        setSending(true);
        onSendToCanvas?.(nodes);
        setSending(false);
    };

    const sync = async () => {
        if (!detail?.cloud_task_id || syncing) return;
        setSyncing(true);
        setError('');
        try {
            await syncGenerationJob(id);
            await loadDetail();
            onSynced?.();
        } catch (nextError) {
            setError(nextError?.message || '同步云端任务失败');
        } finally {
            setSyncing(false);
        }
    };

    const outputs = detail?.assets?.filter((item) => item.role === 'output') || [];
    const inputs = detail?.assets?.filter((item) => item.role !== 'output') || [];
    const parameters = parseJSON(detail?.parameters);

    return (
        <div className="fixed inset-0 z-[100] flex justify-end bg-black/20 backdrop-blur-[2px]" role="dialog" aria-modal="true">
            <button type="button" className="flex-1 cursor-default" onClick={onClose} aria-label={t('关闭详情')} />
            <aside className="h-full w-full max-w-[560px] overflow-y-auto border-l border-[#e9e4d8] bg-white shadow-2xl">
                <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#ece8df] bg-white/95 px-5 py-4 backdrop-blur">
                    <div><div className="text-[13px] font-semibold text-[#302d27]">{t('任务详情')}</div><div className="mt-1 text-[10px] text-gray-400">#{detail?.id || id}</div></div>
                    <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X size={17} /></button>
                </header>
                {loading ? <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#b98b25]" /></div> : error ? <div className="m-5 rounded-xl bg-red-50 p-4 text-[12px] text-red-600">{error}</div> : detail && (
                    <div className="space-y-6 p-5">
                        <section>
                            <div className="flex items-start justify-between gap-4"><div><h2 className="text-[17px] font-semibold text-[#302d27]">{detail.model_name || t('生成任务')}</h2><p className="mt-1 text-[11px] text-gray-400">{SOURCE_LABEL[detail.source] || detail.source} · {detail.model_version || '—'} · {formatTime(detail.created_at)}</p></div><div className="flex items-center gap-2"><StatusBadge status={detail.status} />{outputs.length > 0 && <button type="button" onClick={sendToCanvas} disabled={sending} className="flex items-center gap-1 rounded-lg bg-[#8a6b1f] px-2 py-1 text-[10px] text-white transition hover:bg-[#745a19] disabled:opacity-50"><Send size={11} />{t('发送到画布')}</button>}{detail.cloud_task_id && <button type="button" onClick={sync} disabled={syncing} className="flex items-center gap-1 rounded-lg border border-[#e4ded0] bg-white px-2 py-1 text-[10px] text-[#876417] hover:bg-[#faf4e6] disabled:opacity-50"><RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />{syncing ? t('同步中...') : t('同步云端')}</button>}</div></div>
                            {detail.prompt && <p className="mt-4 whitespace-pre-wrap rounded-xl bg-[#faf8f2] p-3 text-[12px] leading-6 text-[#5c574d]">{detail.prompt}</p>}
                            {detail.error_message && <div className="mt-3 flex gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-[11px] leading-5 text-red-600"><XCircle size={14} className="mt-0.5 shrink-0" />{detail.error_message}</div>}
                        </section>

                        {outputs.length > 0 && <section><h3 className="mb-3 text-[12px] font-semibold text-[#454139]">{t('输出素材')}</h3><div className="grid grid-cols-2 gap-3">{outputs.map((asset) => { const url = safeMediaURL(asset.cloud_url || asset.local_path); return <div key={asset.id} className="overflow-hidden rounded-xl border border-[#ebe6da] bg-[#faf9f5]"><MediaPreview job={detail} asset={asset} controls /><div className="flex items-center justify-end gap-1 p-2"><button type="button" onClick={() => onSendToCanvas?.([buildCanvasAssetNode(asset, { mediaType: inferMediaType(asset, detail.type), prompt: detail.prompt, modelName: detail.model_name })].filter(Boolean))} className="rounded-md p-1.5 text-gray-400 hover:bg-white hover:text-[#876417]" title={t('发送到画布')}><Send size={13} /></button>{url && <><a href={url} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-gray-400 hover:bg-white hover:text-[#876417]"><ExternalLink size={13} /></a><a href={url} download target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-gray-400 hover:bg-white hover:text-[#876417]"><Download size={13} /></a></>}</div></div>; })}</div></section>}

                        <section><h3 className="mb-3 text-[12px] font-semibold text-[#454139]">{t('生成参数')}</h3><div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-[#eee9de] p-4 text-[11px]">{[
                            ['类型', detail.type], ['来源', SOURCE_LABEL[detail.source] || detail.source],
                            ['模型', detail.model_name], ['版本', detail.model_version],
                            ['存储', detail.storage_mode], ['云端任务 ID', detail.cloud_task_id],
                            ...Object.entries(parameters).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).slice(0, 8),
                        ].map(([label, value]) => <div key={label}><div className="text-gray-400">{t(label)}</div><div className="mt-1 break-all text-[#514c42]">{String(value ?? '—')}</div></div>)}</div></section>

                        {inputs.length > 0 && <section><h3 className="mb-3 text-[12px] font-semibold text-[#454139]">{t('输入素材')}</h3><div className="space-y-2">{inputs.map((asset) => <div key={asset.id} className="flex items-center gap-3 rounded-lg border border-[#eee9df] p-2"><div className="h-10 w-10 overflow-hidden rounded-md"><MediaPreview job={{ type: asset.media_type }} asset={asset} compact /></div><div className="min-w-0 flex-1"><div className="text-[11px] text-[#514c42]">{asset.role} #{asset.ordinal + 1}</div><div className="mt-0.5 truncate text-[9.5px] text-gray-400">{asset.cloud_file_id || asset.cloud_url || '本地上传素材'}</div></div></div>)}</div></section>}

                        <section><h3 className="mb-3 text-[12px] font-semibold text-[#454139]">{t('任务时间线')}</h3><div className="relative space-y-0 pl-3">{detail.events?.map((event, index) => <div key={event.id} className="relative border-l border-[#e8e1d2] pb-4 pl-5 last:border-transparent"><span className={`absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-white ${event.level === 'error' ? 'bg-red-400' : event.level === 'warning' ? 'bg-orange-400' : index === detail.events.length - 1 ? 'bg-[#cf9a24]' : 'bg-[#d8d2c5]'}`} /><div className="text-[11px] font-medium text-[#575146]">{event.message || event.stage}</div><div className="mt-1 text-[9.5px] text-gray-400">{formatTime(event.created_at)}</div></div>)}</div></section>

                        <button type="button" onClick={() => onDelete(detail.id)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-100 py-2.5 text-[11.5px] text-red-500 hover:bg-red-50"><Trash2 size={14} />{t('删除历史记录')}</button>
                    </div>
                )}
            </aside>
        </div>
    );
}

export default function GenerationHistory({ initialProjectId = '', onOpenCanvas }) {
    const [type, setType] = useState('');
    const [status, setStatus] = useState('');
    const [projectId, setProjectId] = useState(initialProjectId ? String(initialProjectId) : '');
    const [projects, setProjects] = useState([]);
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const [data, setData] = useState({ items: [], total: 0, page_size: 24 });
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [videoPreview, setVideoPreview] = useState(null);
    const [sendNodes, setSendNodes] = useState(null);
    const [toast, setToast] = useState('');
    const initialCloudSyncRef = useRef(false);

    const handleSendToCanvas = useCallback((nodes) => {
        if (!Array.isArray(nodes) || nodes.length === 0) return;
        setSendNodes(nodes);
    }, []);

    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(''), 2600);
        return () => clearTimeout(timer);
    }, [toast]);

    const load = useCallback(async () => {
        setLoading(true); setError('');
        try { setData(await listGenerationJobs({ type, status, project_id: projectId, q: query.trim(), page, page_size: 24 })); }
        catch (nextError) { setError(nextError?.message || '加载生成历史失败'); }
        finally { setLoading(false); }
    }, [type, status, projectId, query, page]);
    useEffect(() => { void load(); }, [load]);
    const syncCloudTasks = useCallback(async ({ silent = false } = {}) => {
        if (syncing) return;
        setSyncing(true);
        if (!silent) setError('');
        try {
            await syncPendingGenerationJobs(8);
            await load();
        } catch (nextError) {
            if (!silent) setError(nextError?.message || '同步云端任务失败');
        } finally {
            setSyncing(false);
        }
    }, [load, syncing]);
    useEffect(() => {
        if (initialCloudSyncRef.current) return;
        initialCloudSyncRef.current = true;
        void syncCloudTasks({ silent: true });
    }, [syncCloudTasks]);
    useEffect(() => { setPage(1); }, [type, status, projectId, query]);
    useEffect(() => {
        listProjects().then((items) => setProjects(Array.isArray(items) ? items : [])).catch(() => setProjects([]));
    }, []);
    useEffect(() => {
        setProjectId(initialProjectId ? String(initialProjectId) : '');
        setPage(1);
    }, [initialProjectId]);

    const totalPages = Math.max(1, Math.ceil((data.total || 0) / (data.page_size || 24)));
    const counts = useMemo(() => `${data.total || 0} 条记录`, [data.total]);
    const projectNames = useMemo(() => new Map(projects.map((project) => [String(project.id), project.name || `项目 #${project.id}`])), [projects]);
    const importCloudTask = async () => {
        if (syncing) return;
        const cloudTaskId = window.prompt(t('请输入腾讯云 AIGC 云端任务 ID'))?.trim();
        if (!cloudTaskId) return;
        setSyncing(true);
        setError('');
        try {
            await importVODGenerationTask(cloudTaskId);
            setQuery(cloudTaskId);
            setPage(1);
            await load();
        } catch (nextError) {
            setError(nextError?.message || '导入云端任务失败');
        } finally {
            setSyncing(false);
        }
    };
    const remove = async (id) => {
        if (!window.confirm(t('仅删除历史元数据，不会删除腾讯云媒体文件。确定继续吗？'))) return;
        await deleteGenerationJob(id);
        setSelectedId(null);
        load();
    };

    return (
        <div className="min-h-full bg-[#fbfaf7] px-5 py-7 sm:px-8 lg:px-10">
            <section className="mx-auto max-w-[1320px]">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#ebe6db] pb-6">
                    <div><div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#b2872c]"><Database size={13} /> Generation Archive</div><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.03em] text-[#28251f]">{t('生成历史')}</h1><p className="mt-2 text-[12px] text-gray-400">{t('统一查看首页、工具、画布与 Agent 的生成任务和素材记录')}</p></div>
                    <div className="flex items-center gap-2"><button type="button" onClick={() => void importCloudTask()} disabled={loading || syncing} className="flex items-center gap-2 rounded-lg border border-[#e4ded0] bg-white px-3 py-2 text-[11.5px] text-gray-500 hover:bg-[#faf8f2] disabled:opacity-50"><Database size={13} />{t('导入云端任务')}</button><button type="button" onClick={() => void syncCloudTasks()} disabled={loading || syncing} className="flex items-center gap-2 rounded-lg border border-[#e4ded0] bg-white px-3 py-2 text-[11.5px] text-gray-500 hover:bg-[#faf8f2] disabled:opacity-50"><RefreshCw size={13} className={loading || syncing ? 'animate-spin' : ''} />{syncing ? t('同步云端中...') : t('刷新并同步')}</button></div>
                </header>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                    <div className="inline-flex rounded-xl border border-[#e8e3d8] bg-white p-1">{FILTERS.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setType(id)} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11.5px] transition ${type === id ? 'bg-[#f4ead0] font-medium text-[#73530d]' : 'text-gray-400 hover:text-gray-600'}`}><Icon size={13} />{t(label)}</button>)}</div>
                    <select id="generation-history-status" name="generation-history-status" value={status} onChange={(event) => setStatus(event.target.value)} aria-label={t('任务状态')} className="h-9 rounded-lg border border-[#e5dfd2] bg-white px-3 text-[11.5px] text-gray-500 outline-none focus:border-[#d4aa42]"><option value="">{t('全部状态')}</option>{Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{t(item.label)}</option>)}</select>
                    <select id="generation-history-project" name="generation-history-project" value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label={t('画布项目')} className="h-9 max-w-[220px] rounded-lg border border-[#e5dfd2] bg-white px-3 text-[11.5px] text-gray-500 outline-none focus:border-[#d4aa42]"><option value="">{t('全部画布项目')}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name || `项目 #${project.id}`}</option>)}</select>
                    <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-[#e5dfd2] bg-white px-3 text-gray-400 sm:max-w-[340px]"><Search size={14} /><input id="generation-history-search" name="generation-history-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜索提示词、模型或云端任务 ID')} className="w-full bg-transparent text-[11.5px] text-[#403c34] outline-none" /></label>
                    <span className="ml-auto text-[10.5px] text-gray-400">{counts}</span>
                </div>

                {error && <div className="mt-5 rounded-xl border border-red-100 bg-red-50 p-4 text-[12px] text-red-600">{error}</div>}
                {loading ? <div className="flex h-72 items-center justify-center"><Loader2 size={24} className="animate-spin text-[#b98b25]" /></div> : !data.items?.length ? (
                    <div className="mt-8 flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#ddd6c7] bg-white text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f6edd8] text-[#9e751c]"><History size={25} /></div><h2 className="mt-4 text-[14px] font-semibold text-[#514b40]">{t('暂无生成历史')}</h2><p className="mt-2 text-[11px] text-gray-400">{t('从首页、图片、视频或 Agent 发起任务后，记录会自动出现在这里。')}</p></div>
                ) : <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{data.items.map(({ job, preview }) => {
                    const previewIsVideo = job.type === 'video' || preview?.media_type === 'video';
                    return <article key={job.id} className="group overflow-hidden rounded-2xl border border-[#e8e2d6] bg-white text-left shadow-[0_6px_20px_rgba(58,49,28,0.04)] transition hover:-translate-y-0.5 hover:border-[#d8c99e] hover:shadow-[0_12px_28px_rgba(58,49,28,0.09)]"><div className="relative aspect-[16/10] overflow-hidden">{previewIsVideo ? <button type="button" onClick={() => setVideoPreview({ job, asset: preview })} className="block h-full w-full cursor-pointer text-left" aria-label={t('播放视频预览')}><MediaPreview job={job} asset={preview} /></button> : <MediaPreview job={job} asset={preview} />}<div className="absolute left-2.5 top-2.5"><StatusBadge status={job.status} /></div>{job.status === 'running' && <div className="absolute inset-x-0 bottom-0 h-1 bg-black/10"><div className="h-full bg-[#e1ae35]" style={{ width: `${job.progress || 0}%` }} /></div>}</div><button type="button" onClick={() => setSelectedId(job.id)} className="block w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-[12.5px] font-semibold text-[#3e3a32]">{job.model_name || (job.type === 'agent' ? 'AgentLoop' : t('生成任务'))}</h2><div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9.5px] text-gray-400"><span>{SOURCE_LABEL[job.source] || job.source}</span><span>·</span><span>{job.model_version || job.type}</span>{job.project_id && <><span>·</span><span className="max-w-[130px] truncate text-[#9a741f]">{projectNames.get(String(job.project_id)) || `项目 #${job.project_id}`}</span></>}</div></div><ChevronRight size={15} className="mt-1 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-[#a77c1c]" /></div><p className="mt-3 line-clamp-2 min-h-[34px] text-[10.5px] leading-[17px] text-gray-500">{job.prompt || t('无提示词')}</p><div className="mt-3 flex items-center justify-between border-t border-[#f0ede6] pt-3 text-[9.5px] text-gray-400"><span className="flex items-center gap-1"><Clock size={11} />{formatTime(job.created_at)}</span><span className="flex items-center gap-1">{job.storage_mode === 'Permanent' ? <Database size={11} /> : <Cloud size={11} />}{job.storage_mode === 'Permanent' ? t('永久') : t('云端')}</span></div></button></article>;
                })}</div>}

                {totalPages > 1 && <div className="mt-7 flex items-center justify-center gap-3"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-[#e6e0d4] bg-white px-3 py-2 text-[11px] text-gray-500 disabled:opacity-30">{t('上一页')}</button><span className="text-[10.5px] text-gray-400">{page} / {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-[#e6e0d4] bg-white px-3 py-2 text-[11px] text-gray-500 disabled:opacity-30">{t('下一页')}</button></div>}
            </section>
            {selectedId && <HistoryDetail id={selectedId} onClose={() => setSelectedId(null)} onDelete={remove} onSynced={load} onSendToCanvas={handleSendToCanvas} />}
            {videoPreview && <HistoryVideoModal job={videoPreview.job} asset={videoPreview.asset} onClose={() => setVideoPreview(null)} />}
            {sendNodes && (
                <SendToCanvasDialog
                    assets={sendNodes}
                    onClose={() => setSendNodes(null)}
                    onToast={(message) => setToast(message)}
                    onSent={(projectId) => {
                        setSendNodes(null);
                        if (projectId) onOpenCanvas?.(projectId);
                    }}
                />
            )}
            {toast && <div className="fixed bottom-6 left-1/2 z-[140] -translate-x-1/2 rounded-full bg-[#3e3a32] px-4 py-2 text-[12px] text-white shadow-lg">{toast}</div>}
        </div>
    );
}
