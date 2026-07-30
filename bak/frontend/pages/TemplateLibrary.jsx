/**
 * 模板库 — 电商/游戏/影视等场景模板，一键应用到图片/视频工具
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Image as ImageIcon, Clapperboard, ArrowLeft, LibraryBig, AlertCircle, Loader2 } from 'lucide-react';
import { listTemplates } from '../api/template';
import QuotaBadge from '../components/QuotaBadge';
import i18n from '../i18n';

const t = (s) => i18n.t ? i18n.t(s) : s;

export default function TemplateLibrary({ onBack, onApply, theme, quota, embedded = false }) {
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('all');

    const load = useCallback(async () => {
        setLoading(true); setError('');
        try {
            const data = await listTemplates();
            setTemplates(Array.isArray(data) ? data : []);
        } catch (e) {
            setError(e.message || '加载模板失败');
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const categories = ['all', ...Array.from(new Set(templates.map((x) => x.category).filter(Boolean)))];
    const filtered = filter === 'all' ? templates : templates.filter((x) => x.category === filter);

    return (
        <div className={embedded ? '' : 'app-surface min-h-screen'}>
            <div className="max-w-6xl mx-auto px-6 py-8">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        {!embedded && (
                            <button onClick={onBack} className="btn-ghost px-3 py-2 inline-flex items-center gap-1.5">
                                <ArrowLeft className="w-4 h-4" />{t('返回')}
                            </button>
                        )}
                        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-400 shadow-glow">
                            <LibraryBig className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-[#1f2329]">{t('模板库')}</h1>
                            <p className="text-xs text-gray-400">{t('一键套用场景模板到图片 / 视频工具')}</p>
                        </div>
                    </div>
                    <QuotaBadge theme={theme} limits={quota?.limits} />
                </div>

                {/* 分类筛选 */}
                <div className="flex flex-wrap gap-2 mb-6">
                    {categories.map((c) => (
                        <button key={c} onClick={() => setFilter(c)}
                            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                filter === c
                                    ? 'bg-brand-gradient text-white shadow-glow'
                                    : 'bg-[#f4f4f5] text-gray-500 hover:bg-[#e8eaed] hover:text-[#1f2329] border border-[#ececef]'
                            }`}>
                            {c === 'all' ? t('全部') : t(c)}
                        </button>
                    ))}
                </div>

                {error && (
                    <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm flex items-center justify-between">
                        <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</span>
                        <button onClick={load} className="text-xs underline hover:text-red-200">{t('重试')}</button>
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center gap-2 py-24 text-gray-400">
                        <Loader2 className="w-5 h-5 animate-spin" />{t('加载中...')}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-24">
                        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#f4f4f5] border border-[#ececef] mb-3">
                            <LibraryBig className="w-7 h-7 text-gray-300" />
                        </div>
                        <p className="text-gray-400 text-sm">{t('暂无模板')}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filtered.map((tpl) => (
                            <div key={tpl.id} className="glass-card p-5 flex flex-col group hover:shadow-glow transition-shadow">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs px-2 py-0.5 rounded-md bg-[#f4f4f5] text-gray-600 border border-[#ececef]">{t(tpl.category || '其他')}</span>
                                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${tpl.type === 'image' ? 'bg-gradient-to-br from-blue-500 to-cyan-400' : 'bg-gradient-to-br from-violet-500 to-fuchsia-400'}`}>
                                        {tpl.type === 'image' ? <ImageIcon className="w-4 h-4 text-white" /> : <Clapperboard className="w-4 h-4 text-white" />}
                                    </span>
                                </div>
                                <h3 className="font-semibold text-[#1f2329] mb-1.5">{t(tpl.name)}</h3>
                                {tpl.description && <p className="text-xs text-gray-500 mb-3 line-clamp-2">{t(tpl.description)}</p>}
                                <div className="text-xs text-gray-400 mb-4 mt-auto">
                                    {tpl.model_name} {tpl.model_version} · {tpl.ratio} · {t('参考图')}{tpl.ref_image_count}
                                </div>
                                <button onClick={() => onApply(tpl)} className="btn-primary w-full py-2 text-sm">{t('使用模板')}</button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
