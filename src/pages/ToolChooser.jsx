/**
 * 工具选择页 — 登录后主入口
 * 参考 TapNow/Flowith/NeoAI 的工具卡片式布局
 */
import React from 'react';
import { Image as ImageIcon, Clapperboard, Layout, LibraryBig, Settings, LogOut, Sparkles, ArrowRight } from 'lucide-react';
import QuotaBadge from '../components/QuotaBadge';
import { logout } from '../api/auth';
import i18n from '../i18n';

const t = (s) => i18n.t ? i18n.t(s) : s;

export default function ToolChooser({ onPick, quota, onForcedLogout, theme, isSuperAdmin }) {
    const handleLogout = () => { logout(); onForcedLogout?.(); };

    const TOOLS = [
        { id: 'image', name: '图片工具', desc: '参考图 + 提示词生成图片', Icon: ImageIcon, color: 'from-blue-500 to-cyan-400', glow: 'rgba(56,189,248,0.5)' },
        { id: 'video', name: '视频工具', desc: '首尾帧 / 多图模式生成视频', Icon: Clapperboard, color: 'from-violet-500 to-fuchsia-400', glow: 'rgba(217,70,239,0.5)' },
        { id: 'canvas', name: '画布', desc: '节点编辑器，自由组合工作流', Icon: Layout, color: 'from-emerald-500 to-teal-400', glow: 'rgba(45,212,191,0.5)' },
        { id: 'templates', name: '模板库', desc: '电商 / 游戏 / 影视场景模板', Icon: LibraryBig, color: 'from-orange-500 to-amber-400', glow: 'rgba(251,191,36,0.5)' },
    ];
    if (isSuperAdmin) {
        TOOLS.push({ id: 'admin', name: '管理后台', desc: '用户配额 / 模板管理', Icon: Settings, color: 'from-zinc-500 to-zinc-400', glow: 'rgba(161,161,170,0.4)' });
    }

    return (
        <div className="app-surface min-h-screen">
            <div className="max-w-6xl mx-auto px-6 py-12">
                {/* 顶部栏 */}
                <div className="flex items-center justify-between mb-12 animate-fade-in">
                    <div className="flex items-center gap-3">
                        <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-brand-gradient shadow-glow">
                            <Sparkles className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-white">VodStudio</h1>
                            <p className="text-sm text-zinc-500">{t('选择一个工具开始创作')}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <QuotaBadge theme={theme} limits={quota?.limits} />
                        <button onClick={handleLogout} className="btn-ghost px-4 py-2 text-sm">
                            <LogOut className="w-4 h-4" />
                            {t('退出登录')}
                        </button>
                    </div>
                </div>

                {/* 工具卡片 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {TOOLS.map((tool, i) => (
                        <button key={tool.id} onClick={() => onPick(tool.id)}
                            style={{ animationDelay: `${i * 60}ms` }}
                            className="group glass-card relative overflow-hidden rounded-2xl p-7 text-left transition-all duration-300 hover:-translate-y-1 hover:border-white/15 animate-fade-in">
                            {/* hover 光晕 */}
                            <div className="absolute -inset-px opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                                style={{ background: `radial-gradient(20rem 12rem at 30% 0%, ${tool.glow}, transparent 70%)`, mixBlendMode: 'screen' }} />
                            <div className="relative">
                                <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${tool.color} shadow-lg mb-5`}>
                                    <tool.Icon className="w-6 h-6 text-white" strokeWidth={2} />
                                </div>
                                <h2 className="text-lg font-semibold text-white mb-1.5">{t(tool.name)}</h2>
                                <p className="text-sm text-zinc-400 leading-relaxed">{t(tool.desc)}</p>
                                <div className="mt-5 flex items-center gap-1.5 text-sm font-medium text-zinc-500 group-hover:text-brand-300 transition-colors">
                                    <span>{t('开始使用')}</span>
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
