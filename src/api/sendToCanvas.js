import { createProject, getCanvas, listProjects, saveCanvas } from './project';

// 与 App.jsx addNode 的默认节点尺寸保持一致，避免同一画布内同类节点大小不一。
const DEFAULT_NODE_SIZE = { image: { w: 260, h: 260 }, video: { w: 580, h: 460 } };

const safeNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

function normalizeAssetUrl(asset) {
    if (typeof asset === 'string') return asset;
    return asset?.cloud_url || asset?.mediaUrl || asset?.url || asset?.local_path || '';
}

/** 依据媒体 URL 推断素材类型；无法判断时按调用方声明处理。 */
export function inferMediaType(asset, fallback = 'image') {
    if (typeof asset === 'object' && asset?.media_type) return asset.media_type;
    const url = normalizeAssetUrl(asset);
    if (/\.(mp4|mov|webm|m4v|avi|mkv)(\?|#|$)/i.test(url)) return 'video';
    if (/\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/i.test(url)) return 'image';
    return fallback;
}

/**
 * 生成可写入目标画布的节点。
 * 图片使用 input-image，视频使用 video-input，均保留生成提示词便于二次创作。
 */
export function buildCanvasAssetNode(asset, { mediaType, index = 0, prompt = '', modelName = '' } = {}) {
    const url = normalizeAssetUrl(asset);
    if (!url) return null;
    const type = mediaType || inferMediaType(asset);
    const isVideo = type === 'video';
    const size = isVideo ? DEFAULT_NODE_SIZE.video : DEFAULT_NODE_SIZE.image;
    return {
        id: `node-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        type: isVideo ? 'video-input' : 'input-image',
        x: 160 + (index % 5) * (size.w + 40),
        y: 160 + Math.floor(index / 5) * (size.h + 40),
        width: size.w,
        height: size.h,
        content: url,
        dimensions: asset?.width && asset?.height
            ? { w: safeNumber(asset.width), h: safeNumber(asset.height) }
            : undefined,
        settings: {
            sourcePrompt: typeof prompt === 'string' ? prompt.slice(0, 2000) : '',
            sourceModel: typeof modelName === 'string' ? modelName : '',
        },
    };
}

function normalizeCanvasSnapshot(canvas) {
    if (!canvas || typeof canvas !== 'object') {
        return { nodes: [], connections: [], view: { x: 0, y: 0, zoom: 1 } };
    }
    return {
        ...canvas,
        nodes: Array.isArray(canvas.nodes) ? canvas.nodes : [],
        connections: Array.isArray(canvas.connections) ? canvas.connections : [],
        view: canvas.view && typeof canvas.view === 'object' ? canvas.view : { x: 0, y: 0, zoom: 1 },
    };
}

/**
 * 把素材追加写入指定项目的画布。
 *
 * 重要：画布保存队列只服务当前活跃项目，向别的项目写入必须直接调 saveCanvas。
 * 因此这里必须做两件事，否则会造成数据丢失：
 * 1. 读取失败绝不静默当作空画布（否则会把目标画布整体清空）；
 * 2. 用一串行的轻量互斥锁避免与画布自动保存并发 read-modify-write 互相覆盖。
 */
const canvasWriteLocks = new Map();

function withCanvasLock(projectId, task) {
    const key = String(projectId);
    const previous = canvasWriteLocks.get(key) || Promise.resolve();
    const next = previous.then(task, task);
    // 无论成功失败都释放锁，避免一次失败卡死后续所有发送。
    canvasWriteLocks.set(key, next.then(() => undefined, () => undefined));
    return next;
}

export async function appendAssetsToCanvas(projectId, nodes) {
    if (projectId === '' || projectId == null) throw new Error('请先选择目标画布项目');
    if (!Array.isArray(nodes) || nodes.length === 0) throw new Error('没有可发送的素材');
    return withCanvasLock(projectId, async () => {
        // 不做 catch(() => null)：读取失败必须中断，绝不能用空快照覆盖目标画布。
        const current = normalizeCanvasSnapshot(await getCanvas(projectId));
        const next = {
            ...current,
            nodes: [...current.nodes, ...nodes],
            projectName: current.projectName || '',
        };
        await saveCanvas(projectId, next);
        return { projectId, appended: nodes.length, totalNodes: next.nodes.length };
    });
}

/** 列出可选画布项目，保证返回数组便于直接渲染下拉框。 */
export async function listCanvasTargets() {
    const projects = await listProjects();
    return Array.isArray(projects) ? projects : [];
}

/** 新建画布项目并立即写入一批素材。 */
export async function createCanvasWithAssets(name, nodes, { index = 0 } = {}) {
    const projectName = (name || '').trim() || '未命名项目';
    const project = await createProject(projectName);
    const result = await appendAssetsToCanvas(project?.id, nodes.map((node, offset) => ({
        ...node,
        id: `node-${Date.now()}-${index + offset}-${Math.random().toString(36).slice(2, 8)}`,
        x: 160 + ((index + offset) % 5) * (node.width + 40),
        y: 160 + Math.floor((index + offset) / 5) * (node.height + 40),
    })));
    return { project, ...result };
}
