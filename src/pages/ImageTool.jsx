/**
 * 图片工具 — 独立生图页面（非画布节点）
 * 参考图上传 + 模型/比例选择 + 提示词 + 生成
 */
import React, { useState, useCallback } from 'react';
import {
    ArrowLeft, ImagePlus, X, Sparkles, Loader2, AlertCircle, Download, Wand2,
} from 'lucide-react';
import {
    VOD_IMAGE_MODEL_MATRIX, VOD_IMAGE_RATIOS,
    uploadImageToVod, createAigcImageTask, pollVodTask, extractVodResultUrls,
} from '../vodAdapter';
import QuotaBadge from '../components/QuotaBadge';
import i18n from '../i18n';

const t = (s) => i18n.t ? i18n.t(s) : s;

// 后端代签后 ctx 只需占位 region（凭证由后端管理）
const CTX = { credentials: { region: 'ap-guangzhou' } };

export default function ImageTool({ onBack, theme, quota, template, embedded = false }) {
    const [refImages, setRefImages] = useState([]);
    const [modelName, setModelName] = useState(template?.model_name || 'Kling');
    const [modelVersion, setModelVersion] = useState(template?.model_version || '3.0');
    const [ratio, setRatio] = useState(template?.ratio || '1:1');
    const [prompt, setPrompt] = useState(template?.prompt || '');
    const [loading, setLoading] = useState(false);
    const [stage, setStage] = useState('');
    const [results, setResults] = useState([]);
    const [error, setError] = useState('');

    const versions = VOD_IMAGE_MODEL_MATRIX[modelName] || [];

    const handleUpload = useCallback(async (files) => {
        const arr = Array.from(files || []);
        if (!arr.length) return;
        setError('');
        try {
            setStage('上传参考图...');
            const uploaded = [];
            for (const f of arr) {
                const fileId = await uploadImageToVod(f, CTX);
                uploaded.push({ file: f, fileId, preview: URL.createObjectURL(f) });
            }
            setRefImages((prev) => [...prev, ...uploaded]);
            setStage('');
        } catch (e) {
            setError('参考图上传失败: ' + (e.message || ''));
            setStage('');
        }
    }, []);

    const removeRef = (idx) => {
        setRefImages((prev) => prev.filter((_, i) => i !== idx));
    };

    const generate = async () => {
        if (!prompt.trim() && !refImages.length) {
            setError('请输入提示词或上传参考图');
            return;
        }
        setLoading(true); setError(''); setResults([]); setStage('创建生成任务...');
        try {
            const params = {
                modelName, modelVersion,
                prompt: prompt.trim(),
                fileInfos: refImages.map((r) => ({ FileInfo: { Type: 'Png', FileId: r.fileId } })),
                outputConfig: { Resolution: ratio },
            };
            const { taskId } = await createAigcImageTask(params, CTX);
            setStage('生成中，轮询任务状态...');
            const detail = await pollVodTask(taskId, CTX);
            const urls = extractVodResultUrls(detail);
            setResults(urls);
            window.dispatchEvent(new Event('vodstudio:usage-updated'));
            setStage('');
        } catch (e) {
            setError('生成失败: ' + (e.message || ''));
            setStage('');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={embedded ? '' : 'app-surface min-h-screen'}>
            <div className="max-w-4xl mx-auto px-6 py-8">
                {/* 顶部栏 */}
                <div className="flex items-center justify-between mb-8 animate-fade-in">
                    <div className="flex items-center gap-3">
                        {!embedded && (
                            <button onClick={onBack} className="btn-ghost px-3 py-2 text-sm">
                                <ArrowLeft className="w-4 h-4" />
                                {t('返回')}
                            </button>
                        )}
                        <div className="flex items-center gap-2.5">
                            <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 shadow-lg">
                                <ImagePlus className="w-4 h-4 text-white" />
                            </div>
                            <h1 className="text-xl font-semibold text-white">{t('图片工具')}</h1>
                        </div>
                    </div>
                    <QuotaBadge theme={theme} limits={quota?.limits} />
                </div>

                <div className="glass-card rounded-2xl p-6 mb-6 animate-fade-in">
                    {/* 参考图 */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-zinc-300 mb-3">{t('参考图（可选，可多选）')}</label>
                        <div className="flex flex-wrap gap-3">
                            {refImages.map((r, i) => (
                                <div key={i} className="relative group">
                                    <img src={r.preview} alt="" className="w-20 h-20 object-cover rounded-xl border border-white/10" />
                                    <button onClick={() => removeRef(i)}
                                        className="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg transition">
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                            <label className="dropzone w-20 h-20">
                                <ImagePlus className="w-5 h-5" />
                                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
                            </label>
                        </div>
                    </div>

                    {/* 模型 + 版本 + 比例 */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">{t('模型')}</label>
                            <select value={modelName} onChange={(e) => { setModelName(e.target.value); setModelVersion((VOD_IMAGE_MODEL_MATRIX[e.target.value] || [''])[0]); }} className="field">
                                {Object.keys(VOD_IMAGE_MODEL_MATRIX).map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">{t('版本')}</label>
                            <select value={modelVersion} onChange={(e) => setModelVersion(e.target.value)} className="field">
                                {versions.map((v) => <option key={v} value={v}>{v}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">{t('比例')}</label>
                            <select value={ratio} onChange={(e) => setRatio(e.target.value)} className="field">
                                {VOD_IMAGE_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* 提示词 */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-zinc-300 mb-2">{t('提示词')}</label>
                        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder={t('描述你想要的图片...')}
                            className="field resize-none" />
                    </div>

                    {error && (
                        <div className="mb-4 flex items-start gap-2 p-3.5 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-sm">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}
                    {stage && (
                        <div className="mb-4 flex items-center gap-2 text-sm text-brand-300">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>{stage}</span>
                        </div>
                    )}

                    <button onClick={generate} disabled={loading} className="btn-primary w-full py-3">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                        {loading ? t('生成中...') : t('生成图片')}
                    </button>
                </div>

                {results.length > 0 && (
                    <div className="animate-fade-in">
                        <div className="flex items-center gap-2 mb-3">
                            <Sparkles className="w-4 h-4 text-brand-400" />
                            <h2 className="text-sm font-medium text-zinc-300">{t('生成结果')}</h2>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {results.map((url, i) => (
                                <a key={i} href={url} target="_blank" rel="noreferrer"
                                    className="group relative block rounded-xl overflow-hidden border border-white/10">
                                    <img src={url} alt="" className="w-full" />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                                        <Download className="w-5 h-5 text-white" />
                                    </div>
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
