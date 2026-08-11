// 将 awesome-gpt-image-2 仓库的案例（提示词 + 图片 + 分类）导入数据库启动种子。
// 用法：node scripts/import-gpt-image2.mjs <repoDir>
//  - 更新 backend/internal/seed/system_image_templates.json 中的上游案例元数据
//  - 拷贝案例图片到 backend/data/cache/cases/（经 /file/cases/... 访问）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const repoDir = process.argv[2] || '/tmp/gptimg2';
const casesFile = path.join(repoDir, 'data', 'cases.json');
const imagesDir = path.join(repoDir, 'data', 'images');
const outSeed = path.join(ROOT, 'backend', 'internal', 'seed', 'system_image_templates.json');
const outImages = path.join(ROOT, 'backend', 'data', 'cache', 'cases');

// 英文分类 -> 目标分类（近似名称合并到现有分类，其余新建）
const CATEGORY_MAP = {
    'Characters & People': 'portrait',          // 人像写真
    'Photography & Realism': 'portrait',        // 人像写真
    'Brand & Logos': 'brand',                   // 品牌商业
    'Products & E-commerce': 'brand',           // 品牌商业
    'Illustration & Art': 'illustration',       // 插画叙事
    'Scenes & Storytelling': 'illustration',    // 插画叙事
    'Posters & Typography': 'poster',           // 海报设计（新）
    'Charts & Infographics': 'infographic',     // 图表信息（新）
    'UI & Interfaces': 'ui',                    // 界面设计（新）
    'Architecture & Spaces': 'architecture',    // 建筑空间（新）
    'History & Classical Themes': 'history',    // 历史古典（新）
    'Documents & Publishing': 'documents',      // 文档出版（新）
    'Other Use Cases': 'other',                 // 其他创意（新）
};

// 每个目标分类的主题渐变（作为无图/加载失败时的兜底视觉）。
const ACCENT_MAP = {
    portrait: 'slate', brand: 'amber', illustration: 'red', poster: 'cyan',
    infographic: 'emerald', ui: 'indigo', architecture: 'slate', history: 'amber',
    documents: 'slate', other: 'violet',
};

// 将 {argument name="X" default="Y"} 占位符替换为默认值，使提示词可直接使用。
function cleanPrompt(text) {
    return String(text || '')
        .replace(/\{argument\s+name="([^"]*)"(?:\s+default="([^"]*)")?\s*\}/g, (m, name, def) => (def ?? name ?? '').trim())
        .replace(/\s+\n/g, '\n')
        .trim();
}

// 上游案例每条只提供一种原始语言的 prompt。保留其语言标识，供前端按系统语言优先选用；
// 不伪造机器翻译，缺少目标语言时由前端安全回退到原始提示词。
function detectPromptLanguage(prompt) {
    const chineseCount = (prompt.match(/[\u3400-\u9fff]/g) || []).length;
    const latinCount = (prompt.match(/[A-Za-z]/g) || []).length;
    if (chineseCount >= 8 && chineseCount >= latinCount * 0.08) return 'zh';
    if (latinCount >= 16 && chineseCount < 8) return 'en';
    return 'other';
}

const raw = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const cases = raw.cases || [];
fs.mkdirSync(outImages, { recursive: true });

let copied = 0;
const templates = [];
for (const item of cases) {
    const category = CATEGORY_MAP[item.category] || 'other';
    const imageBase = item.image ? path.basename(item.image) : '';
    let cover = '';
    if (imageBase) {
        const src = path.join(imagesDir, imageBase);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(outImages, imageBase));
            cover = `/file/cases/${imageBase}`;
            copied += 1;
        }
    }
    const styles = Array.isArray(item.styles) ? item.styles : [];
    const prompt = cleanPrompt(item.prompt);
    const promptLanguage = detectPromptLanguage(prompt);
    templates.push({
        source_key: `gpt2-case-${item.id}`,
        category,
        name: item.title || `案例 ${item.id}`,
        description: styles.slice(0, 3).join(' · ') || 'GPT 图像案例',
        accent: ACCENT_MAP[category] || ACCENT_MAP.other,
        // awesome-gpt-image-2 案例统一以 OG 的高质量图像模型执行。
        model_name: 'OG',
        model_version: 'image2_high',
        prompt,
        prompt_language: promptLanguage,
        ...(promptLanguage === 'zh' ? { prompt_zh: prompt } : {}),
        ...(promptLanguage === 'en' ? { prompt_en: prompt } : {}),
        cover_url: cover,
    });
}

const existingSeed = fs.existsSync(outSeed) ? JSON.parse(fs.readFileSync(outSeed, 'utf8')) : [];
const preservedTemplates = existingSeed.filter((item) => !String(item.source_key || '').startsWith('gpt2-case-'));
const normalizedCases = templates.map((item, index) => ({
    ...item,
    sort_order: preservedTemplates.length + index,
    enhance_prompt: 'Enabled',
    storage_mode: 'Temporary',
    ratio: '',
    resolution: '',
}));
fs.writeFileSync(outSeed, `${JSON.stringify([...preservedTemplates, ...normalizedCases], null, 2)}\n`, 'utf8');

console.log(`生成模版 ${templates.length} 条，拷贝图片 ${copied} 张`);
console.log(`数据库种子: ${path.relative(ROOT, outSeed)} (${(fs.statSync(outSeed).size / 1024).toFixed(0)}KB)`);
const byCat = {};
for (const t of templates) byCat[t.category] = (byCat[t.category] || 0) + 1;
console.log('分类分布:', JSON.stringify(byCat));
