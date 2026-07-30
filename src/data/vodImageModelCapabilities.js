const STANDARD_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '16:9', '9:16'];
const WIDE_RATIOS = [...STANDARD_RATIOS, '21:9', '9:21'];
const STANDARD_RESOLUTIONS = ['1K', '2K', '4K'];

// 依据 /Users/jerry/CodeBuddy/vodoc/vodoc.db 中各 AIGC image Wiki 条目整理。
// 未在 Wiki 中明确给出版本级别上限时，使用保守值，避免向 VOD 发送不被支持的参数。
export const VOD_IMAGE_MODEL_CAPABILITIES = {
    OG: {
        wikiSlug: 'aigc-image-OG',
        ratios: WIDE_RATIOS,
        resolutions: STANDARD_RESOLUTIONS,
        defaultRatio: '1:1',
        defaultResolution: '1K',
        maxReferences: 16,
        description: 'GPT-Image / Image2.0，多参考图与文字还原能力强。',
    },
    GEM: {
        wikiSlug: 'aigc-image-GEM',
        ratios: [...WIDE_RATIOS, '4:5'],
        resolutions: STANDARD_RESOLUTIONS,
        defaultRatio: '1:1',
        defaultResolution: '1K',
        maxReferences: 1,
        description: 'Gemini 图像模型；多参考上限以服务端实际能力为准。',
    },
    SI: {
        wikiSlug: 'aigc-image-SI',
        ratios: STANDARD_RATIOS,
        resolutions: ['1K', '2K', '3K', '4K'],
        defaultRatio: '1:1',
        defaultResolution: '1K',
        maxReferences: 1,
        maxReferencesByVersion: { '5.0-lite': 14 },
        description: 'Seed Image 系列，适合人物、写实与风格化创作。',
    },
    Qwen: {
        wikiSlug: 'aigc-image-Qwen',
        ratios: ['1:1', '16:9', '9:16', '3:4', '4:3'],
        resolutions: [],
        defaultRatio: '1:1',
        defaultResolution: '',
        maxReferences: 1,
        description: '千问图像模型，支持自由尺寸；此处不发送未在 UI 中精确配置的尺寸字段。',
    },
    Hunyuan: {
        wikiSlug: 'aigc-image-Hunyuan',
        ratios: WIDE_RATIOS,
        resolutions: STANDARD_RESOLUTIONS,
        defaultRatio: '1:1',
        defaultResolution: '1K',
        maxReferences: 3,
        description: '混元 3.0 通用生图，适合写实、国风与商业素材。',
    },
    Vidu: {
        wikiSlug: 'aigc-image-Vidu',
        ratios: STANDARD_RATIOS,
        resolutions: STANDARD_RESOLUTIONS,
        defaultRatio: '1:1',
        defaultResolution: '1K',
        maxReferences: 7,
        description: 'Vidu q2 图像模型，支持多参考图创作。',
    },
    Kling: {
        wikiSlug: 'aigc-image-Kling',
        ratios: STANDARD_RATIOS,
        resolutions: STANDARD_RESOLUTIONS,
        defaultRatio: '1:1',
        defaultResolution: '1K',
        maxReferences: 1,
        maxReferencesByVersion: { '2.1': 4, '3.0': 1, '3.0-Omni': 10, O1: 10 },
        description: '可灵生图：O1 与 3.0-Omni 适合多参考、叙事与角色一致性。',
    },
};

const FALLBACK_CAPABILITY = {
    wikiSlug: '',
    ratios: STANDARD_RATIOS,
    resolutions: STANDARD_RESOLUTIONS,
    defaultRatio: '1:1',
    defaultResolution: '1K',
    maxReferences: 1,
    description: '参数将按 VOD 当前模型能力校验。',
};

export function getVodImageModelCapability(modelName, modelVersion) {
    const capability = VOD_IMAGE_MODEL_CAPABILITIES[modelName] || FALLBACK_CAPABILITY;
    return {
        ...capability,
        maxReferences: capability.maxReferencesByVersion?.[modelVersion] || capability.maxReferences,
    };
}
