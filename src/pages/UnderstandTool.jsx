import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildUnderstandPayload,
    createUnderstandTask,
    pollUnderstandTask,
} from '../api/mps';

const UNDERSTAND_TOOL = {
    id: 'understand',
    emoji: '💡',
    badge: '~3s',
    title: '图片理解',
    inputDescription: '上传需要理解的图片，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '图片理解编排 · ScheduleId 30200（Gemini）',
    parameterDescription: '输入针对图片的提问，AI 看图回答 / 描述画面。',
    fields: [
        { type: 'text', key: 'prompt', label: '提问内容', required: true, placeholder: '如：描述这张图片的主体、场景和风格', hint: '也可让它读出图中文字、分析构图等' },
        { type: 'select', key: 'modelName', label: '理解模型', defaultValue: 'Google/gemini-2.5-flash', options: [
            { value: 'Google/gemini-2.5-flash', label: 'gemini-2.5-flash（速度优先，默认）' },
            { value: 'Google/gemini-2.5-pro', label: 'gemini-2.5-pro（深度理解）' },
        ] },
    ],
    submittingText: '正在提交图片理解任务…',
    processingText: 'AI 正在看图理解，请稍候…',
    completedText: '图片理解完成',
    resultTitle: '理解结果',
    isTextResult: true,
    longTextResult: true,
    textResultLabel: '理解结果',
    createPayload: buildUnderstandPayload,
    createTask: createUnderstandTask,
    pollTask: pollUnderstandTask,
};

export default function UnderstandTool({ onBack }) {
    return <MpsImageTaskTool tool={UNDERSTAND_TOOL} onBack={onBack} />;
}
