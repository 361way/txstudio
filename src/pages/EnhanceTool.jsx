import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildEnhancePayload,
    createEnhanceTask,
    pollImageTask,
} from '../api/mps';

const ENHANCE_LEVEL_OPTIONS = [
    { value: 'strong', label: '强' },
    { value: 'normal', label: '中' },
    { value: 'weak', label: '弱' },
];

const ENHANCE_TOOL = {
    id: 'enhance',
    emoji: '✨',
    badge: '~5s',
    title: '综合增强',
    inputDescription: '上传需要增强的图片，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '图像增强 · EnhanceConfig',
    parameterDescription: '自由组合增强项：综合增强/降噪/色彩取强弱档位，细节增强/人脸增强取 0-100 强度，低光增强为开关。',
    fields: [
        { type: 'effects', key: 'effects', label: '增强效果', defaultValue: [{ type: 'quality_enhance', value: 'normal', valueType: 'enum' }], typeOptions: [
            { value: 'quality_enhance', label: '综合增强', valueType: 'enum', defaultValue: 'normal' },
            { value: 'denoise', label: '降噪', valueType: 'enum', defaultValue: 'normal' },
            { value: 'color_enhance', label: '色彩增强', valueType: 'enum', defaultValue: 'normal' },
            { value: 'sharp_enhance', label: '细节增强', valueType: 'number', defaultValue: 50 },
            { value: 'face_enhance', label: '人脸增强', valueType: 'number', defaultValue: 50 },
            { value: 'lowlight_enhance', label: '低光增强', valueType: 'switch', defaultValue: true },
        ], valueOptions: ENHANCE_LEVEL_OPTIONS, hint: '至少添加一项效果' },
    ],
    submittingText: '正在提交综合增强任务…',
    processingText: '综合增强处理中，请稍候…',
    completedText: '综合增强完成',
    resultTitle: '增强结果',
    comparison: true,
    createPayload: buildEnhancePayload,
    createTask: createEnhanceTask,
    pollTask: pollImageTask,
};

export default function EnhanceTool({ onBack }) {
    return <MpsImageTaskTool tool={ENHANCE_TOOL} onBack={onBack} />;
}
