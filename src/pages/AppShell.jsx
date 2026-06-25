/**
 * AppShell — 登录后的统一主界面
 * 左侧浮动图标条侧边栏（hover 展开显示文字），右侧内容区内联渲染各工具。
 * 画布（项目列表 + 编辑器）同样内嵌在右侧内容区，不再跳转独立全屏。
 */
import React, { useState } from 'react';
import { Image as ImageIcon, Clapperboard, Layout, LibraryBig, Settings, LogOut, Sparkles, ChevronRight, ArrowLeft } from 'lucide-react';
import ImageTool from './ImageTool';
import VideoTool from './VideoTool';
import TemplateLibrary from './TemplateLibrary';
import ProjectList from './ProjectList';
import CanvasApp from '../App.jsx';
import QuotaBadge from '../components/QuotaBadge';
import { logout } from '../api/auth';
import i18n from '../i18n';

const t = (s) => i18n.t ? i18n.t(s) : s;

export default function AppShell({
    active, onNavigate, onOpenAdmin,
    quota, theme, isSuperAdmin, onForcedLogout,
    appliedTemplate, onApplyTemplate,
    canvasProject, onOpenProject, onExitToProjects,
}) {
    const [expanded, setExpanded] = useState(false);

    const handleLogout = () => { logout(); onForcedLogout?.(); };

    const NAV = [
        { id: 'image', name: '图片工具', Icon: ImageIcon, color: 'from-blue-500 to-cyan-400' },
        { id: 'video', name: '视频工具', Icon: Clapperboard, color: 'from-violet-500 to-fuchsia-400' },
        { id: 'canvas', name: '画布', Icon: Layout, color: 'from-emerald-500 to-teal-400' },
        { id: 'templates', name: '模板库', Icon: LibraryBig, color: 'from-orange-500 to-amber-400' },
    ];
    if (isSuperAdmin) {
        NAV.push({ id: 'admin', name: '管理后台', Icon: Settings, color: 'from-zinc-500 to-zinc-400' });
    }

    const handleClick = (id) => {
        if (id === 'admin') return onOpenAdmin();
        onNavigate(id);
    };

    // 画布编辑器自带工具栏并占满全高，进入编辑器时隐藏顶栏
    const inCanvasEditor = active === 'canvas' && !!canvasProject;
    // 画布项目列表：ProjectList 内嵌时已去掉自带标题头，由 AppShell 顶栏承载
    const inCanvasList = active === 'canvas' && !canvasProject;

    return (
        <div className="app-surface min-h-screen flex">
            {/* 左侧图标条侧边栏 */}
            <aside
                onMouseEnter={() => setExpanded(true)}
                onMouseLeave={() => setExpanded(false)}
                className={`fixed left-0 top-0 bottom-0 z-30 flex flex-col py-4 border-r border-white/8 bg-zinc-950/80 backdrop-blur-xl transition-all duration-200 ${expanded ? 'w-52' : 'w-16'}`}
            >
                {/* 品牌 */}
                <div className="flex items-center gap-3 px-3 mb-6 h-10 shrink-0">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-brand-gradient shadow-glow shrink-0">
                        <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <span className={`text-base font-bold text-white whitespace-nowrap transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`}>VodStudio</span>
                </div>

                {/* 导航项 */}
                <nav className="flex-1 flex flex-col gap-1 px-2">
                    {NAV.map((item) => {
                        const isActive = active === item.id;
                        return (
                            <button key={item.id} onClick={() => handleClick(item.id)}
                                title={t(item.name)}
                                className={`group relative flex items-center gap-3 h-11 px-3 rounded-xl transition-colors ${
                                    isActive ? 'bg-white/8 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                }`}>
                                {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r bg-brand-gradient" />}
                                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg shrink-0 ${isActive ? `bg-gradient-to-br ${item.color} shadow-lg` : ''}`}>
                                    <item.Icon className="w-5 h-5" strokeWidth={2} />
                                </span>
                                <span className={`text-sm font-medium whitespace-nowrap transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`}>{t(item.name)}</span>
                            </button>
                        );
                    })}
                </nav>

                {/* 底部：退出 */}
                <div className="px-2 pt-2 border-t border-white/8 mt-2">
                    <button onClick={handleLogout} title={t('退出登录')}
                        className="flex items-center gap-3 h-11 px-3 rounded-xl w-full text-zinc-400 hover:bg-white/5 hover:text-white transition-colors">
                        <span className="inline-flex items-center justify-center w-7 h-7 shrink-0">
                            <LogOut className="w-5 h-5" />
                        </span>
                        <span className={`text-sm font-medium whitespace-nowrap transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`}>{t('退出登录')}</span>
                    </button>
                </div>
            </aside>

            {/* 右侧内容区（留出侧边栏宽度） */}
            <main className="flex-1 ml-16 min-w-0 flex flex-col h-screen">
                {/* 画布项目列表顶栏：标题 + 配额（图片/视频/模板各自内部已有头部，不在此重复） */}
                {inCanvasList && (
                    <div className="flex items-center justify-between gap-4 px-6 h-14 shrink-0 border-b border-white/8 bg-zinc-950/40 backdrop-blur-sm">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-400 shadow-lg shrink-0">
                                <Layout className="w-4 h-4 text-white" />
                            </span>
                            <h1 className="text-base font-semibold text-white truncate">{t('画布项目')}</h1>
                        </div>
                        <QuotaBadge theme={theme} limits={quota?.limits} />
                    </div>
                )}
                {/* 画布编辑器顶栏：面包屑 + 返回 + 配额 */}
                {inCanvasEditor && (
                    <div className="flex items-center justify-between gap-4 px-4 h-14 shrink-0 border-b border-white/8 bg-zinc-950/60 backdrop-blur-sm">
                        <div className="flex items-center gap-2 min-w-0">
                            <button onClick={onExitToProjects}
                                className="btn-ghost px-3 py-1.5 inline-flex items-center gap-1.5 text-sm shrink-0">
                                <ArrowLeft className="w-4 h-4" />{t('项目列表')}
                            </button>
                            <div className="flex items-center gap-1.5 text-sm min-w-0">
                                <span className="text-zinc-500 shrink-0">{t('画布')}</span>
                                <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0" />
                                <span className="text-white font-medium truncate">{canvasProject?.name || t('未命名项目')}</span>
                            </div>
                        </div>
                        <QuotaBadge theme={theme} limits={quota?.limits} />
                    </div>
                )}
                <div className={`flex-1 min-h-0 ${inCanvasEditor ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                    {active === 'image' && (
                        <ImageTool embedded theme={theme} quota={quota} template={appliedTemplate} />
                    )}
                    {active === 'video' && (
                        <VideoTool embedded theme={theme} quota={quota} template={appliedTemplate} />
                    )}
                    {active === 'templates' && (
                        <TemplateLibrary embedded theme={theme} quota={quota} onForcedLogout={onForcedLogout}
                            onApply={onApplyTemplate} />
                    )}
                    {active === 'canvas' && (
                        canvasProject ? (
                            <div className="h-full">
                                <CanvasApp embedded currentProject={canvasProject}
                                    onExitToProjects={onExitToProjects} onForcedLogout={onForcedLogout} />
                            </div>
                        ) : (
                            <ProjectList embedded theme={theme} onOpenProject={onOpenProject}
                                onForcedLogout={onForcedLogout} />
                        )
                    )}
                </div>
            </main>
        </div>
    );
}
