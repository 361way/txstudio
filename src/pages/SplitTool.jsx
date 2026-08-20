import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildSplitPayload,
    createSplitTask,
    pollImageTask,
} from '../api/mps';

const SPLIT_TOOL = {
    id: 'split',
    emoji: '📐',
    badge: '~2min',
    title: '分镜拆图',
    inputDescription: '上传漫画宫格或多分镜图片，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '分镜拆图编排 · ScheduleId 30050',
    parameterDescription: '自动识别并拆分图片中的分镜/宫格，输出各分镜完整原图。',
    fields: [
        { type: 'select', key: 'eraseText', label: '擦除分镜文字', defaultValue: 'true', options: [
            { value: 'true', label: '是（输出干净分镜）' },
            { value: 'false', label: '否（保留原文字）' },
        ] },
        { type: 'text', key: 'processIndex', label: '仅处理第几格（可选）', placeholder: '如 2；留空拆全部', hint: '留空时拆分全部宫格' },
    ],
    submittingText: '正在提交分镜拆图任务…',
    processingText: '分镜识别与拆分中，请稍候…',
    completedText: '分镜拆图完成',
    resultTitle: '拆分结果',
    createPayload: buildSplitPayload,
    createTask: createSplitTask,
    pollTask: pollImageTask,
};

export default function SplitTool({ onBack }) {
    return <MpsImageTaskTool tool={SPLIT_TOOL} onBack={onBack} />;
}
