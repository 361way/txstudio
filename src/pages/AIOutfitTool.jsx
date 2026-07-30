import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowUpRight, Check, ChevronDown, Clipboard, UploadCloud, Download,
    ExternalLink, Image as ImageIcon, Loader2, RotateCcw, Shirt, Sparkles, X,
} from 'lucide-react';
import { listCredentials } from '../api/credential';
import { createAiTryOnTask, pollAiTryOnTask } from '../api/mps';
import { uploadImageToVod } from '../vodAdapter';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const LOCAL_SERVICE_URL = import.meta.env.DEV ? 'http://127.0.0.1:8080' : window.location.origin;
const UPLOAD_CONTEXT = { credentials: {}, useProxy: true, localServerUrl: LOCAL_SERVICE_URL };

const MODEL_OPTIONS = [
    { value: 'WAND-tryon-1.0-lite', label: 'WAND-tryon-1.0-lite', hint: '速度优先' },
    { value: 'WAND-tryon-1.0-flash', label: 'WAND-tryon-1.0-flash', hint: '均衡，默认' },
    { value: 'WAND-tryon-1.0-pro', label: 'WAND-tryon-1.0-pro', hint: '效果优先' },
];

function validateFile(file) {
    if (!ACCEPTED_TYPES.has(file.type)) throw new Error('仅支持 JPG、PNG、WEBP 图片');
    if (file.size > MAX_FILE_SIZE) throw new Error('单张图片不能超过 20MB');
}

function validatePublicUrl(value) {
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error('请输入完整的图片 URL'); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('图片 URL 必须使用 HTTP 或 HTTPS');
    return parsed.toString();
}

function SourceCard({ title, subtitle, multiple = false, maxCount = 1, items, onChange }) {
    const [tab, setTab] = useState('upload');
    const [urlValue, setUrlValue] = useState('');
    const [dragging, setDragging] = useState(false);
    const [inputError, setInputError] = useState('');
    const inputRef = useRef(null);

    const addFiles = (files) => {
        try {
            const selected = Array.from(files || []);
            if (!selected.length) return;
            const available = Math.max(0, maxCount - items.length);
            const next = selected.slice(0, multiple ? available : 1).map((file) => {
                validateFile(file);
                return {
                    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
                    kind: 'file',
                    file,
                    preview: URL.createObjectURL(file),
                    name: file.name,
                };
            });
            setInputError('');
            onChange(multiple ? [...items, ...next] : next);
        } catch (error) {
            setInputError(error.message || '图片无效');
        }
    };

    const addUrl = () => {
        try {
            const url = validatePublicUrl(urlValue.trim());
            const item = { id: crypto.randomUUID?.() || `${Date.now()}`, kind: 'url', url, preview: url, name: url };
            setInputError('');
            onChange(multiple ? [...items, item].slice(0, maxCount) : [item]);
            setUrlValue('');
        } catch (error) {
            setInputError(error.message || '图片 URL 无效');
        }
    };

    const remove = (id) => {
        const target = items.find((item) => item.id === id);
        if (target?.kind === 'file') URL.revokeObjectURL(target.preview);
        onChange(items.filter((item) => item.id !== id));
    };

    return (
        <section className="rounded-[22px] border border-[#e7e1d2] bg-white p-5 shadow-[0_8px_30px_rgba(61,48,20,0.04)] sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#28251f]">{title}</h2>
                    <p className="mt-1 text-xs leading-5 text-[#948d7f]">{subtitle}</p>
                </div>
                <span className="rounded-full bg-[#f6f3e8] px-2.5 py-1 text-[11px] font-medium text-[#8a7440]">
                    {items.length}/{maxCount}
                </span>
            </div>

            <div className="mb-4 flex gap-2">
                <button type="button" onClick={() => setTab('upload')} className={`rounded-[10px] px-4 py-2 text-sm font-medium transition ${tab === 'upload' ? 'bg-[#f4c74f] text-[#362a0d]' : 'border border-[#e3dfd3] bg-[#f7f6f1] text-[#777266]'}`}>本地上传</button>
                <button type="button" onClick={() => setTab('url')} className={`rounded-[10px] px-4 py-2 text-sm font-medium transition ${tab === 'url' ? 'bg-[#f4c74f] text-[#362a0d]' : 'border border-[#e3dfd3] bg-[#f7f6f1] text-[#777266]'}`}>URL 输入</button>
            </div>

            {items.length > 0 && (
                <div className={`mb-4 grid gap-3 ${multiple ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1'}`}>
                    {items.map((item) => (
                        <div key={item.id} className={`group relative overflow-hidden rounded-2xl border border-[#e8e3d8] bg-[#f7f6f2] ${multiple ? 'aspect-square' : 'h-56 sm:h-64'}`}>
                            <img src={item.preview} alt="" className="h-full w-full object-contain" />
                            <button type="button" onClick={() => remove(item.id)} className="absolute right-2 top-2 rounded-full bg-black/65 p-1.5 text-white opacity-90 backdrop-blur hover:bg-black"><X size={14} /></button>
                            <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/65 to-transparent px-3 pb-2 pt-8 text-[11px] text-white">{item.kind === 'file' ? item.name : 'URL 图片'}</div>
                        </div>
                    ))}
                </div>
            )}

            {items.length < maxCount && tab === 'upload' && (
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }}
                    onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
                    className={`flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 text-center transition sm:min-h-56 ${dragging ? 'border-[#d8a620] bg-[#fff9df]' : 'border-[#dcd6c8] bg-[#fbfaf7] hover:border-[#d1ae52] hover:bg-[#fffdf5]'}`}
                >
                    <input ref={inputRef} type="file" hidden multiple={multiple} accept="image/jpeg,image/png,image/webp" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#b59748] shadow-[0_8px_24px_rgba(80,62,20,0.08)]"><UploadCloud size={25} /></div>
                    <p className="mt-4 text-sm font-medium text-[#716b60]">点击或拖拽图片到此处上传</p>
                    <p className="mt-2 text-xs text-[#aaa397]">支持 JPG / PNG / WEBP · 最大 20MB</p>
                </div>
            )}

            {items.length < maxCount && tab === 'url' && (
                <div className="flex min-h-36 flex-col justify-center rounded-2xl border border-dashed border-[#dcd6c8] bg-[#fbfaf7] p-5">
                    <label className="text-xs font-medium text-[#746e63]">公开可访问的图片 URL</label>
                    <div className="mt-2 flex gap-2">
                        <input value={urlValue} onChange={(event) => setUrlValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addUrl(); }} placeholder="https://example.com/image.png" className="min-w-0 flex-1 rounded-xl border border-[#ddd8cc] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#c89c2f]" />
                        <button type="button" onClick={addUrl} disabled={!urlValue.trim()} className="rounded-xl bg-[#292720] px-4 text-sm font-medium text-white disabled:opacity-35">添加</button>
                    </div>
                </div>
            )}
            {inputError && <p className="mt-3 text-xs text-red-500">{inputError}</p>}
        </section>
    );
}

export default function AIOutfitTool() {
    const [modelImages, setModelImages] = useState([]);
    const [garmentImages, setGarmentImages] = useState([]);
    const [model, setModel] = useState('WAND-tryon-1.0-flash');
    const [prompt, setPrompt] = useState('');
    const [resolution, setResolution] = useState('2K');
    const [storage, setStorage] = useState({ bucket: '', region: 'ap-guangzhou', configured: false });
    const [loading, setLoading] = useState(false);
    const [stage, setStage] = useState('');
    const [error, setError] = useState('');
    const [taskId, setTaskId] = useState('');
    const [results, setResults] = useState([]);
    const [showDryRun, setShowDryRun] = useState(false);

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

    const dryRunPayload = useMemo(() => ({
        InputInfo: { Type: 'URL', UrlInputInfo: { Url: modelImages[0]?.kind === 'url' ? modelImages[0].url : '<本地图片上传后 URL>' } },
        OutputStorage: { Type: 'COS', CosOutputStorage: { Bucket: storage.bucket || '<请在 API 设置中配置>', Region: storage.region } },
        ImageTask: { AiTryOnConfig: { Model: model, Resolution: resolution, ...(prompt.trim() ? { Prompt: prompt.trim() } : {}) } },
        AddOnParameter: { ImageSet: garmentImages.map((item) => ({ Image: { Type: 'URL', UrlInputInfo: { Url: item.kind === 'url' ? item.url : '<本地图片上传后 URL>' } } })) },
    }), [garmentImages, model, modelImages, prompt, resolution, storage]);

    const reset = () => {
        [...modelImages, ...garmentImages].forEach((item) => { if (item.kind === 'file') URL.revokeObjectURL(item.preview); });
        setModelImages([]); setGarmentImages([]); setResults([]); setTaskId(''); setError(''); setStage(''); setPrompt('');
    };

    const resolveUrl = async (item, label) => {
        if (item.kind === 'url') return validatePublicUrl(item.url);
        setStage(`正在上传${label}…`);
        const uploaded = await uploadImageToVod(item.file, UPLOAD_CONTEXT);
        if (!uploaded.mediaUrl) throw new Error(`${label}上传成功，但未返回公网 URL`);
        return uploaded.mediaUrl;
    };

    const submit = async () => {
        setError(''); setResults([]); setTaskId('');
        if (!modelImages.length) { setError('请上传或输入一张模特图'); return; }
        if (!garmentImages.length) { setError('请至少上传或输入一张服装图'); return; }
        if (!storage.configured) { setError('请先在右上角 API 设置中配置腾讯云媒体服务凭证'); return; }
        if (!storage.bucket) { setError('请先在 API 设置中配置 MPS 输出 COS Bucket'); return; }

        setLoading(true);
        try {
            const modelImageUrl = await resolveUrl(modelImages[0], '模特图');
            const garmentImageUrls = [];
            for (let index = 0; index < garmentImages.length; index += 1) {
                garmentImageUrls.push(await resolveUrl(garmentImages[index], `服装图 ${index + 1}`));
            }
            setStage('正在提交 AI 换装任务…');
            const created = await createAiTryOnTask({
                modelImageUrl, garmentImageUrls, model, prompt, resolution,
                outputBucket: storage.bucket, outputRegion: storage.region,
            });
            setTaskId(created.taskId);
            setStage('AI 正在试穿，请稍候…');
            const completed = await pollAiTryOnTask(created.taskId, storage.region, {
                onPoll: ({ attempt }) => setStage(`AI 正在试穿 · 第 ${attempt} 次查询`),
            });
            setResults(completed.urls);
            setStage('换装完成');
        } catch (submitError) {
            setError(submitError?.message || 'AI 换装任务失败');
            setStage('');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-full bg-[#f6f5ef] text-[#292720]">
            <div className="mx-auto max-w-[1460px] px-5 py-8 lg:px-8">
                <header className="mb-7 flex flex-col gap-4 border-b border-[#dfdacd] pb-7 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#b4871e]"><span className="h-px w-8 bg-[#ddb64d]" />MPS AI Try-On</div>
                        <h1 className="mt-3 text-[30px] font-semibold tracking-[-0.035em] text-[#26231d] sm:text-[36px]">AI 换装工作台</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#858074]">上传一张模特图和最多四张服装图，由腾讯云 MPS WAND 模型生成自然、真实的试穿效果。</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`rounded-full px-3 py-1.5 text-xs ${storage.configured && storage.bucket ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{storage.configured && storage.bucket ? '服务已就绪' : '需要完成 API 设置'}</span>
                        <button type="button" onClick={reset} className="flex items-center gap-1.5 rounded-xl border border-[#ddd8cb] bg-white px-3.5 py-2 text-sm text-[#6e685c] hover:bg-[#fbfaf6]"><RotateCcw size={14} />重置</button>
                    </div>
                </header>

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(350px,0.8fr)]">
                    <div className="space-y-6">
                        <SourceCard title="模特图" subtitle="正面、清晰、人物完整的模特照片效果最佳" maxCount={1} items={modelImages} onChange={setModelImages} />
                        <SourceCard title="服装图" subtitle="支持 1–4 张服饰图；主体清晰、背景简洁更容易获得稳定效果" multiple maxCount={4} items={garmentImages} onChange={setGarmentImages} />
                    </div>

                    <aside className="xl:sticky xl:top-6 xl:self-start">
                        <div className="overflow-hidden rounded-[22px] border border-[#e3ddcf] bg-white shadow-[0_16px_50px_rgba(61,48,20,0.08)]">
                            <div className="border-b border-[#eee9dd] px-6 py-5"><h2 className="text-lg font-semibold">参数配置</h2><p className="mt-1 text-xs text-[#999184]">官方 WAND 1.0 换装模型</p></div>
                            <div className="space-y-5 p-6">
                                <label className="block"><span className="text-sm font-semibold">换装模型</span><div className="relative mt-2"><select value={model} onChange={(event) => setModel(event.target.value)} className="w-full appearance-none rounded-xl border border-[#ddd7ca] bg-[#fbfaf6] px-3.5 py-3 pr-10 text-sm outline-none focus:border-[#c69625]">{MODEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}（{option.hint}）</option>)}</select><ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#837b6e]" /></div></label>
                                <label className="block"><span className="text-sm font-semibold">换装指令 <span className="font-normal text-[#aaa295]">（可选）</span></span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} maxLength={500} placeholder="如：保持姿势自然，呈现专业电商棚拍质感" className="mt-2 w-full resize-none rounded-xl border border-[#ddd7ca] bg-[#fbfaf6] px-3.5 py-3 text-sm leading-6 outline-none focus:border-[#c69625]" /><span className="mt-1 block text-right text-[11px] text-[#aaa295]">{prompt.length}/500</span></label>
                                <label className="block"><span className="text-sm font-semibold">输出尺寸</span><select value={resolution} onChange={(event) => setResolution(event.target.value)} className="mt-2 w-full rounded-xl border border-[#ddd7ca] bg-[#fbfaf6] px-3.5 py-3 text-sm outline-none focus:border-[#c69625]"><option value="1K">1K · 快速预览</option><option value="2K">2K · 默认推荐</option><option value="4K">4K · 高清输出</option></select></label>
                                <div className="rounded-xl bg-[#f8f5e9] px-4 py-3 text-xs leading-5 text-[#7c704f]"><div className="flex items-center gap-2 font-medium text-[#5e512e]"><ImageIcon size={14} />输出存储</div><div className="mt-1 break-all">{storage.bucket || '请在 API 设置中填写 MPS 输出 COS Bucket'}</div><div>{storage.region}</div></div>
                                {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-600">{error}</div>}
                                {stage && !error && <div className="flex items-center gap-2 rounded-xl border border-[#eadcae] bg-[#fff9e5] px-4 py-3 text-sm text-[#806419]">{loading ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{stage}</div>}
                                <button type="button" onClick={submit} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#f2c54e] px-4 py-3.5 text-sm font-semibold text-[#34290c] shadow-[0_8px_20px_rgba(225,174,43,0.22)] transition hover:-translate-y-0.5 hover:bg-[#f6cd60] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60">{loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{loading ? '任务处理中…' : '提交任务'}</button>
                                <button type="button" onClick={() => setShowDryRun((value) => !value)} className="w-full rounded-xl border border-[#ddd8cb] bg-[#f7f6f1] px-4 py-3 text-sm font-medium text-[#625d52] hover:bg-[#efede5]">Dry Run（预览请求体）</button>
                                {showDryRun && <div className="relative"><pre className="max-h-72 overflow-auto rounded-xl bg-[#24231f] p-4 text-[11px] leading-5 text-[#f6eecf]">{JSON.stringify(dryRunPayload, null, 2)}</pre><button type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(dryRunPayload, null, 2))} className="absolute right-2 top-2 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20" title="复制请求体"><Clipboard size={13} /></button></div>}
                            </div>
                        </div>
                    </aside>
                </div>

                {results.length > 0 && (
                    <section className="mt-7 rounded-[22px] border border-[#e3ddcf] bg-white p-6 shadow-[0_16px_50px_rgba(61,48,20,0.06)]">
                        <div className="mb-5 flex items-center justify-between"><div><h2 className="text-lg font-semibold">换装结果</h2>{taskId && <p className="mt-1 text-xs text-[#999184]">TaskId: {taskId}</p>}</div><span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"><Check size={13} />生成完成</span></div>
                        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{results.map((url, index) => <article key={`${url}-${index}`} className="group overflow-hidden rounded-2xl border border-[#e6e1d6] bg-[#f8f7f2]"><div className="aspect-[3/4] overflow-hidden"><img src={url} alt={`AI 换装结果 ${index + 1}`} className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.02]" /></div><div className="flex items-center justify-between border-t border-[#e6e1d6] bg-white px-4 py-3"><span className="text-sm font-medium">结果 {index + 1}</span><div className="flex gap-2"><a href={url} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-[#777064] hover:bg-[#f3f1e9]" title="新窗口打开"><ExternalLink size={15} /></a><a href={url} download={`ai-try-on-${index + 1}.png`} className="rounded-lg p-2 text-[#777064] hover:bg-[#f3f1e9]" title="下载"><Download size={15} /></a></div></div></article>)}</div>
                    </section>
                )}

                <footer className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#9b9488]"><span className="flex items-center gap-1.5"><Shirt size={13} />模型：{model}</span><span className="flex items-center gap-1.5"><ArrowUpRight size={13} />腾讯云 MPS ProcessImage</span><span>模特图 1 张 · 服装图最多 4 张</span></footer>
            </div>
        </div>
    );
}
