import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildObjectDetectPayload,
    createObjectDetectTask,
    pollImageTask,
} from '../api/mps';

const DETECTION_TOOL = {
    id: 'object-detect',
    emoji: '🎯',
    badge: '~3s',
    title: '目标检测',
    inputDescription: '上传需要检测目标的图片，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '目标检测 · ObjectDetectDescribeConfig',
    parameterDescription: '填写要检测的目标（逗号分隔），返回带检测框的 PNG 图片。',
    fields: [
        { type: 'text', key: 'prompts', label: '检测目标', required: true, placeholder: '如：鞋子，包，帽子', hint: '多个目标用逗号分隔' },
        { type: 'select', key: 'topK', label: '每目标最多检出数（TopK）', defaultValue: '1', options: [
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '3', label: '3' },
            { value: '5', label: '5' },
        ] },
    ],
    submittingText: '正在提交目标检测任务…',
    processingText: '目标检测中，请稍候…',
    completedText: '目标检测完成',
    resultTitle: '检测结果',
    createPayload: buildObjectDetectPayload,
    createTask: createObjectDetectTask,
    pollTask: pollImageTask,
};

export default function DetectionTool({ onBack }) {
    return <MpsImageTaskTool tool={DETECTION_TOOL} onBack={onBack} />;
}
