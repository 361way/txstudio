import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildForegroundExtractionPayload,
    createForegroundExtractionTask,
    pollImageTask,
} from '../api/mps';

const FOREGROUND_EXTRACTION_TOOL = {
    id: 'foreground-extraction',
    title: '前景提取',
    intro: '使用腾讯云 MPS AI 抠图能力识别图片主体，输出透明背景的前景图片，适用于商品主图、人物与常见前景对象。',
    inputDescription: '上传一张需要提取主体的图片，或提供公开可访问的 URL。系统会先安全转存至您的 MPS COS Bucket。',
    parameterLabel: 'AI 抠图 · foreground',
    parameterDescription: '无需额外参数。系统使用 AiCutoutConfig（Switch=ON，Type=foreground）提交腾讯云 MPS ProcessImage 任务。',
    notice: '请仅处理您拥有版权或已获授权的图片素材。复杂透明材质、极低对比背景或多主体图片可能影响边缘效果。',
    submittingText: '正在提交前景提取任务…',
    processingText: '正在识别并提取前景…',
    completedText: '前景提取完成',
    resultTitle: '前景提取结果',
    createPayload: buildForegroundExtractionPayload,
    createTask: createForegroundExtractionTask,
    pollTask: pollImageTask,
    comparison: true,
};

export default function ForegroundExtractionTool() {
    return <MpsImageTaskTool tool={FOREGROUND_EXTRACTION_TOOL} />;
}
