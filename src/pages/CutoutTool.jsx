import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildCutoutPayload,
    createCutoutTask,
    pollImageTask,
} from '../api/mps';

const CUTOUT_TOOL = {
    id: 'cutout',
    emoji: '✂️',
    badge: '~12s',
    title: '智能抠图',
    inputDescription: '上传需要抠图的商品图，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '智能抠图编排 · ScheduleId 30030',
    parameterDescription: '默认参数即可获得发丝级边缘；高级场景可微调透明度阈值与边缘采样步长。',
    fields: [
        { type: 'text', key: 'transparencyThreshold', label: '透明阈值（0-255）', defaultValue: '30', hint: '低于该值视为完全透明，通常保持默认 30' },
        { type: 'text', key: 'opaqueThreshold', label: '不透明阈值（0-255）', defaultValue: '127', hint: '高于该值视为完全不透明，通常保持默认 127' },
        { type: 'text', key: 'edgeSamplingStep', label: '边缘采样步长', defaultValue: '5', hint: '发丝等半透明边缘的采样密度，越小越精细' },
    ],
    submittingText: '正在提交抠图任务…',
    processingText: '抠图中，请稍候…',
    completedText: '抠图完成',
    resultTitle: '抠图结果',
    comparison: true,
    createPayload: buildCutoutPayload,
    createTask: createCutoutTask,
    pollTask: pollImageTask,
};

export default function CutoutTool({ onBack }) {
    return <MpsImageTaskTool tool={CUTOUT_TOOL} onBack={onBack} />;
}
