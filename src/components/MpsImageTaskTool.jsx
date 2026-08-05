import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Check, Clipboard, Download, ExternalLink, FileImage, Loader2,
    RotateCcw, ShieldCheck, Sparkles, UploadCloud, X,
} from 'lucide-react';
import { listCredentials } from '../api/credential';
import { uploadMpsImage, uploadMpsImageFromURL } from '../api/mps';
import { createGenerationTracker } from '../api/generationHistory';
import ImageComparisonPanel from './ImageComparisonPanel';

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

/**
 * MPS 单图异步任务工作台。
 * 上传、URL 转存、COS 输入、任务轮询、结果展示共用，具体图片能力仅通过 tool 配置不同。
 */
export default function MpsImageTaskTool({ tool }) {
    const inputRef = useRef(null);
    const [inputMode, setInputMode] = useState('upload');
    const [source, setSource] = useState(null);
    const [urlValue, setUrlValue] = useState('');
    const [dragging, setDragging] = useState(false);
    const [storage, setStorage] = useState({ bucket: '', region: 'ap-guangzhou', configured: false });
    const [loading, setLoading] = useState(false);
    const [stage, setStage] = useState('');
    const [error, setError] = useState('');
    const [taskId, setTaskId] = useState('');
    const [results, setResults] = useState([]);
    const [showDryRun, setShowDryRun] = useState(false);

    useEffect(() => () => {
        if (source?.kind === 'file' && source.preview) URL.revokeObjectURL(source.preview);
    }, [source]);

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
            object: source ? (source.kind === 'url' ? '<URL 转存后的 COS 对象>' : '<本地上传后的 COS 对象>') : '<待上传图片>',
        },
        outputBucket: storage.bucket || '<MPS 输出 COS Bucket>',
        outputRegion: storage.region,
    }), [source, storage, tool]);

    const setFileSource = (file) => {
        try {
            validateFile(file);
            if (source?.kind === 'file' && source.preview) URL.revokeObjectURL(source.preview);
            setSource({ kind: 'file', file, preview: URL.createObjectURL(file), name: file.name });
            setError(''); setResults([]); setTaskId('');
        } catch (uploadError) {
            setError(uploadError.message || '图片无效');
        }
    };

    const setURLSource = () => {
        try {
            const url = validateURL(urlValue.trim());
            if (source?.kind === 'file' && source.preview) URL.revokeObjectURL(source.preview);
            setSource({ kind: 'url', url, preview: url, name: url });
            setUrlValue(''); setError(''); setResults([]); setTaskId('');
        } catch (urlError) {
            setError(urlError.message || '图片 URL 无效');
        }
    };

    const reset = () => {
        if (source?.kind === 'file' && source.preview) URL.revokeObjectURL(source.preview);
        setSource(null); setResults([]); setTaskId(''); setError(''); setStage(''); setUrlValue('');
    };

    const submit = async () => {
        setError(''); setResults([]); setTaskId('');
        if (!source) { setError('请先上传图片或输入图片 URL'); return; }
        if (!storage.configured) { setError('请先在右上角 API 设置中配置腾讯云媒体服务凭证'); return; }
        if (!storage.bucket) { setError('请先在 API 设置中填写 MPS 输出 COS Bucket'); return; }

        setLoading(true);
        const tracker = await createGenerationTracker({
            source: 'mps_tool', type: 'mps', provider: 'tencent-mps', prompt: '',
            modelName: tool.title, modelVersion: tool.id, storageMode: 'Permanent',
            parameters: { bucket: storage.bucket, region: storage.region, input_mode: source.kind },
            assets: [{ role: 'reference', ordinal: 0, media_type: 'image', mime_type: source.file?.type || '', file_size: source.file?.size || 0, metadata: { name: source.name || '', direct_url: source.kind === 'url' } }],
        });
        try {
            setStage(source.kind === 'file' ? '正在上传图片到 COS…' : '正在安全转存 URL 图片到 COS…');
            await tracker?.stage('upload_start', { progress: 8, message: '正在上传输入图片' });
            const input = source.kind === 'file'
                ? await uploadMpsImage(source.file)
                : await uploadMpsImageFromURL(source.url);
            await tracker?.stage('upload_done', { progress: 25, message: '输入图片已保存到 COS' });
            setStage(tool.submittingText);
            const created = await tool.createTask({ input, outputBucket: storage.bucket, outputRegion: storage.region });
            setTaskId(created.taskId);
            await tracker?.stage('task_created', { progress: 40, message: tool.submittingText, taskId: created.taskId });
            setStage(tool.processingText);
            const completed = await tool.pollTask(created.taskId, storage.region, {
                onPoll: ({ attempt, status }) => {
                    setStage(`${tool.processingText} · 第 ${attempt} 次查询`);
                    tracker?.stage('polling', { progress: 60, status, message: tool.processingText });
                },
            });
            setResults(completed.urls);
            setStage(tool.completedText);
            await tracker?.complete({ urls: completed.urls, mediaType: 'image' });
        } catch (taskError) {
            setError(taskError?.message || `${tool.title}任务失败`);
            setStage('');
            await tracker?.fail(taskError);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-full bg-[#f6f5ef] text-[#292720]">
            <div className="mx-auto max-w-[1420px] px-5 py-8 lg:px-8">
                <header className="mb-7 flex flex-col gap-4 border-b border-[#dfdacd] pb-7 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#b4871e]"><span className="h-px w-8 bg-[#ddb64d]" />MPS Image Processing</div>
                        <h1 className="mt-3 text-[30px] font-semibold tracking-[-0.035em] text-[#26231d] sm:text-[36px]">{tool.title}</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#858074]">{tool.intro}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`rounded-full px-3 py-1.5 text-xs ${storage.configured && storage.bucket ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{storage.configured && storage.bucket ? '服务已就绪' : '需要完成 API 设置'}</span>
                        <button type="button" onClick={reset} className="flex items-center gap-1.5 rounded-xl border border-[#ddd8cb] bg-white px-3.5 py-2 text-sm text-[#6e685c] hover:bg-[#fbfaf6]"><RotateCcw size={14} />重置</button>
                    </div>
                </header>

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(350px,0.8fr)]">
                    <section className="rounded-[22px] border border-[#e7e1d2] bg-white p-5 shadow-[0_8px_30px_rgba(61,48,20,0.04)] sm:p-6">
                        <div className="mb-4"><h2 className="text-[17px] font-semibold text-[#28251f]">图片输入</h2><p className="mt-1 text-xs leading-5 text-[#948d7f]">{tool.inputDescription}</p></div>
                        <div className="mb-4 flex gap-2"><button type="button" onClick={() => setInputMode('upload')} className={`rounded-[10px] px-4 py-2 text-sm font-medium ${inputMode === 'upload' ? 'bg-[#f4c74f] text-[#362a0d]' : 'border border-[#e3dfd3] bg-[#f7f6f1] text-[#777266]'}`}>本地上传</button><button type="button" onClick={() => setInputMode('url')} className={`rounded-[10px] px-4 py-2 text-sm font-medium ${inputMode === 'url' ? 'bg-[#f4c74f] text-[#362a0d]' : 'border border-[#e3dfd3] bg-[#f7f6f1] text-[#777266]'}`}>URL 输入</button></div>

                        {source && <div className="mb-4 overflow-hidden rounded-2xl border border-[#e8e3d8] bg-[#f7f6f2]"><div className="relative flex min-h-72 items-center justify-center"><img src={source.preview} alt={tool.title} className="max-h-[480px] w-full object-contain" /><button type="button" onClick={reset} className="absolute right-3 top-3 rounded-full bg-black/65 p-2 text-white hover:bg-black"><X size={15} /></button></div><div className="truncate border-t border-[#e8e3d8] bg-white px-4 py-3 text-xs text-[#756f63]">{source.kind === 'file' ? source.name : source.url}</div></div>}
                        {!source && inputMode === 'upload' && <div role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); setFileSource(event.dataTransfer.files?.[0]); }} className={`flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 text-center transition ${dragging ? 'border-[#d8a620] bg-[#fff9df]' : 'border-[#dcd6c8] bg-[#fbfaf7] hover:border-[#d1ae52] hover:bg-[#fffdf5]'}`}><input ref={inputRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(event) => { setFileSource(event.target.files?.[0]); event.target.value = ''; }} /><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#b59748] shadow-[0_8px_24px_rgba(80,62,20,0.08)]"><UploadCloud size={25} /></div><p className="mt-4 text-sm font-medium text-[#716b60]">点击或拖拽图片到此处上传</p><p className="mt-2 text-xs text-[#aaa397]">支持 JPG / PNG / WEBP · 最大 20MB</p></div>}
                        {!source && inputMode === 'url' && <div className="flex min-h-48 flex-col justify-center rounded-2xl border border-dashed border-[#dcd6c8] bg-[#fbfaf7] p-5"><label className="text-xs font-medium text-[#746e63]">公开可访问的图片 URL</label><div className="mt-2 flex gap-2"><input value={urlValue} onChange={(event) => setUrlValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') setURLSource(); }} placeholder="https://example.com/photo.png" className="min-w-0 flex-1 rounded-xl border border-[#ddd8cc] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#c89c2f]" /><button type="button" onClick={setURLSource} disabled={!urlValue.trim()} className="rounded-xl bg-[#292720] px-4 text-sm font-medium text-white disabled:opacity-35">添加</button></div></div>}
                    </section>

                    <aside className="xl:sticky xl:top-6 xl:self-start"><div className="overflow-hidden rounded-[22px] border border-[#e3ddcf] bg-white shadow-[0_16px_50px_rgba(61,48,20,0.08)]"><div className="border-b border-[#eee9dd] px-6 py-5"><h2 className="text-lg font-semibold">参数配置</h2><p className="mt-1 text-xs text-[#999184]">{tool.parameterLabel}</p></div><div className="space-y-5 p-6"><div className="rounded-xl border border-[#ece4ca] bg-[#fffbee] px-4 py-3 text-sm leading-6 text-[#6f613a]"><div className="flex items-center gap-2 font-semibold text-[#51441e]"><Sparkles size={15} />无需额外参数</div><p className="mt-1 text-xs">{tool.parameterDescription}</p></div><div className="rounded-xl bg-[#f8f5e9] px-4 py-3 text-xs leading-5 text-[#7c704f]"><div className="flex items-center gap-2 font-medium text-[#5e512e]"><FileImage size={14} />输入与输出 COS</div><div className="mt-1 break-all">{storage.bucket || '请在 API 设置中填写 MPS 输出 COS Bucket'}</div><div>{storage.region}</div></div>{tool.notice && <div className="flex items-start gap-2 rounded-xl border border-[#e4e0d5] bg-[#faf9f5] px-4 py-3 text-xs leading-5 text-[#777064]"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#927a3d]" />{tool.notice}</div>}{error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-600">{error}</div>}{stage && !error && <div className="flex items-center gap-2 rounded-xl border border-[#eadcae] bg-[#fff9e5] px-4 py-3 text-sm text-[#806419]">{loading ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{stage}</div>}<button type="button" onClick={submit} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#f2c54e] px-4 py-3.5 text-sm font-semibold text-[#34290c] shadow-[0_8px_20px_rgba(225,174,43,0.22)] transition hover:-translate-y-0.5 hover:bg-[#f6cd60] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60">{loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{loading ? '任务处理中…' : '提交任务'}</button><button type="button" onClick={() => setShowDryRun((value) => !value)} className="w-full rounded-xl border border-[#ddd8cb] bg-[#f7f6f1] px-4 py-3 text-sm font-medium text-[#625d52] hover:bg-[#efede5]">Dry Run（预览请求体）</button>{showDryRun && <div className="relative"><pre className="max-h-72 overflow-auto rounded-xl bg-[#24231f] p-4 text-[11px] leading-5 text-[#f6eecf]">{JSON.stringify(dryRunPayload, null, 2)}</pre><button type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(dryRunPayload, null, 2))} className="absolute right-2 top-2 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20" title="复制请求体"><Clipboard size={13} /></button></div>}</div></div></aside>
                </div>

                {results.length > 0 && (tool.comparison && source?.preview ? (
                    <div>
                        <ImageComparisonPanel
                            sourceURL={source.preview}
                            resultURL={results[0]}
                            title={tool.resultTitle}
                            downloadPrefix={`${tool.id}-1`}
                        />
                        {results.length > 1 && <section className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{results.slice(1).map((url, index) => <a key={`${url}-${index + 1}`} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-[#e6e1d6] bg-white p-2"><img src={url} alt={`${tool.resultTitle} ${index + 2}`} className="aspect-square w-full object-contain" /></a>)}</section>}
                    </div>
                ) : (
                    <section className="mt-7 rounded-[22px] border border-[#e3ddcf] bg-white p-6 shadow-[0_16px_50px_rgba(61,48,20,0.06)]"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-lg font-semibold">{tool.resultTitle}</h2>{taskId && <p className="mt-1 text-xs text-[#999184]">TaskId: {taskId}</p>}</div><span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"><Check size={13} />处理完成</span></div><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{results.map((url, index) => <article key={`${url}-${index}`} className="group overflow-hidden rounded-2xl border border-[#e6e1d6] bg-[#f8f7f2]"><div className="aspect-square overflow-hidden"><img src={url} alt={`${tool.resultTitle} ${index + 1}`} className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.02]" /></div><div className="flex items-center justify-between border-t border-[#e6e1d6] bg-white px-4 py-3"><span className="text-sm font-medium">结果 {index + 1}</span><div className="flex gap-2"><a href={url} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-[#777064] hover:bg-[#f3f1e9]" title="新窗口打开"><ExternalLink size={15} /></a><a href={url} download={`${tool.id}-${index + 1}.png`} className="rounded-lg p-2 text-[#777064] hover:bg-[#f3f1e9]" title="下载"><Download size={15} /></a></div></div></article>)}</div></section>
                ))}
            </div>
        </div>
    );
}
