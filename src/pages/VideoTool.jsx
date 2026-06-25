/**
 * 视频工具 — 独立生视频页面（非画布节点）
 * 模式：首尾帧 / 多图
 */
import React, { useState, useCallback } from 'react';
import {
    ArrowLeft, Clapperboard, X, Plus, Loader2, AlertCircle, Wand2, Sparkles,
    Film, Images,
} from 'lucide-react';
import {
    VOD_VIDEO_MODEL_MATRIX, VOD_VIDEO_RATIOS, VOD_VIDEO_DURATIONS,
    uploadImageToVod, createAigcVideoTask, pollVodTask, extractVodResultUrls,
} from '../vodAdapter';
import QuotaBadge from '../components/QuotaBadge';
import i18n from '../i18n';

const t = (s) => i18n.t ? i18n.t(s) : s;
const CTX = { credentials: { region: 'ap-guangzhou' } };

export default function VideoTool({ onBack, theme, quota, template, embedded = false }) {
    const [mode, setMode] = useState('firstlast'); // firstlast | multi
    const [firstFrame, setFirstFrame] = useState(null);
    const [lastFrame, setLastFrame] = useState(null);
    const [multiImages, setMultiImages] = useState([]);
    const [modelName, setModelName] = useState(template?.model_name || 'Kling');
    const [modelVersion, setModelVersion] = useState(template?.model_version || '2.1');
    const [ratio, setRatio] = useState(template?.ratio || '16:9');
    const [duration, setDuration] = useState('5s');
    const [prompt, setPrompt] = useState(template?.prompt || '');
    const [loading, setLoading] = useState(false);
    const [stage, setStage] = useState('');
    const [results, setResults] = useState([]);
    const [error, setError] = useState('');

    const versions = VOD_VIDEO_MODEL_MATRIX[modelName] || [];

    const uploadOne = useCallback(async (file) => {
        const fileId = await uploadImageToVod(file, CTX);
        return { file, fileId, preview: URL.createObjectURL(file) };
    }, []);

    const handleUploadSingle = async (files, setter) => {
        const f = files?.[0]; if (!f) return;
        setError(''); try { setStage('上传图片...'); setter(await uploadOne(f)); setStage(''); }
        catch (e) { setError('上传失败: ' + (e.message || '')); setStage(''); }
    };
    const handleUploadMulti = async (files) => {
        const arr = Array.from(files || []); if (!arr.length) return;
        setError(''); try {
            setStage('上传图片...');
            const uploaded = [];
            for (const f of arr) uploaded.push(await uploadOne(f));
            setMultiImages((prev) => [...prev, ...uploaded]);
            setStage('');
        } catch (e) { setError('上传失败: ' + (e.message || '')); setStage(''); }
    };

    const generate = async () => {
        setLoading(true); setError(''); setResults([]); setStage('创建生成任务...');
        try {
            let fileInfos = [];
            if (mode === 'firstlast') {
                if (!firstFrame && !lastFrame) { setError('请上传首帧或尾帧'); setLoading(false); setStage(''); return; }
                if (firstFrame) fileInfos.push({ FileInfo: { Type: 'Png', FileId: firstFrame.fileId } });
                if (lastFrame) fileInfos.push({ FileInfo: { Type: 'Png', FileId: lastFrame.fileId } });
            } else {
                if (!multiImages.length) { setError('请至少上传一张图片'); setLoading(false); setStage(''); return; }
                fileInfos = multiImages.map((r) => ({ FileInfo: { Type: 'Png', FileId: r.fileId } }));
            }
            const params = {
                modelName, modelVersion,
                prompt: prompt.trim() || undefined,
                fileInfos,
                outputConfig: { Resolution: ratio, Duration: duration },
            };
            const { taskId } = await createAigcVideoTask(params, CTX);
            setStage('生成中，轮询任务状态...');
            const detail = await pollVodTask(taskId, CTX);
            const urls = extractVodResultUrls(detail);
            setResults(urls);
            window.dispatchEvent(new Event('vodstudio:usage-updated'));
            setStage('');
        } catch (e) {
            setError('生成失败: ' + (e.message || '')); setStage('');
        } finally { setLoading(false); }
    };

    const slot = (img, onPick, onClear, label) => (
        <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">{t(label)}</label>
            {img ? (
                <div className="relative inline-block group">
                    <img src={img.preview} alt="" className="w-28 h-28 object-cover rounded-xl border border-white/10" />
                    <button onClick={onClear}
                        className="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg transition">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            ) : (
                <label className="dropzone w-28 h-28">
                    <Plus className="w-5 h-5" />
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUploadSingle(e.target.files, onPick)} />
                </label>
            )}
        </div>
    );

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
                            <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-400 shadow-lg">
                                <Clapperboard className="w-4 h-4 text-white" />
                            </div>
                            <h1 className="text-xl font-semibold text-white">{t('视频工具')}</h1>
                        </div>
                    </div>
                    <QuotaBadge theme={theme} limits={quota?.limits} />
                </div>

                <div className="glass-card rounded-2xl p-6 mb-6 animate-fade-in">
                    {/* 模式切换 */}
                    <div className="segmented mb-6">
                        <button data-active={mode === 'firstlast'} onClick={() => setMode('firstlast')}>
                            <span className="inline-flex items-center gap-1.5 justify-center"><Film className="w-4 h-4" />{t('首尾帧模式')}</span>
                        </button>
                        <button data-active={mode === 'multi'} onClick={() => setMode('multi')}>
                            <span className="inline-flex items-center gap-1.5 justify-center"><Images className="w-4 h-4" />{t('多图模式')}</span>
                        </button>
                    </div>

                    {/* 帧上传 */}
                    <div className="mb-6">
                        {mode === 'firstlast' ? (
                            <div className="flex gap-6">
                                {slot(firstFrame, setFirstFrame, () => setFirstFrame(null), '首帧（可选）')}
                                {slot(lastFrame, setLastFrame, () => setLastFrame(null), '尾帧（可选）')}
                            </div>
                        ) : (
                            <div>
                                <label className="block text-sm font-medium text-zinc-300 mb-2">{t('多图（1 张及以上）')}</label>
                                <div className="flex flex-wrap gap-3">
                                    {multiImages.map((r, i) => (
                                        <div key={i} className="relative group">
                                            <img src={r.preview} alt="" className="w-20 h-20 object-cover rounded-xl border border-white/10" />
                                            <button onClick={() => setMultiImages((prev) => prev.filter((_, j) => j !== i))}
                                                className="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg transition">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                    <label className="dropzone w-20 h-20">
                                        <Plus className="w-5 h-5" />
                                        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleUploadMulti(e.target.files)} />
                                    </label>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 模型/版本/比例/时长 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">{t('模型')}</label>
                            <select value={modelName} onChange={(e) => { setModelName(e.target.value); setModelVersion((VOD_VIDEO_MODEL_MATRIX[e.target.value] || [''])[0]); }} className="field">
                                {Object.keys(VOD_VIDEO_MODEL_MATRIX).map((m) => <option key={m} value={m}>{m}</option>)}
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
                                {VOD_VIDEO_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">{t('时长')}</label>
                            <select value={duration} onChange={(e) => setDuration(e.target.value)} className="field">
                                {VOD_VIDEO_DURATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* 提示词 */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-zinc-300 mb-2">{t('提示词')}</label>
                        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder={t('描述想要的视频...')} className="field resize-none" />
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
                        {loading ? t('生成中...') : t('生成视频')}
                    </button>
                </div>

                {results.length > 0 && (
                    <div className="animate-fade-in">
                        <div className="flex items-center gap-2 mb-3">
                            <Sparkles className="w-4 h-4 text-brand-400" />
                            <h2 className="text-sm font-medium text-zinc-300">{t('生成结果')}</h2>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {results.map((url, i) => (
                                <video key={i} src={url} controls className="w-full rounded-xl border border-white/10" />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
