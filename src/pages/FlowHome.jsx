/**
 * FlowHome —「Flow with ideas」创作工具首页
 *
 * 适配当前项目：React 18 + Tailwind 3 + lucide-react。
 * 浅色主题（自带 bg-white，覆盖全局暗色 body 背景）。
 *
 * Props:
 *   onNewFlow?:   () => void         点击「新建 Flow」
 *   onSelectMode?: (modeId) => void  切换底部创作模式（dialog/image/video/slide/web/agent）
 *   onSend?:      (text, mode) => void  点击发送
 */
import React, { useState } from 'react';
import {
    Plus, PanelLeft, LayoutGrid, PlaySquare, Sprout, Store,
    ChevronDown, ListFilter, Bell, Sparkles, Paperclip, Star,
    Lock, ArrowUp, MessageSquare, Image as ImageIcon, Video,
    Presentation, Globe, Infinity as InfinityIcon,
} from 'lucide-react';

const NAV_ITEMS = [
    { id: 'new', label: '新建 Flow', icon: Plus },
    { id: 'canvas', label: '画布管理', icon: LayoutGrid },
    { id: 'media', label: '媒体历史', icon: PlaySquare },
    { id: 'garden', label: '知识花园', icon: Sprout },
    { id: 'market', label: '知识市集', icon: Store },
];

const HISTORY = [
    { id: 1, thumb: 'Flow', title: '未命名 Flow', time: '上次编辑 2026/4/1' },
    { id: 2, thumb: 'New', title: 'New Chat', time: '上次编辑 2026/4/1' },
    { id: 3, thumb: 'Welc\nome', title: 'Welcome to flowith 2....', time: '上次编辑 2026/1/17' },
];

const MODES = [
    { id: 'dialog', label: '对话', icon: MessageSquare },
    { id: 'image', label: '图像', icon: ImageIcon },
    { id: 'video', label: '视频', icon: Video },
    { id: 'slide', label: '幻灯片', icon: Presentation },
    { id: 'web', label: '网页', icon: Globe },
    { id: 'agent', label: 'Neo Agent', icon: InfinityIcon },
];

export default function FlowHome({ onNewFlow, onSelectMode, onSend }) {
    const [activeMode, setActiveMode] = useState('image');
    const [text, setText] = useState('');

    const handleMode = (id) => {
        setActiveMode(id);
        onSelectMode?.(id);
    };

    const handleSend = () => {
        if (!text.trim()) return;
        onSend?.(text.trim(), activeMode);
    };

    return (
        <div className="flex h-screen w-full overflow-hidden bg-white text-[#1f2329] font-sans">
            {/* ============ 侧边栏 ============ */}
            <aside className="flex w-[232px] flex-shrink-0 flex-col border-r border-[#ececef] px-3 py-4">
                {/* Logo + 折叠 */}
                <div className="flex items-center justify-between px-2 pb-4">
                    <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-gradient-to-br from-neutral-800 to-black font-serif text-[15px] font-bold text-white">
                        n
                    </div>
                    <button className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-[#f4f4f5] hover:text-gray-600">
                        <PanelLeft size={16} />
                    </button>
                </div>

                {/* 主导航 */}
                <nav className="flex flex-col gap-0.5">
                    {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            onClick={id === 'new' ? onNewFlow : undefined}
                            className="flex items-center gap-[11px] rounded-lg px-[9px] py-2 text-[13.5px] text-gray-500 hover:bg-[#f4f4f5] hover:text-[#1f2329]"
                        >
                            <Icon size={16} className="flex-shrink-0" />
                            {label}
                        </button>
                    ))}
                </nav>

                {/* 项目 */}
                <div className="mt-3.5 flex items-center justify-between px-[9px] py-1.5 text-[12.5px] text-gray-400">
                    <span className="flex items-center gap-1.5">项目 <ChevronDown size={11} /></span>
                    <button className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#f4f4f5]">
                        <LayoutGrid size={14} />
                    </button>
                </div>

                {/* 历史记录 */}
                <div className="mt-3.5 flex items-center justify-between px-[9px] py-1.5 text-[12.5px] text-gray-400">
                    <span className="flex items-center gap-1.5">历史记录 <ChevronDown size={11} /></span>
                    <button className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#f4f4f5]">
                        <ListFilter size={14} />
                    </button>
                </div>

                <div className="mt-0.5 flex flex-col gap-1 overflow-y-auto no-scrollbar">
                    {HISTORY.map((h) => (
                        <button key={h.id} className="flex gap-[9px] rounded-lg px-2 py-[7px] text-left hover:bg-[#f4f4f5]">
                            <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center overflow-hidden whitespace-pre rounded-md bg-[#f0f0f2] text-center text-[8px] leading-tight text-gray-400">
                                {h.thumb}
                            </div>
                            <div className="min-w-0">
                                <div className="max-w-[150px] truncate text-[13px] text-[#1f2329]">{h.title}</div>
                                <div className="mt-0.5 text-[11px] text-gray-400">{h.time}</div>
                            </div>
                        </button>
                    ))}
                </div>
            </aside>

            {/* ============ 主区域 ============ */}
            <main className="relative flex min-w-0 flex-1 flex-col">
                {/* 顶部公告条 */}
                <div className="flex h-[34px] items-center justify-center gap-2 border-b border-[#eef4f1] bg-gradient-to-r from-[#effaf4] to-[#f0f9ff] text-[12.5px] text-[#3f7a6a]">
                    <span className="text-[15px] text-[#34a07f]">∞</span>
                    <span>解锁无限生成能力，重直</span>
                    <span>🎬</span><span>⚡</span><span>✨</span>
                    <span>等热门模型</span>
                </div>

                {/* 右上操作区 */}
                <div className="absolute right-[22px] top-[44px] z-10 flex items-center gap-4">
                    <button className="flex items-center text-gray-500 hover:text-gray-700">
                        <Bell size={17} />
                    </button>
                    <div className="flex items-center gap-1 text-[13px] text-gray-500">
                        <span className="inline-block h-[15px] w-[15px] rounded-full bg-gradient-to-br from-[#ffe08a] to-[#f5b942]" />
                        0
                    </div>
                    <button className="flex items-center text-gray-500 hover:text-gray-700">
                        <Plus size={17} />
                    </button>
                    <button className="flex items-center gap-1.5 rounded-lg border border-[#ececef] bg-white px-3 py-1.5 text-[12.5px] text-[#1f2329] hover:bg-[#f4f4f5]">
                        <Sparkles size={13} className="text-[#f5b942]" />
                        新无限创作包
                    </button>
                </div>

                {/* Hero */}
                <section className="-mt-10 flex flex-1 flex-col items-center justify-center px-6">
                    <h1 className="flex items-baseline gap-3 text-[46px] font-bold tracking-tight">
                        <span className="font-script bg-gradient-to-r from-[#4cc2c4] to-[#4a90d9] bg-clip-text text-[58px] leading-none text-transparent">
                            Flow
                        </span>
                        with ideas
                    </h1>
                    <p className="mt-3.5 text-sm text-gray-400">好的灵感，从这里开始</p>

                    {/* 输入卡片 */}
                    <div className="mt-7 w-full max-w-[720px] rounded-2xl border border-[#ececef] bg-white p-4 px-[18px] pb-3 shadow-[0_6px_24px_rgba(0,0,0,0.03)]">
                        <button className="inline-flex items-center gap-[7px] rounded-[9px] border border-[#ececef] px-3 py-1.5 text-[13px] text-gray-500 hover:bg-[#f4f4f5]">
                            风格 <Plus size={13} />
                        </button>

                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                            rows={1}
                            placeholder="每个伟大的想法都始于一个念头..."
                            className="mt-4 block w-full resize-none border-0 bg-transparent text-sm text-[#1f2329] placeholder-gray-400 focus:outline-none focus:ring-0"
                        />

                        <div className="mt-5 flex items-center gap-3.5 text-[13px] text-gray-500">
                            <span className="flex items-center gap-1.5"><ImageIcon size={16} /> 图像</span>
                            <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 hover:bg-[#f4f4f5]">
                                <span className="h-[13px] w-[13px] rounded-full bg-gradient-to-br from-[#a78bfa] to-[#818cf8]" />
                                Nano Banana 2
                                <ChevronDown size={12} />
                            </button>
                            <button className="hover:text-[#1f2329]"><Paperclip size={16} /></button>
                            <Star size={16} className="fill-[#f5b942] text-[#f5b942]" />
                            <span>16:9</span>
                            <span>512</span>
                            <span className="flex items-center gap-1">无限模式 <Lock size={12} /></span>
                            <span className="opacity-40">▭▭</span>
                            <div className="flex-1" />
                            <span>1x</span>
                            <button
                                onClick={handleSend}
                                className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-[#1f2329] text-white hover:bg-black"
                            >
                                <ArrowUp size={17} />
                            </button>
                        </div>
                    </div>

                    {/* 底部模式标签 */}
                    <div className="mt-[34px] flex items-center justify-center gap-2">
                        {MODES.map(({ id, label, icon: Icon }) => {
                            const active = activeMode === id;
                            return (
                                <button
                                    key={id}
                                    onClick={() => handleMode(id)}
                                    className={`flex items-center gap-[7px] rounded-[10px] px-4 py-2 text-[13.5px] ${active
                                        ? 'bg-[#fef6e0] text-[#b8860b]'
                                        : 'text-gray-500 hover:bg-[#f4f4f5]'
                                        }`}
                                >
                                    <Icon size={16} className={active ? 'text-[#d99a1c]' : ''} />
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </section>
            </main>
        </div>
    );
}
