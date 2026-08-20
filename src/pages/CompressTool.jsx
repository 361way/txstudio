import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildCompressPayload,
    createCompressTask,
    pollImageTask,
} from '../api/mps';

const COMPRESS_TOOL = {
    id: 'compress',
    emoji: '📦',
    badge: '~3s',
    title: '图片压缩',
    intro: '使用腾讯云 MPS 图片编码能力，在保持视觉质量的前提下压缩图片体积，保留原格式，适合电商与网络页面使用。',
    inputDescription: '上传需要压缩的图片，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '图片编码 · EncodeConfig',
    parameterDescription: '按原图格式重新编码，相对质量设为 70（1-100，数值以原图质量为标准）。',
    notice: '压缩会改变图片文件体积与画质平衡；如需转格式可后续在 COS 控制台处理。',
    submittingText: '正在提交图片压缩任务…',
    processingText: '图片压缩处理中，请稍候…',
    completedText: '图片压缩处理完成',
    resultTitle: '压缩结果',
    comparison: true,
    createPayload: buildCompressPayload,
    createTask: createCompressTask,
    pollTask: pollImageTask,
};

export default function CompressTool({ onBack }) {
    return <MpsImageTaskTool tool={COMPRESS_TOOL} onBack={onBack} />;
}
