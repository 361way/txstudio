/**
 * QuotaBadge — 配额徽章，显示今日图片/视频用量 vs 上限
 * 自取数据，监听 vodstudio:usage-updated 事件刷新
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Image as ImageIcon, Video } from 'lucide-react';
import { apiGet } from '../api/client';

export default function QuotaBadge({ theme = 'dark', limits = null }) {
    const [usage, setUsage] = useState({ image_gen: 0, video_gen: 0 });
    const [lim, setLim] = useState(limits || { daily_image_gen: 0, daily_video_gen: 0 });

    const refresh = useCallback(async () => {
        try {
            const data = await apiGet('/api/billing/usage');
            const u = { image_gen: 0, video_gen: 0 };
            if (Array.isArray(data?.today)) {
                data.today.forEach((r) => {
                    if (r.type === 'image_gen') u.image_gen = r.count;
                    if (r.type === 'video_gen') u.video_gen = r.count;
                });
            }
            setUsage(u);
        } catch (e) { /* 静默，配额徽章不阻断 */ }
    }, []);

    useEffect(() => {
        refresh();
        const handler = () => refresh();
        window.addEventListener('vodstudio:usage-updated', handler);
        const interval = setInterval(refresh, 30000);
        return () => {
            window.removeEventListener('vodstudio:usage-updated', handler);
            clearInterval(interval);
        };
    }, [refresh]);

    useEffect(() => { if (limits) setLim(limits); }, [limits]);

    const imgLimit = lim.daily_image_gen || 0;
    const vidLimit = lim.daily_video_gen || 0;
    const imgLow = imgLimit > 0 && usage.image_gen >= imgLimit;
    const vidLow = vidLimit > 0 && usage.video_gen >= vidLimit;

    const badge = (Icon, used, limit, low) => (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
            low
                ? 'bg-red-950/50 text-red-300 border-red-800/60'
                : 'bg-zinc-800/60 text-zinc-300 border-white/8'
        }`}>
            <Icon className="w-3.5 h-3.5 opacity-70" />
            {used}{limit > 0 ? `/${limit}` : ''}
        </span>
    );

    return (
        <div className="flex items-center gap-1.5">
            {badge(ImageIcon, usage.image_gen, imgLimit, imgLow)}
            {badge(Video, usage.video_gen, vidLimit, vidLow)}
        </div>
    );
}
