import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildExtractBlindWatermarkPayload,
    createExtractBlindWatermarkTask,
    pollBlindWatermarkExtractTask,
} from '../api/mps';

const WATERMARK_EXTRACT_TOOL = {
    id: 'watermark-extract',
    emoji: '🔓',
    badge: '~5s',
    title: '提取盲水印',
    intro: '使用腾讯云 MPS 盲水印提取能力，检测并提取图片中嵌入的不可见版权标记，用于归属判断与溯源验证。',
    inputDescription: '上传带盲水印的图片，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '盲水印 · ExtractBlindWatermark',
    parameterDescription: '自动检测图片中的基础版权数字水印并提取其内容文本。',
    isTextResult: true,
    emptyTextResult: '未检测到水印',
    textResultLabel: '提取到的盲水印',
    notice: '仅能提取由「添加盲水印」或同款 MPS 基础版权水印嵌入的内容；未检测到水印时结果为空。',
    submittingText: '正在提交提取盲水印任务…',
    processingText: '盲水印提取中，请稍候…',
    completedText: '盲水印提取完成',
    resultTitle: '提取结果',
    comparison: false,
    createPayload: buildExtractBlindWatermarkPayload,
    createTask: createExtractBlindWatermarkTask,
    pollTask: pollBlindWatermarkExtractTask,
};

export default function WatermarkExtractTool({ onBack }) {
    return <MpsImageTaskTool tool={WATERMARK_EXTRACT_TOOL} onBack={onBack} />;
}
