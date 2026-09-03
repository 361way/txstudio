import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { appendAssetsToCanvas, createCanvasWithAssets, listCanvasTargets } from '../api/sendToCanvas';

/**
 * 一键发送到画布：可选择已有画布项目，或直接新建画布。
 * onSent(projectId) 用于通知调用方跳转到对应画布继续二次创作。
 */
export default function SendToCanvasDialog({ assets = [], onClose, onSent, onToast }) {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [mode, setMode] = useState('existing');
    const [targetId, setTargetId] = useState('');
    const [projectName, setProjectName] = useState('');
    const [error, setError] = useState('');

    const count = Array.isArray(assets) ? assets.length : 0;

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const list = await listCanvasTargets();
                if (!active) return;
                setProjects(list);
                setTargetId((current) => current || String(list?.[0]?.id || ''));
            } catch (nextError) {
                if (active) setError(nextError?.message || '加载画布项目失败');
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, []);

    const selectedName = useMemo(() => {
        const matched = projects.find((item) => String(item.id) === String(targetId));
        return matched?.name || '';
    }, [projects, targetId]);

    const submit = async () => {
        if (submitting || count === 0) return;
        setError('');
        setSubmitting(true);
        try {
            if (mode === 'new') {
                const { project } = await createCanvasWithAssets(projectName, assets);
                onToast?.(`已新建画布并发送 ${count} 个素材`);
                onSent?.(project?.id);
            } else {
                if (!targetId) throw new Error('请选择目标画布');
                // targetId 全程按字符串传递，避免 Number() 把非数字 id 变成 NaN。
                await appendAssetsToCanvas(targetId, assets);
                onToast?.(`已发送 ${count} 个素材到「${selectedName || '目标画布'}」`);
                onSent?.(targetId);
            }
            onClose?.();
        } catch (nextError) {
            setError(nextError?.message || '发送到画布失败');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="发送到画布">
            <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="关闭" />
            <div className="relative w-full max-w-[420px] overflow-hidden rounded-2xl border border-[#e8e2d6] bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-[#f0ede6] px-4 py-3">
                    <div>
                        <div className="text-[13px] font-semibold text-[#3e3a32]">发送到画布</div>
                        <div className="mt-0.5 text-[10px] text-gray-400">已选择 {count} 个素材，可在画布中继续二次创作</div>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 transition hover:bg-[#f5f3ee] hover:text-[#3e3a32]" aria-label="关闭"><X size={16} /></button>
                </div>

                <div className="space-y-3 p-4">
                    <div className="flex rounded-lg bg-[#f5f3ee] p-0.5 text-[11px]">
                        <button type="button" onClick={() => setMode('existing')} className={`flex-1 rounded-md px-3 py-1.5 transition ${mode === 'existing' ? 'bg-white text-[#805f16] shadow-sm' : 'text-gray-500'}`}>已有画布</button>
                        <button type="button" onClick={() => setMode('new')} className={`flex-1 rounded-md px-3 py-1.5 transition ${mode === 'new' ? 'bg-white text-[#805f16] shadow-sm' : 'text-gray-500'}`}>新建画布</button>
                    </div>

                    {mode === 'existing' ? (
                        <label className="block text-[11px] text-gray-500">
                            目标画布
                            <select
                                value={targetId}
                                onChange={(event) => setTargetId(event.target.value)}
                                disabled={loading || projects.length === 0}
                                className="mt-1.5 w-full rounded-lg border border-[#dedee2] bg-white px-3 py-2 text-[12px] text-[#3e3a32] outline-none focus:border-[#c8a75a]"
                            >
                                {loading && <option value="">加载中...</option>}
                                {!loading && projects.length === 0 && <option value="">暂无画布项目</option>}
                                {projects.map((project) => (
                                    <option key={project.id} value={project.id}>{project.name || `项目 #${project.id}`}</option>
                                ))}
                            </select>
                        </label>
                    ) : (
                        <label className="block text-[11px] text-gray-500">
                            新画布名称
                            <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-[#dedee2] px-3 py-2 focus-within:border-[#c8a75a]">
                                <Plus size={13} className="shrink-0 text-gray-400" />
                                <input
                                    value={projectName}
                                    onChange={(event) => setProjectName(event.target.value)}
                                    placeholder="未命名项目"
                                    className="w-full bg-transparent text-[12px] text-[#3e3a32] outline-none"
                                />
                            </div>
                        </label>
                    )}

                    {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-600">{error}</div>}
                </div>

                <div className="flex justify-end gap-2 border-t border-[#f0ede6] px-4 py-3">
                    <button type="button" onClick={onClose} className="rounded-lg border border-[#e4ded0] px-3 py-1.5 text-[11.5px] text-gray-500 hover:bg-[#faf8f2]">取消</button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={submitting || loading || count === 0 || (mode === 'existing' && !targetId)}
                        className="flex items-center gap-1.5 rounded-lg bg-[#8a6b1f] px-3.5 py-1.5 text-[11.5px] font-medium text-white transition hover:bg-[#745a19] disabled:opacity-50"
                    >
                        {submitting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        {submitting ? '发送中...' : '发送到画布'}
                    </button>
                </div>
            </div>
        </div>
    );
}
