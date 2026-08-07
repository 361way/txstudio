// 将 awesome-gpt-image-2 仓库的案例（提示词 + 图片 + 分类）导入为图像模版。
// 用法：node scripts/import-gpt-image2.mjs <repoDir>
//  - 生成 src/data/gptImage2Cases.js（模版数据）
//  - 拷贝案例图片到 backend/data/cache/cases/（经 /file/cases/... 访问）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const repoDir = process.argv[2] || '/tmp/gptimg2';
const casesFile = path.join(repoDir, 'data', 'cases.json');
const imagesDir = path.join(repoDir, 'data', 'images');
const outModule = path.join(ROOT, 'src', 'data', 'gptImage2Cases.js');
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
    portrait: 'from-slate-800 via-slate-600 to-amber-300',
    brand: 'from-zinc-950 via-zinc-700 to-amber-400',
    illustration: 'from-red-500 via-orange-400 to-yellow-200',
    poster: 'from-cyan-400 via-blue-500 to-violet-600',
    infographic: 'from-emerald-700 via-teal-400 to-cyan-200',
    ui: 'from-indigo-700 via-violet-500 to-sky-300',
    architecture: 'from-stone-700 via-stone-400 to-amber-200',
    history: 'from-amber-800 via-yellow-600 to-orange-300',
    documents: 'from-slate-600 via-slate-400 to-stone-200',
    other: 'from-fuchsia-600 via-pink-400 to-rose-200',
};

// 将 {argument name="X" default="Y"} 占位符替换为默认值，使提示词可直接使用。
function cleanPrompt(text) {
    return String(text || '')
        .replace(/\{argument\s+name="([^"]*)"(?:\s+default="([^"]*)")?\s*\}/g, (m, name, def) => (def ?? name ?? '').trim())
        .replace(/\s+\n/g, '\n')
        .trim();
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
    templates.push({
        id: `gpt2-case-${item.id}`,
        category,
        name: item.title || `案例 ${item.id}`,
        description: styles.slice(0, 3).join(' · ') || 'GPT 图像案例',
        accent: ACCENT_MAP[category] || ACCENT_MAP.other,
        prompt: cleanPrompt(item.prompt),
        cover_url: cover,
    });
}

const banner = '// 由 scripts/import-gpt-image2.mjs 从 awesome-gpt-image-2 自动生成，请勿手改。\n'
    + '// 案例图片经本地 /file/cases/ 访问；prompt 已清理 {argument} 占位符。\n';
const body = `${banner}export const GPT_IMAGE2_CASES = ${JSON.stringify(templates, null, 2)};\n`;
fs.writeFileSync(outModule, body, 'utf8');

console.log(`生成模版 ${templates.length} 条，拷贝图片 ${copied} 张`);
console.log(`数据模块: ${path.relative(ROOT, outModule)} (${(fs.statSync(outModule).size / 1024).toFixed(0)}KB)`);
const byCat = {};
for (const t of templates) byCat[t.category] = (byCat[t.category] || 0) + 1;
console.log('分类分布:', JSON.stringify(byCat));
