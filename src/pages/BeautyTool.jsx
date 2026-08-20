import React from 'react';
import MpsImageTaskTool from '../components/MpsImageTaskTool';
import {
    buildBeautyPayload,
    createBeautyTask,
    pollImageTask,
} from '../api/mps';

const BEAUTY_TOOL = {
    id: 'beauty',
    emoji: '💄',
    badge: '~5s',
    title: '美颜美化',
    inputDescription: '上传需要美颜的人物照片，或提供公开可访问的 URL。系统会先转存到您的 MPS COS Bucket。',
    parameterLabel: '美颜 · BeautyConfig（19 美颜 + 3 滤镜）',
    parameterDescription: '自由组合美颜与滤镜效果，每项 0-100 强度可调；至少添加一项。',
    notice: '美颜作用于人像；非人像图片影响较小。',
    fields: [
        { type: 'effects', key: 'effects', label: '美颜 / 滤镜效果', defaultValue: [{ type: 'Smooth', value: 60 }], typeOptions: [
            { value: 'Whiten', label: '美白', defaultValue: 70 },
            { value: 'BlackAlpha1', label: '美黑', defaultValue: 50 },
            { value: 'BlackAlpha2', label: '较强美黑', defaultValue: 50 },
            { value: 'FoundationAlpha2', label: '美白-粉白', defaultValue: 50 },
            { value: 'Clear', label: '清晰度', defaultValue: 50 },
            { value: 'Sharpen', label: '锐化', defaultValue: 50 },
            { value: 'Smooth', label: '磨皮', defaultValue: 60 },
            { value: 'BeautyThinFace', label: '瘦脸', defaultValue: 40 },
            { value: 'NatureFace', label: '自然脸型', defaultValue: 50 },
            { value: 'VFace', label: 'V 脸', defaultValue: 50 },
            { value: 'EnlargeEye', label: '大眼', defaultValue: 40 },
            { value: 'EyeLighten', label: '亮眼', defaultValue: 50 },
            { value: 'RemoveEyeBags', label: '祛眼袋', defaultValue: 50 },
            { value: 'ThinNose', label: '瘦鼻', defaultValue: 50 },
            { value: 'RemoveLawLine', label: '祛法令纹', defaultValue: 50 },
            { value: 'CheekboneThin', label: '瘦颧骨', defaultValue: 50 },
            { value: 'ToothWhiten', label: '牙齿美白', defaultValue: 50 },
            { value: 'FaceFeatureSoftlight', label: '柔光', defaultValue: 50 },
            { value: 'Makeup', label: '美妆', defaultValue: 50 },
            { value: 'Dongjing', label: '滤镜 · 东京', defaultValue: 40 },
            { value: 'Qingjiaopian', label: '滤镜 · 轻胶片', defaultValue: 40 },
            { value: 'Meiwei', label: '滤镜 · 美味', defaultValue: 40 },
        ], hint: '至少添加一项效果' },
    ],
    submittingText: '正在提交美颜美化任务…',
    processingText: '美颜美化处理中，请稍候…',
    completedText: '美颜美化完成',
    resultTitle: '美颜结果',
    comparison: true,
    createPayload: buildBeautyPayload,
    createTask: createBeautyTask,
    pollTask: pollImageTask,
};

export default function BeautyTool({ onBack }) {
    return <MpsImageTaskTool tool={BEAUTY_TOOL} onBack={onBack} />;
}
