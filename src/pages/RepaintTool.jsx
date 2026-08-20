import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildRepaintPayload,
    createRepaintTask,
    pollImageTask,
} from '../api/mps';

const REPAINT_TOOL = {
    id: 'repaint',
    emoji: '🖌️',
    badge: '~15s',
    title: '局部重绘',
    inputDescription: '上传需要重绘的图片作为参考图，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '局部重绘 · CreateImageConfig 图生图',
    parameterDescription: '描述要重绘的内容与位置（如：把画面左侧的椅子换成落地灯），官方同款实现：区域提示拼入提示词后走图生图。',
    fields: [
        { type: 'text', key: 'prompt', label: '重绘描述', required: true, placeholder: '如：把画面中间的背包换成帆布包，其余保持不变', maxLength: 500 },
        { type: 'select', key: 'model', label: '生图模型', defaultValue: 'WAND-create-1.0-flash', options: [
            { value: 'WAND-create-1.0-flash', label: 'WAND-create-1.0-flash（速度优先）' },
            { value: 'WAND-create-1.0-lite', label: 'WAND-create-1.0-lite（质量优先）' },
        ] },
        { type: 'select', key: 'resolution', label: '分辨率', defaultValue: '2K', options: [
            { value: '1K', label: '1K' },
            { value: '2K', label: '2K' },
            { value: '4K', label: '4K' },
        ] },
        { type: 'select', key: 'aspectRatio', label: '画面比例', defaultValue: '1:1', options: [
            { value: '1:1', label: '1:1' },
            { value: '3:2', label: '3:2' },
            { value: '2:3', label: '2:3' },
            { value: '3:4', label: '3:4' },
            { value: '4:3', label: '4:3' },
            { value: '9:16', label: '9:16' },
            { value: '16:9', label: '16:9' },
        ] },
    ],
    submittingText: '正在提交局部重绘任务…',
    processingText: '局部重绘中，请稍候…',
    completedText: '局部重绘完成',
    resultTitle: '重绘结果',
    comparison: true,
    createPayload: buildRepaintPayload,
    createTask: createRepaintTask,
    pollTask: pollImageTask,
};

export default function RepaintTool({ onBack }) {
    return <MpsImageTaskTool tool={REPAINT_TOOL} onBack={onBack} />;
}
