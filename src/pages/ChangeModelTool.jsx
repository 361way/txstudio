import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Check, ChevronDown, Clipboard, UploadCloud, Loader2, RotateCcw, Sparkles, UserRound, X,
} from 'lucide-react';
import { listCredentials } from '../api/credential';
import {
    buildChangeModelPayload, createChangeModelTask, pollImageTask,
    uploadMpsImage, uploadMpsImageFromURL, CHANGE_MODEL_BODY_TYPES,
} from '../api/mps';
import { createGenerationTracker } from '../api/generationHistory';
import ImageComparisonPanel from '../components/ImageComparisonPanel';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 20 * 1024 * 1024;

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

function SourceCard({ title, subtitle, items, onChange }) {
    const [tab, setTab] = useState('upload');
    const [urlValue, setUrlValue] = useState('');
    const [dragging, setDragging] = useState(false);
    const [inputError, setInputError] = useState('');
    const inputRef = useRef(null);

    const addFiles = (files) => {
        try {
            const file = Array.from(files || [])[0];
            if (!file) return;
            validateFile(file);
            setInputError('');
            onChange([{ id: crypto.randomUUID?.() || `${Date.now()}`, kind: 'file', file, preview: URL.createObjectURL(file), name: file.name }]);
        } catch (error) {
            setInputError(error.message || '图片无效');
        }
    };

    const addUrl = () => {
        try {
            const url = validatePublicUrl(urlValue.trim());
            setInputError('');
            onChange([{ id: crypto.randomUUID?.() || `${Date.now()}`, kind: 'url', url, preview: url, name: url }]);
            setUrlValue('');
        } catch (error) {
            setInputError(error.message || '图片 URL 无效');
        }
    };

    const remove = (id) => {
        const target = items.find((item) => item.id === id);
        if (target?.kind === 'file') URL.revokeObjectURL(target.preview);
        onChange([]);
    };

    return (
        <section className="rounded-[22px] border border-[#e7e1d2] bg-white p-5 shadow-[0_8px_30px_rgba(61,48,20,0.04)] sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#28251f]">{title}</h2>
                    <p className="mt-1 text-xs leading-5 text-[#948d7f]">{subtitle}</p>
                </div>
                <span className="rounded-full bg-[#f6f3e8] px-2.5 py-1 text-[11px] font-medium text-[#8a7440]">{items.length}/1</span>
            </div>
            <div className="mb-4 flex gap-2">
                <button type="button" onClick={() => setTab('upload')} className={`rounded-[10px] px-4 py-2 text-sm font-medium transition ${tab === 'upload' ? 'bg-[#f4c74f] text-[#362a0d]' : 'border border-[#e3dfd3] bg-[#f7f6f1] text-[#777266]'}`}>本地上传</button>
                <button type="button" onClick={() => setTab('url')} className={`rounded-[10px] px-4 py-2 text-sm font-medium transition ${tab === 'url' ? 'bg-[#f4c74f] text-[#362a0d]' : 'border border-[#e3dfd3] bg-[#f7f6f1] text-[#777266]'}`}>URL 输入</button>
            </div>
            {items.length > 0 ? (
                <div className="group relative h-56 overflow-hidden rounded-2xl border border-[#e8e3d8] bg-[#f7f6f2] sm:h-64">
                    <img src={items[0].preview} alt="" className="h-full w-full object-contain" />
                    <button type="button" onClick={() => remove(items[0].id)} className="absolute right-2 top-2 rounded-full bg-black/65 p-1.5 text-white opacity-90 backdrop-blur hover:bg-black"><X size={14} /></button>
                    <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/65 to-transparent px-3 pb-2 pt-8 text-[11px] text-white">{items[0].kind === 'file' ? items[0].name : 'URL 图片'}</div>
                </div>
            ) : tab === 'upload' ? (
                <div role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }} className={`flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 text-center transition sm:min-h-56 ${dragging ? 'border-[#d8a620] bg-[#fff9df]' : 'border-[#dcd6c8] bg-[#fbfaf7] hover:border-[#d1ae52] hover:bg-[#fffdf5]'}`}>
                    <input ref={inputRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#b59748] shadow-[0_8px_24px_rgba(80,62,20,0.08)]"><UploadCloud size={25} /></div>
                    <p className="mt-4 text-sm font-medium text-[#716b60]">点击或拖拽文件到此处上传</p>
                    <p className="mt-2 text-xs text-[#aaa397]">支持 JPG / PNG / WEBP · 最大 20MB</p>
                </div>
            ) : (
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

export default function ChangeModelTool() {
    const [modelImages, setModelImages] = useState([]);
    const [garmentImages, setGarmentImages] = useState([]);
    const [bodyType, setBodyType] = useState('hourglass');
    const [ratio, setRatio] = useState(1);
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

    const modelInput = modelImages[0]
        ? { bucket: storage.bucket, region: storage.region, object: modelImages[0].kind === 'url' ? '<URL 转存后的 COS 对象>' : '<本地上传后的 COS 对象>' }
        : { bucket: storage.bucket, region: storage.region, object: '/mps-saas/input/<模特图>' };
    const garmentInput = garmentImages[0]
        ? { bucket: storage.bucket, region: storage.region, object: garmentImages[0].kind === 'url' ? '<URL 转存后的 COS 对象>' : '<本地上传后的 COS 对象>' }
        : { bucket: storage.bucket, region: storage.region, object: '/mps-saas/input/<服装图>' };
    const dryRunPayload = useMemo(() => buildChangeModelPayload({
        modelInput, garmentInput, bodyShape: bodyType, precisionScale: ratio,
        outputBucket: storage.bucket || '<请在 API 设置中配置>', outputRegion: storage.region,
    }), [modelInput, garmentInput, bodyType, ratio, storage]);

    const reset = () => {
        [...modelImages, ...garmentImages].forEach((item) => { if (item.kind === 'file') URL.revokeObjectURL(item.preview); });
        setModelImages([]); setGarmentImages([]); setResults([]); setTaskId(''); setError(''); setStage('');
    };

    const resolveInput = async (item, label) => {
        setStage(`正在上传${label}到 COS…`);
        const input = item.kind === 'url'
            ? await uploadMpsImageFromURL(item.url)
            : await uploadMpsImage(item.file);
        if (!input?.object) throw new Error(`${label}上传成功，但未返回 COS 对象`);
        return input;
    };

    const submit = async () => {
        setError(''); setResults([]); setTaskId('');
        if (!modelImages.length) { setError('请上传或输入一张模特图'); return; }
        if (!garmentImages.length) { setError('请上传或输入一张服装图'); return; }
        if (!storage.configured) { setError('请先在右上角 API 设置中配置腾讯云媒体服务凭证'); return; }
        if (!storage.bucket) { setError('请先在 API 设置中配置 MPS 输出 COS Bucket'); return; }

        setLoading(true);
        const tracker = await createGenerationTracker({
            source: 'mps_tool', type: 'mps', provider: 'tencent-mps', prompt: `换模特 · ${bodyType}`,
            modelName: 'AI 换模特', modelVersion: 'ChangeModel', storageMode: 'Permanent',
            parameters: { bodyType, ratio, bucket: storage.bucket, region: storage.region },
            assets: [...modelImages, ...garmentImages].map((item, index) => ({ role: index === 0 ? 'person_reference' : 'garment_reference', ordinal: index, media_type: 'image', mime_type: item.file?.type || '', file_size: item.file?.size || 0, metadata: { name: item.name || '', direct_url: item.kind === 'url' } })),
        });
        try {
            await tracker?.stage('upload_start', { progress: 8, message: '正在上传模特图与服装图' });
            const modelInput = await resolveInput(modelImages[0], '模特图');
            const garmentInput = await resolveInput(garmentImages[0], '服装图');
            await tracker?.stage('upload_done', { progress: 25, message: '图片上传完成' });
            setStage('正在提交换模特任务…');
            const created = await createChangeModelTask({
                modelInput, garmentInput, bodyShape: bodyType, precisionScale: ratio,
                outputBucket: storage.bucket, outputRegion: storage.region,
            });
            setTaskId(created.taskId);
            await tracker?.stage('task_created', { progress: 40, message: '换模特任务已创建', taskId: created.taskId });
            setStage('AI 正在生成虚拟模特…');
            const completed = await pollImageTask(created.taskId, storage.region, {
                onPoll: ({ attempt, status }) => {
                    setStage(`AI 正在生成 · 第 ${attempt} 次查询`);
                    tracker?.stage('polling', { progress: 60, status, message: 'AI 正在生成' });
                },
            });
            setResults(completed.urls);
            setStage('换模特完成');
            await tracker?.complete({ urls: completed.urls, mediaType: 'image' });
        } catch (submitError) {
            setError(submitError?.message || '换模特任务失败');
            setStage('');
            await tracker?.fail(submitError);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-full bg-[#f6f5ef] text-[#292720]">
            <div className="mx-auto max-w-[1460px] px-5 py-8 lg:px-8">
                <header className="mb-7 flex flex-col gap-4 border-b border-[#dfdacd] pb-7 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#b4871e]"><span className="h-px w-8 bg-[#ddb64d]" />MPS Change Model</div>
                        <h1 className="mt-3 text-[30px] font-semibold tracking-[-0.035em] text-[#26231d] sm:text-[36px]">AI 换模特工作台</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#858074]">上传模特图与服装图，选择目标体型，由腾讯云 MPS 生成对应体型的虚拟模特上身效果。</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`rounded-full px-3 py-1.5 text-xs ${storage.configured && storage.bucket ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{storage.configured && storage.bucket ? '服务已就绪' : '需要完成 API 设置'}</span>
                        <button type="button" onClick={reset} className="flex items-center gap-1.5 rounded-xl border border-[#ddd8cb] bg-white px-3.5 py-2 text-sm text-[#6e685c] hover:bg-[#fbfaf6]"><RotateCcw size={14} />重置</button>
                    </div>
                </header>

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(350px,0.8fr)]">
                    <div className="space-y-6">
                        <SourceCard title="模特图" subtitle="正面、清晰、人物完整的模特照片效果最佳" items={modelImages} onChange={setModelImages} />
                        <SourceCard title="服装图" subtitle="主体清晰、背景简洁的服装图更容易获得稳定效果" items={garmentImages} onChange={setGarmentImages} />
                    </div>

                    <aside className="xl:sticky xl:top-6 xl:self-start">
                        <div className="overflow-hidden rounded-[22px] border border-[#e3ddcf] bg-white shadow-[0_16px_50px_rgba(61,48,20,0.08)]">
                            <div className="border-b border-[#eee9dd] px-6 py-5"><h2 className="text-lg font-semibold">参数配置</h2></div>
                            <div className="space-y-5 p-6">
                                <label className="block"><span className="text-sm font-semibold">体型</span><div className="relative mt-2"><select value={bodyType} onChange={(event) => setBodyType(event.target.value)} className="w-full appearance-none rounded-xl border border-[#ddd7ca] bg-[#fbfaf6] px-3.5 py-3 pr-10 text-sm outline-none focus:border-[#c69625]">{CHANGE_MODEL_BODY_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}{option.default ? '（默认）' : ''}</option>)}</select><ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#837b6e]" /></div></label>
                                <div className="block">
                                    <div className="flex items-baseline justify-between"><span className="text-sm font-semibold">精度倍率</span><span className="text-sm font-semibold text-[#c8962f]">{ratio.toFixed(2)}</span></div>
                                    <p className="mt-1 text-xs text-[#aaa295]">0.01 ~ 2.0，越大越精细</p>
                                    <input type="range" min="0.01" max="2" step="0.01" value={ratio} onChange={(event) => setRatio(Number(event.target.value))} className="mt-2 w-full accent-[#f2c54e]" />
                                </div>
                                {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-600">{error}</div>}
                                {stage && !error && <div className="flex items-center gap-2 rounded-xl border border-[#eadcae] bg-[#fff9e5] px-4 py-3 text-sm text-[#806419]">{loading ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{stage}</div>}
                                <button type="button" onClick={submit} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#f2c54e] px-4 py-3.5 text-sm font-semibold text-[#34290c] shadow-[0_8px_20px_rgba(225,174,43,0.22)] transition hover:-translate-y-0.5 hover:bg-[#f6cd60] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60">{loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{loading ? '任务处理中…' : '提交任务'}</button>
                                <button type="button" onClick={() => setShowDryRun((value) => !value)} className="w-full rounded-xl border border-[#ddd8cb] bg-[#f7f6f1] px-4 py-3 text-sm font-medium text-[#625d52] hover:bg-[#efede5]">Dry Run（预览请求体）</button>
                                {showDryRun && <div className="relative"><pre className="max-h-72 overflow-auto rounded-xl bg-[#24231f] p-4 text-[11px] leading-5 text-[#f6eecf]">{JSON.stringify(dryRunPayload, null, 2)}</pre><button type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(dryRunPayload, null, 2))} className="absolute right-2 top-2 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20" title="复制请求体"><Clipboard size={13} /></button></div>}
                            </div>
                        </div>
                    </aside>
                </div>

                {results.length > 0 && modelImages[0]?.preview && (
                    <ImageComparisonPanel
                        sourceURL={modelImages[0].preview}
                        resultURL={results[0]}
                        title="换模特结果"
                        downloadPrefix="change-model-1"
                    />
                )}

                <footer className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#9b9488]"><span className="flex items-center gap-1.5"><UserRound size={13} />体型：{CHANGE_MODEL_BODY_TYPES.find((b) => b.value === bodyType)?.label}</span><span>精度倍率：{ratio.toFixed(2)}</span><span>腾讯云 MPS ProcessImage</span></footer>
            </div>
        </div>
    );
}
