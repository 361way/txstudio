import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildBgfusionPayload,
    createBgfusionTask,
    pollImageTask,
} from '../api/mps';

const BGFUSION_TOOL = {
    id: 'bgfusion',
    emoji: '🎨',
    title: '背景融合',
    badge: '~11s',
    inputSectionTitle: '产品图',
    inputDescription: '上传商品主体图，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: 'AI 背景融合 · CreateImageConfig(WAND-create)',
    parameterDescription: '不上传背景图时进入背景生成模式，需填写背景描述。',
    maxExtraImages: 1,
    extraImagesLabel: '背景图（可选）',
    extraImagesHint: '上传参考背景图后，商品将融合到该背景中；不上传则按背景描述由 AI 生成背景。',
    fields: [
        { type: 'input', key: 'prompt', label: '背景描述', placeholder: '如：现代简约客厅，午后柔和自然光，木地板与绿植', hint: '未上传背景图时必填（生成模式）；其他情况可选，用于补充融合要求。' },
        { type: 'select', key: 'model', label: '模型', defaultValue: 'WAND-create-1.0-flash', options: [
            { value: 'WAND-create-1.0-lite', label: 'WAND-create-1.0-lite（轻量）' },
            { value: 'WAND-create-1.0-flash', label: 'WAND-create-1.0-flash（质量-速度平衡，默认）' },
            { value: 'WAND-create-1.0-pro', label: 'WAND-create-1.0-pro（高质量）' },
        ] },
        { type: 'select', key: 'resolution', label: '输出分辨率', defaultValue: '2K', options: [
            { value: '1K', label: '1K · 短边 1080' },
            { value: '2K', label: '2K · 短边 1440（默认）' },
            { value: '4K', label: '4K · 短边 2160' },
        ] },
        { type: 'select', key: 'aspectRatio', label: '宽高比', defaultValue: '1:1', options: [
            { value: '1:1', label: '1:1' },
            { value: '3:4', label: '3:4' },
            { value: '4:3', label: '4:3' },
            { value: '9:16', label: '9:16' },
            { value: '16:9', label: '16:9' },
        ] },
    ],
    // 官方校验：不上传背景图时，背景描述必填（背景生成模式）。
    validate: (values, extraSources) => {
        const hasBg = Array.isArray(extraSources) && extraSources.length > 0;
        if (!hasBg && !String(values.prompt || '').trim()) {
            return '未上传背景图时，背景描述必填（背景生成模式）';
        }
        return null;
    },
    submittingText: '正在提交背景融合任务…',
    processingText: '背景融合中，请稍候…',
    completedText: '背景融合完成',
    resultTitle: '融合结果',
    comparison: true,
    createPayload: buildBgfusionPayload,
    createTask: createBgfusionTask,
    pollTask: pollImageTask,
};

export default function BgfusionTool({ onBack }) {
    return <MpsImageTaskTool tool={BGFUSION_TOOL} onBack={onBack} />;
}