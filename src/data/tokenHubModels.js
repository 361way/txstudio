// ============================================================================
// TokenHub 模型清单（前端静态维护）
// 来源：腾讯云官方模型列表 https://cloud.tencent.com/document/product/1823/130051
// 更新时间：2026-09（对照官方下线公告刷新）
// ----------------------------------------------------------------------------

export const TOKENHUB_TEXT_DEFAULT_MODEL_ID = 'hy4-preview';
export const TOKENHUB_MEDIA_DEFAULT_MODEL_ID = 'glm-5v-turbo';

// 已下线或已公告即将下线的 TokenHub 模型，禁止出现在任何模型选择列表中：
// - hy3-preview            2026-08-31 下线（替代：hy3）
// - kimi-k2.5              2026-08-31 下线（替代：kimi-k2.6）
// - qwen3.5-flash/plus     2026-09-08 下线
// - deepseek-v4-flash      2026-09-27 下线（预览版，替代：deepseek-v4-flash-202605）
// - youtu-vita             2026-10-15 下线（替代：HY-Vision 系列 / glm-5v-turbo）
export const TOKENHUB_DEPRECATED_MODEL_IDS = [
    'hy3-preview',
    'kimi-k2.5',
    'qwen3.5-flash',
    'qwen3.5-plus',
    'deepseek-v4-flash',
    'youtu-vita',
];

const textModels = [
    ['hy4-preview', 'Hy4 Preview'],
    ['hy3', 'Hy3'],
    ['hy-mt2-pro', 'Hy-MT2-Pro'],
    ['hy-mt2-plus', 'Hy-MT2-Plus'],
    ['hy-mt2-lite', 'Hy-MT2-Lite'],
    ['hunyuan-role-latest', 'Hy-Role-Latest'],
    ['hy-role', 'Hy-Role'],
    ['deepseek-v4-flash-202605', 'DeepSeek-V4-Flash 0731'],
    ['deepseek-v4-flash-0731', 'DeepSeek-V4-Flash 0731 直连'],
    ['deepseek-v4-pro-202606', 'DeepSeek-V4-Pro 0813'],
    ['deepseek-v4-pro-0813', 'DeepSeek-V4-Pro 0813 直连'],
    ['deepseek-v4-pro', 'DeepSeek-V4-Pro'],
    ['glm-5.3', 'GLM-5.3'],
    ['glm-5.2', 'GLM-5.2'],
    ['glm-5.1', 'GLM-5.1'],
    ['glm-5-turbo', 'GLM-5-Turbo'],
    ['glm-5', 'GLM-5'],
    ['kimi-k3', 'Kimi K3'],
    ['kimi-k2.7-code-highspeed', 'Kimi K2.7 Code HighSpeed'],
    ['kimi-k2.7-code', 'Kimi K2.7 Code'],
    ['kimi-k2.6', 'Kimi-K2.6'],
    ['minimax-m3', 'MiniMax-M3'],
    ['minimax-m2.7', 'MiniMax-M2.7'],
    ['mimo-v2.5-pro', 'MiMo-V2.5-Pro'],
].map(([id, displayName]) => ({ id, displayName, capabilities: ['text'], category: 'text' }));

const mediaModels = [
    // 带视觉理解能力的语言模型（官方模型列表标注图片/视频理解）
    {
        id: 'glm-5.3-flash',
        displayName: 'GLM-5.3-Flash',
        capabilities: ['text', 'image'],
        category: 'multimodal',
        description: '智谱原生多模态模型，支持图片理解与低成本快速推理。',
    },
    {
        id: 'glm-5v-turbo',
        displayName: 'GLM-5V-Turbo',
        capabilities: ['text', 'image', 'video'],
        category: 'multimodal',
        description: '支持图片与视频内容理解与结构化输出。',
    },
    {
        id: 'kimi-k3',
        displayName: 'Kimi K3',
        capabilities: ['text', 'image', 'video'],
        category: 'multimodal',
        description: 'Kimi 旗舰模型，1M 上下文，支持图片与视频理解。',
    },
    {
        id: 'kimi-k2.7-code-highspeed',
        displayName: 'Kimi K2.7 Code HighSpeed',
        capabilities: ['text', 'image', 'video'],
        category: 'multimodal',
        description: 'Kimi 编程高速版，支持图片与视频理解。',
    },
    {
        id: 'kimi-k2.7-code',
        displayName: 'Kimi K2.7 Code',
        capabilities: ['text', 'image', 'video'],
        category: 'multimodal',
        description: 'Kimi 编程版，支持图片与视频理解。',
    },
    {
        id: 'kimi-k2.6',
        displayName: 'Kimi-K2.6',
        capabilities: ['text', 'image', 'video'],
        category: 'multimodal',
        description: '支持图片与视频理解的多模态模型。',
    },
    {
        id: 'minimax-m3',
        displayName: 'MiniMax-M3',
        capabilities: ['text', 'image', 'video'],
        category: 'multimodal',
        description: '原生多模态，1M 上下文，支持图片与视频理解。',
    },
    {
        id: 'deepseek/deepseek-v4-flash-vision-exp',
        displayName: 'DeepSeek-V4-Flash-Vision-Exp',
        capabilities: ['text', 'image'],
        category: 'multimodal',
        description: 'DeepSeek V4-Flash 图片理解实验版。',
    },
    // 专用多模态理解模型
    {
        id: 'hy-vision-2.0-instruct',
        displayName: 'HY-Vision-2.0-Instruct',
        capabilities: ['text', 'image'],
        category: 'multimodal',
        description: '快思考图生文，适合通用图生文、OCR、图表和图片内容理解。',
    },
    {
        id: 'hunyuan-t1-vision-20250916',
        displayName: 'HY-Vision-1.5-Thinking',
        capabilities: ['text', 'image'],
        category: 'multimodal',
        description: '支持深度思考的图片理解模型。',
    },
    {
        id: 'hunyuan-turbos-vision-video-20250728',
        displayName: 'HY-Vision-Video',
        capabilities: ['text', 'video'],
        category: 'multimodal',
        description: '支持视频描述和视频内容问答。',
    },
];

export const TOKENHUB_CHAT_MODELS = [...textModels, ...mediaModels];

const modelMap = new Map(TOKENHUB_CHAT_MODELS.map((model) => [model.id, model]));

export const getTokenHubModelInfo = (modelId) => modelMap.get(String(modelId || '').trim()) || {
    id: String(modelId || '').trim(),
    displayName: String(modelId || '').trim(),
    capabilities: ['text'],
    category: 'unknown',
    description: '自定义 TokenHub 模型，请确认该服务已开通且能力与当前任务匹配。',
};

export const supportsTokenHubCapability = (modelId, capability) => (
    getTokenHubModelInfo(modelId).capabilities.includes(capability)
);

export const getTokenHubCapabilityLabel = (modelId) => {
    const capabilities = getTokenHubModelInfo(modelId).capabilities;
    if (capabilities.includes('video') && capabilities.includes('image')) return '图片 · 视频理解';
    if (capabilities.includes('video')) return '视频理解';
    if (capabilities.includes('image')) return '图片理解';
    return '文本生成';
};

export const getTokenHubTaskHint = (modelId, capability) => {
    const info = getTokenHubModelInfo(modelId);
    if (info.capabilities.includes(capability)) return info.description || `${info.displayName} 支持当前任务。`;
    const taskName = capability === 'video' ? '视频理解' : capability === 'image' ? '图片理解' : '文本生成';
    const recommended = capability === 'text' ? TOKENHUB_TEXT_DEFAULT_MODEL_ID : TOKENHUB_MEDIA_DEFAULT_MODEL_ID;
    return `${info.displayName || modelId} 不支持${taskName}，本次将自动使用 ${recommended}。`;
};

export const buildTokenHubApiConfigs = () => TOKENHUB_CHAT_MODELS.map((model) => ({
    id: model.id,
    modelName: model.id,
    displayName: model.displayName,
    provider: 'openai',
    type: 'Chat',
    apiType: 'openai',
    capabilities: [...model.capabilities],
    category: model.category,
    description: model.description || '',
}));
