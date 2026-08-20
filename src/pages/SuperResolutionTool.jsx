import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildSuperResolutionPayload,
    createSuperResolutionTask,
    pollImageTask,
} from '../api/mps';

const SUPER_RESOLUTION_TOOL = {
    id: 'super-resolution',
    emoji: '⬆️',
    badge: '~5s',
    title: '超分辨率',
    inputDescription: '上传需要放大的图片，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '高级超分 · AdvancedSuperResolutionConfig',
    parameterDescription: 'ultra 通用高清放大；fidelity 超高保真度（适合文字/图形）。超分后尺寸上限 8192 × 8192。',
    fields: [
        { type: 'select', key: 'advSrType', label: '超分模型', defaultValue: 'ultra', options: [
            { value: 'ultra', label: 'Ultra（默认，通用）' },
            { value: 'fidelity', label: 'Fidelity（超高保真度）' },
        ] },
        { type: 'select', key: 'sizeMode', label: '超分目标', defaultValue: 'percent', options: [
            { value: 'percent', label: '按倍数放大' },
            { value: 'aspect', label: '指定边长' },
        ] },
        { type: 'slider', key: 'scale', label: '放大倍数', defaultValue: 2, min: 1, max: 4, step: 0.5, hint: '1.0 ~ 4.0 倍' },
        { type: 'select', key: 'edgeType', label: '边长类型', defaultValue: 'long', options: [
            { value: 'long', label: '指定长边' },
            { value: 'short', label: '指定短边' },
        ] },
        { type: 'text', key: 'edgeValue', label: '目标边长像素', defaultValue: '2048', placeholder: '≤ 8192', hint: '仅「指定边长」模式生效' },
    ],
    submittingText: '正在提交超分辨率任务…',
    processingText: '超分处理中，请稍候…',
    completedText: '超分完成',
    resultTitle: '超分结果',
    comparison: true,
    createPayload: buildSuperResolutionPayload,
    createTask: createSuperResolutionTask,
    pollTask: pollImageTask,
};

export default function SuperResolutionTool({ onBack }) {
    return <MpsImageTaskTool tool={SUPER_RESOLUTION_TOOL} onBack={onBack} />;
}
