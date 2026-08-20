import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildAddBlindWatermarkPayload,
    createAddBlindWatermarkTask,
    pollImageTask,
} from '../api/mps';

const WATERMARK_ADD_TOOL = {
    id: 'watermark-add',
    emoji: '🛡️',
    badge: '~5s',
    title: '添加盲水印',
    intro: '使用腾讯云 MPS 盲水印能力，在不影响图片视觉质量的前提下嵌入不可见的版权标记，用于内容归属与后续溯源。',
    inputDescription: '上传需要加水印的图片，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '盲水印 · AddBlindWatermark',
    parameterDescription: '把下方水印文字以不可见形式嵌入图片；提取时需使用同一桶内图片。',
    fields: [
        {
            key: 'watermarkText',
            label: '盲水印文字',
            placeholder: '如：TxStudio',
            required: true,
            maxLength: 12,
            hint: 'MPS 限制 Base64 解码后 12 字节：英文约 12 个字符，中文约 4 个汉字。',
        },
    ],
    notice: '盲水印为不可见水印，不影响观感；可用「提取盲水印」能力验证归属。',
    submittingText: '正在提交添加盲水印任务…',
    processingText: '盲水印嵌入中，请稍候…',
    completedText: '盲水印添加完成',
    resultTitle: '加水印结果',
    comparison: true,
    createPayload: buildAddBlindWatermarkPayload,
    createTask: createAddBlindWatermarkTask,
    pollTask: pollImageTask,
};

export default function WatermarkAddTool({ onBack }) {
    return <MpsImageTaskTool tool={WATERMARK_ADD_TOOL} onBack={onBack} />;
}
