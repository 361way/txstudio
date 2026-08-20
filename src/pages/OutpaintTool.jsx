import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildOutpaintPayload,
    createOutpaintTask,
    pollImageTask,
} from '../api/mps';

const OUTPAINT_TOOL = {
    id: 'outpaint',
    emoji: '🖼️',
    badge: '~14s',
    title: '图片扩图',
    inputDescription: '上传需要扩展画布的图片，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '扩图编排 · ScheduleId 30010',
    parameterDescription: '选择目标画面比例，画布扩展后由 AI 智能填充新增区域，保持原图主体与风格。',
    fields: [
        { type: 'select', key: 'aspectRatio', label: '目标比例', defaultValue: '16:9', options: [
            { value: '16:9', label: '16:9（横屏）' },
            { value: '9:16', label: '9:16（竖屏）' },
            { value: '4:3', label: '4:3' },
            { value: '3:4', label: '3:4' },
            { value: '1:1', label: '1:1' },
            { value: '21:9', label: '21:9（宽幅）' },
            { value: '3:2', label: '3:2' },
            { value: '2:3', label: '2:3' },
        ] },
    ],
    submittingText: '正在提交扩图任务…',
    processingText: '画布扩展与智能填充中，请稍候…',
    completedText: '扩图完成',
    resultTitle: '扩图结果',
    comparison: true,
    createPayload: buildOutpaintPayload,
    createTask: createOutpaintTask,
    pollTask: pollImageTask,
};

export default function OutpaintTool({ onBack }) {
    return <MpsImageTaskTool tool={OUTPAINT_TOOL} onBack={onBack} />;
}
