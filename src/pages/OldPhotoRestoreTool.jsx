import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildOldPhotoRestorePayload,
    createOldPhotoRestoreTask,
    pollImageTask,
} from '../api/mps';

const OLD_PHOTO_RESTORE_TOOL = {
    id: 'old-photo-restored',
    title: '老照片清晰修复',
    intro: '使用腾讯云 MPS 图像增强的超分辨率能力，改善老照片的清晰度与细节表现，尽量保持原始构图和人物特征。',
    inputDescription: '上传需要提升清晰度的老照片，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '图像增强 · 超分辨率',
    parameterDescription: '该能力启用腾讯云 MPS EnhanceConfig.SuperResolution，无需手动选择修复参数。',
    notice: 'MPS 当前公开图片处理接口明确支持超分辨率增强；划痕补全、黑白上色和自动补色不属于该接口已公开的专用参数。',
    submittingText: '正在提交老照片清晰修复任务…',
    processingText: '老照片清晰修复处理中，请稍候…',
    completedText: '老照片清晰修复完成',
    resultTitle: '修复结果',
    createPayload: buildOldPhotoRestorePayload,
    createTask: createOldPhotoRestoreTask,
    pollTask: pollImageTask,
};

export default function OldPhotoRestoreTool() {
    return <MpsImageTaskTool tool={OLD_PHOTO_RESTORE_TOOL} />;
}
