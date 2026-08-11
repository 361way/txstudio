import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'dist', 'index.html');
const targetDirectory = path.join(root, 'backend', 'frontend', 'dist');
const target = path.join(targetDirectory, 'index.html');

await stat(source).catch(() => {
    throw new Error(`前端产物不存在：${source}，请先运行 npm run build:web`);
});
await mkdir(targetDirectory, { recursive: true });
await copyFile(source, target);
console.log(`已同步内嵌前端：${target}`);
