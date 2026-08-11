import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildTextWatermarkErasePayload,
    createTextWatermarkEraseTask,
    pollImageTask,
} from '../api/mps';

const WATERMARK_ERASE_TOOL = {
    id: 'watermark-erased',
    title: '图片水印智能擦除',
    intro: '使用腾讯云 MPS 图片处理编排，自动识别并擦除图片中的文字水印。请仅处理您拥有版权或已获授权的素材。',
    inputDescription: '上传带有文字水印的图片，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '文字水印擦除编排 · ScheduleId 30000',
    parameterDescription: '上传图片后，系统会按腾讯云 MPS 文字水印擦除编排直接提交任务。',
    notice: '仅可用于您拥有版权或已获授权的图片，禁止移除他人版权标识。',
    submittingText: '正在提交文字水印擦除任务…',
    processingText: '智能擦除处理中，请稍候…',
    completedText: '智能擦除完成',
    resultTitle: '擦除结果',
    createPayload: buildTextWatermarkErasePayload,
    createTask: createTextWatermarkEraseTask,
    pollTask: pollImageTask,
};

export default function WatermarkEraseTool() {
    return <MpsImageTaskTool tool={WATERMARK_ERASE_TOOL} />;
}
