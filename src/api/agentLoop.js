import { runVodAigcPipeline } from '../vodAdapter';
import { getVodImageModelCapability } from '../data/vodImageModelCapabilities';

const MODELS_KEY = 'vodstudio_api_configs';

const PIPELINE_CONTEXT = {
    credentials: {},
    useProxy: true,
    localServerUrl: import.meta.env.DEV ? 'http://127.0.0.1:8080' : window.location.origin,
};

const readJSON = (key, fallback) => {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
};

export function getAgentTextModels() {
    const configured = readJSON(MODELS_KEY, []);
    const models = Array.isArray(configured)
        ? configured.filter((item) => ['Chat', 'ChatImage'].includes(item?.type) && item?.id)
        : [];
    return models.length
        ? models.map((item) => ({
            id: item.id,
            name: item.displayName || item.modelName || item.id,
            modelName: item.modelName || item.id,
            provider: item.provider || 'openai',
        }))
        : [{ id: 'hy3-preview', name: 'hy3-preview', modelName: 'hy3-preview', provider: 'openai' }];
}

function resolveTextModelName(modelId) {
    const models = readJSON(MODELS_KEY, []);
    const config = Array.isArray(models) ? models.find((item) => item?.id === modelId) : null;
    return config?.modelName || config?.id || modelId || 'hy3-preview';
}

function extractTextResponse(payload) {
    const content = payload?.choices?.[0]?.message?.content
        ?? payload?.data?.choices?.[0]?.message?.content
        ?? payload?.content
        ?? payload?.result
        ?? payload?.data?.content;
    if (Array.isArray(content)) {
        return content.map((part) => part?.text || '').filter(Boolean).join('\n');
    }
    return typeof content === 'string' ? content : '';
}

function parseJSONObject(text, label) {
    const source = String(text || '').trim();
    const unfenced = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error(`${label}未返回有效 JSON`);
    try {
        return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
        throw new Error(`${label}返回的 JSON 无法解析`);
    }
}

async function callTextModel({ modelId, system, user, signal }) {
    const modelName = resolveTextModelName(modelId);
    const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: modelName,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            response_format: { type: 'json_object' },
            stream: false,
            temperature: 0.4,
        }),
        signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.message || `文本模型请求失败 (${response.status})`);
    }
    const text = extractTextResponse(payload);
    if (!text) throw new Error('文本模型返回为空');
    return text;
}

const cloneRun = (run) => ({
    ...run,
    characters: run.characters.map((item) => ({ ...item })),
    shots: run.shots.map((item) => ({ ...item })),
    errors: [...run.errors],
});

function normalizeCharacters(payload) {
    const list = Array.isArray(payload?.characters) ? payload.characters : [];
    return list.slice(0, 8).map((item, index) => ({
        id: `character-${index + 1}`,
        name: String(item?.name || `人物 ${index + 1}`).slice(0, 40),
        role: String(item?.role || '').slice(0, 80),
        description: String(item?.description || '').slice(0, 800),
        visualPrompt: String(item?.visual_prompt || item?.visualPrompt || item?.description || '').slice(0, 1600),
        status: 'pending',
        imageUrl: '',
        error: '',
    })).filter((item) => item.description || item.visualPrompt);
}

function normalizeShots(payload, maxShots) {
    const list = Array.isArray(payload?.shots) ? payload.shots : [];
    return list.slice(0, maxShots).map((item, index) => ({
        id: `shot-${index + 1}`,
        index: index + 1,
        title: String(item?.title || `镜头 ${index + 1}`).slice(0, 80),
        scene: String(item?.scene || '').slice(0, 1000),
        camera: String(item?.camera || '').slice(0, 300),
        dialogue: String(item?.dialogue || '').slice(0, 600),
        characters: Array.isArray(item?.characters) ? item.characters.map(String).slice(0, 8) : [],
        visualPrompt: String(item?.visual_prompt || item?.visualPrompt || item?.scene || '').slice(0, 1800),
        videoPrompt: String(item?.video_prompt || item?.videoPrompt || item?.scene || '').slice(0, 1800),
        status: 'pending',
        imageUrl: '',
        videoUrl: '',
        error: '',
    })).filter((item) => item.scene || item.visualPrompt);
}

function ensureActive(shouldContinue) {
    if (typeof shouldContinue === 'function' && !shouldContinue()) {
        const error = new Error('AgentLoop 已停止');
        error.name = 'AgentLoopStopped';
        throw error;
    }
}

export async function runScriptAgentLoop({
    script,
    textModel,
    imageModel,
    imageModelVersion,
    videoModel,
    videoModelVersion,
    aspectRatio = '16:9',
    resolution = '1080P',
    duration = '5s',
    audioGeneration = true,
    maxShots = 4,
    onUpdate,
    shouldContinue,
    signal,
}) {
    const safeMaxShots = Math.max(1, Math.min(Number(maxShots) || 4, 8));
    const run = {
        status: 'running',
        currentStage: 'extracting_characters',
        progress: 3,
        characters: [],
        shots: [],
        errors: [],
        startedAt: Date.now(),
        completedAt: null,
    };
    const emit = (patch = {}) => {
        Object.assign(run, patch);
        onUpdate?.(cloneRun(run));
    };
    const recordItemError = (item, error, context) => {
        item.status = 'failed';
        item.error = error?.message || String(error);
        run.errors.push(`${context}：${item.error}`);
        emit();
    };

    emit();
    try {
        ensureActive(shouldContinue);
        const characterText = await callTextModel({
            modelId: textModel,
            signal,
            system: '你是影视项目的角色设计总监。只输出严格 JSON，不要 Markdown。提取真实参与剧情、需要保持视觉一致性的角色；不要把路人或物品当角色。',
            user: `分析以下剧本，返回 {"characters":[{"name":"","role":"","description":"年龄、外貌、服装、气质和关键辨识特征","visual_prompt":"用于单人角色设定图生成的中文提示词，纯色背景、全身、正侧背三视图、保持可重复识别"}]}。最多 8 个角色。\n\n剧本：\n${script}`,
        });
        run.characters = normalizeCharacters(parseJSONObject(characterText, '人物提取'));
        if (!run.characters.length) throw new Error('未从剧本中提取到可生成人物');
        emit({ currentStage: 'generating_characters', progress: 12 });

        for (let index = 0; index < run.characters.length; index += 1) {
            ensureActive(shouldContinue);
            const character = run.characters[index];
            character.status = 'running';
            emit({ progress: 12 + Math.round(((index + 0.2) / run.characters.length) * 20) });
            try {
                const result = await runVodAigcPipeline({
                    type: 'image',
                    modelName: imageModel,
                    modelVersion: imageModelVersion,
                    prompt: `${character.visualPrompt}。角色名：${character.name}。角色设定图，单一人物，外貌与服装设计清晰稳定，无文字无水印。`,
                    aspectRatio: '3:4',
                    enhancePrompt: 'Enabled',
                    extraConfig: { Resolution: '1K', StorageMode: 'Temporary' },
                }, PIPELINE_CONTEXT);
                character.imageUrl = result.urls[0] || '';
                character.status = 'completed';
                emit();
            } catch (error) {
                recordItemError(character, error, `人物 ${character.name} 生成失败`);
            }
        }

        ensureActive(shouldContinue);
        emit({ currentStage: 'planning_storyboard', progress: 34 });
        const characterSummary = run.characters.map((item) => ({
            name: item.name,
            description: item.description,
        }));
        const storyboardText = await callTextModel({
            modelId: textModel,
            signal,
            system: '你是专业影视导演和分镜师。只输出严格 JSON，不要 Markdown。把剧本拆成可独立生成的连续镜头，保证人物、时空、动作衔接一致。',
            user: `基于剧本和角色表生成最多 ${safeMaxShots} 个核心镜头。返回 {"shots":[{"title":"","scene":"画面内容与动作","camera":"景别、机位和运镜","dialogue":"对白或旁白，没有则空","characters":["角色名"],"visual_prompt":"静态分镜图中文提示词","video_prompt":"从分镜图生成视频的中文提示词，描述动作、运镜、节奏与环境变化"}]}。镜头须按叙事顺序，可生成且相互衔接。\n\n角色表：${JSON.stringify(characterSummary)}\n\n剧本：\n${script}`,
        });
        run.shots = normalizeShots(parseJSONObject(storyboardText, '分镜规划'), safeMaxShots);
        if (!run.shots.length) throw new Error('未生成有效分镜');
        emit({ currentStage: 'generating_storyboards', progress: 42 });

        const imageCapability = getVodImageModelCapability(imageModel, imageModelVersion);
        for (let index = 0; index < run.shots.length; index += 1) {
            ensureActive(shouldContinue);
            const shot = run.shots[index];
            shot.status = 'storyboard_running';
            const relatedCharacters = shot.characters
                .map((name) => run.characters.find((character) => character.name === name && character.imageUrl))
                .filter(Boolean)
                .slice(0, imageCapability.maxReferences);
            emit({ progress: 42 + Math.round(((index + 0.2) / run.shots.length) * 24) });
            try {
                const result = await runVodAigcPipeline({
                    type: 'image',
                    modelName: imageModel,
                    modelVersion: imageModelVersion,
                    prompt: `${shot.visualPrompt}。${shot.camera}。电影分镜帧，统一角色造型与场景美术，无字幕无水印。`,
                    sourceImages: relatedCharacters.map((item) => item.imageUrl),
                    sourceFileInfos: relatedCharacters.map(() => ({})),
                    aspectRatio,
                    enhancePrompt: 'Enabled',
                    extraConfig: { Resolution: '1K', StorageMode: 'Temporary' },
                }, PIPELINE_CONTEXT);
                shot.imageUrl = result.urls[0] || '';
                shot.status = 'storyboard_completed';
                emit();
            } catch (error) {
                recordItemError(shot, error, `分镜 ${shot.index} 生成失败`);
            }
        }

        emit({ currentStage: 'generating_videos', progress: 68 });
        for (let index = 0; index < run.shots.length; index += 1) {
            ensureActive(shouldContinue);
            const shot = run.shots[index];
            if (!shot.imageUrl) continue;
            shot.status = 'video_running';
            emit({ progress: 68 + Math.round(((index + 0.15) / run.shots.length) * 30) });
            try {
                const result = await runVodAigcPipeline({
                    type: 'video',
                    modelName: videoModel,
                    modelVersion: videoModelVersion,
                    prompt: `${shot.videoPrompt}。保持参考分镜中的人物身份、服装、场景和构图连续。${shot.dialogue ? `对白或旁白内容：${shot.dialogue}` : ''}`,
                    sourceImages: [shot.imageUrl],
                    sourceFileInfos: [{}],
                    aspectRatio,
                    enhancePrompt: 'Enabled',
                    extraConfig: {
                        Duration: Number.parseInt(duration, 10) || 5,
                        Resolution: resolution,
                        AudioGeneration: audioGeneration ? 'Enabled' : 'Disabled',
                        StorageMode: 'Temporary',
                    },
                }, PIPELINE_CONTEXT);
                shot.videoUrl = result.urls[0] || '';
                shot.status = 'completed';
                emit();
            } catch (error) {
                recordItemError(shot, error, `视频片段 ${shot.index} 生成失败`);
            }
        }

        const hasErrors = run.errors.length > 0;
        emit({
            status: hasErrors ? 'completed_with_errors' : 'completed',
            currentStage: 'completed',
            progress: 100,
            completedAt: Date.now(),
        });
        return cloneRun(run);
    } catch (error) {
        const stopped = error?.name === 'AgentLoopStopped' || error?.name === 'AbortError';
        if (!stopped) run.errors.push(error?.message || String(error));
        emit({
            status: stopped ? 'stopped' : 'failed',
            currentStage: stopped ? 'stopped' : 'failed',
            completedAt: Date.now(),
        });
        if (!stopped) throw error;
        return cloneRun(run);
    }
}
