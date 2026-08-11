import React, { useRef, useState } from 'react';
import { Download, Maximize2, MoveHorizontal } from 'lucide-react';

// 高对比棋盘格：清晰衬出前景提取结果的透明区域。
const CHECKER =
    'bg-[linear-gradient(45deg,#c9c9c9_25%,transparent_25%,transparent_75%,#c9c9c9_75%),linear-gradient(45deg,#c9c9c9_25%,transparent_25%,transparent_75%,#c9c9c9_75%)] bg-[length:22px_22px] bg-[position:0_0,11px_11px] bg-white';

function downloadName(value, fallback) {
    const source = String(value || '').split('?')[0];
    const extension = source.match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'png';
    return `${fallback}.${extension}`;
}

/** 原图与处理结果的拖动/左右对比面板。 */
export default function ImageComparisonPanel({ sourceURL, resultURL, title = '处理结果', downloadPrefix = 'result' }) {
    const [mode, setMode] = useState('drag');
    const [position, setPosition] = useState(50);
    const [dragging, setDragging] = useState(false);
    const frameRef = useRef(null);

    const updatePosition = (clientX) => {
        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect?.width) return;
        setPosition(Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100)));
    };

    const onPointerDown = (event) => {
        frameRef.current?.setPointerCapture?.(event.pointerId);
        setDragging(true);
        updatePosition(event.clientX);
    };
    const onPointerMove = (event) => {
        if (dragging) updatePosition(event.clientX);
    };
    const stopDrag = () => setDragging(false);
    const onKeyDown = (event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); setPosition((p) => Math.max(2, p - 4)); }
        if (event.key === 'ArrowRight') { event.preventDefault(); setPosition((p) => Math.min(98, p + 4)); }
    };

    return (
        <section className="mt-7 overflow-hidden rounded-[22px] border border-[#e3ddcf] bg-white shadow-[0_16px_50px_rgba(61,48,20,0.06)]">
            <header className="flex flex-col gap-4 border-b border-[#eee9dd] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b4871e]"><span className="h-px w-6 bg-[#ddb64d]" /> Before & After</div>
                    <h2 className="mt-1.5 text-lg font-semibold text-[#292720]">{title}对比</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-xl border border-[#e2ddcf] bg-[#f7f6f1] p-1" role="tablist" aria-label="图片对比模式">
                        <button type="button" role="tab" aria-selected={mode === 'drag'} onClick={() => setMode('drag')} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${mode === 'drag' ? 'bg-[#f4c74f] text-[#3b2d0b] shadow-sm' : 'text-[#81796b] hover:text-[#3b352a]'}`}>拖动对比</button>
                        <button type="button" role="tab" aria-selected={mode === 'split'} onClick={() => setMode('split')} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${mode === 'split' ? 'bg-[#f4c74f] text-[#3b2d0b] shadow-sm' : 'text-[#81796b] hover:text-[#3b352a]'}`}>左右对比</button>
                    </div>
                    <a href={resultURL} download={downloadName(resultURL, downloadPrefix)} className="inline-flex items-center gap-1.5 rounded-xl border border-[#ddd7ca] bg-white px-3 py-2 text-xs font-medium text-[#5f584c] transition hover:border-[#caa23d] hover:bg-[#fffaf0]" title="下载前景提取图片"><Download size={14} />下载结果</a>
                    <a href={resultURL} target="_blank" rel="noreferrer" className="rounded-xl border border-[#ddd7ca] bg-white p-2 text-[#71695d] transition hover:border-[#caa23d] hover:bg-[#fffaf0]" title="新窗口查看结果"><Maximize2 size={14} /></a>
                </div>
            </header>

            {mode === 'drag' ? (
                <div className="bg-[#f4f2ec] p-3 sm:p-5">
                    <div
                        ref={frameRef}
                        role="slider"
                        aria-label="拖动对比分割线"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(position)}
                        tabIndex={0}
                        onKeyDown={onKeyDown}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={stopDrag}
                        onPointerCancel={stopDrag}
                        onPointerLeave={stopDrag}
                        className={`relative mx-auto aspect-[16/10] max-h-[680px] max-w-[1080px] cursor-ew-resize touch-none select-none overflow-hidden rounded-xl outline-none ring-[#caa23d]/60 focus-visible:ring-2 ${dragging ? '' : ''} bg-[#e8e5dc]`}
                    >
                        {/* 底层：原图 */}
                        <img src={sourceURL} alt="原图" className="pointer-events-none absolute inset-0 h-full w-full object-contain" draggable="false" />
                        {/* 上层：前景提取结果（棋盘底衬出透明区），仅显示分割线左侧 */}
                        <div className={`pointer-events-none absolute inset-0 overflow-hidden ${CHECKER}`} style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
                            <img src={resultURL} alt={title} className="absolute inset-0 h-full w-full object-contain" draggable="false" />
                        </div>
                        <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white">{title}</span>
                        <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white">原图</span>
                        <div className="pointer-events-none absolute inset-y-0 w-[3px] -translate-x-1/2 bg-[#f4c74f] shadow-[0_0_0_1px_rgba(80,55,10,0.2)]" style={{ left: `${position}%` }} />
                        <div className="pointer-events-none absolute top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[#f4c74f] text-[#392b0a] shadow-[0_4px_13px_rgba(68,47,7,0.28)]" style={{ left: `${position}%` }}><MoveHorizontal size={19} /></div>
                    </div>
                    <p className="mt-3 text-center text-xs text-[#91897b]">按住并左右拖动黄色分割线（也可用 ← → 键），左侧为去除背景后的前景，右侧为原图。</p>
                </div>
            ) : (
                <div className="grid gap-px bg-[#e9e4d8] md:grid-cols-2">
                    <figure className="bg-[#f8f7f3] p-3 sm:p-5"><figcaption className="mb-3 text-xs font-medium text-[#6f675b]">原图</figcaption><div className="aspect-[4/3] overflow-hidden rounded-xl bg-[#e8e5dc]"><img src={sourceURL} alt="原图" className="h-full w-full object-contain" /></div></figure>
                    <figure className="bg-[#f8f7f3] p-3 sm:p-5"><figcaption className="mb-3 text-xs font-medium text-[#6f675b]">{title}</figcaption><div className={`aspect-[4/3] overflow-hidden rounded-xl ${CHECKER}`}><img src={resultURL} alt={title} className="h-full w-full object-contain" /></div></figure>
                </div>
            )}
        </section>
    );
}
