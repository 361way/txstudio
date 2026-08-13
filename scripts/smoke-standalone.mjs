import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'release', process.platform === 'win32' ? 'txstudio.exe' : 'txstudio');
if (!existsSync(binary)) throw new Error(`未找到 ${binary}，请先运行 npm run build:binary`);

const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        server.close(() => resolve(address.port));
    });
});
const testRoot = await mkdtemp(path.join(os.tmpdir(), 'txstudio-standalone-'));
const profileRoot = path.join(testRoot, 'profile');
const dataDir = process.platform === 'darwin'
    ? path.join(profileRoot, 'Library', 'Application Support', 'TxStudio')
    : process.platform === 'win32'
        ? path.join(profileRoot, 'TxStudio')
        : path.join(profileRoot, 'TxStudio');
const standaloneEnv = process.platform === 'win32'
    ? { APPDATA: profileRoot, LOCALAPPDATA: profileRoot, USERPROFILE: profileRoot }
    : process.platform === 'darwin'
        ? { HOME: profileRoot }
        : { HOME: profileRoot, XDG_CONFIG_HOME: profileRoot };
const child = spawn(binary, ['-port', String(port), '-open=false'], {
    cwd: testRoot,
    env: standaloneEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });

try {
    const deadline = Date.now() + 20_000;
    let response;
    while (Date.now() < deadline) {
        try {
            response = await fetch(`http://127.0.0.1:${port}/health`);
            if (response.ok) break;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }
    if (!response?.ok) throw new Error(`服务未就绪：\n${output}`);
    const html = await fetch(`http://127.0.0.1:${port}/`).then((item) => item.text());
    if (!html.includes('<title>TxStudio</title>') || !html.includes('id="root"')) {
        throw new Error('内嵌前端未正确返回');
    }
    for (const relativePath of ['txstudio.db', 'secret.key', path.join('logs', 'txstudio.log')]) {
        if (!existsSync(path.join(dataDir, relativePath))) {
            throw new Error(`首次运行未创建 ${relativePath}`);
        }
    }
    const templatePayload = await fetch(`http://127.0.0.1:${port}/api/image-templates`).then((item) => item.json());
    const systemTemplates = Array.isArray(templatePayload?.data)
        ? templatePayload.data.filter((item) => item?.source === 'system')
        : [];
    if (systemTemplates.length !== 537) {
        throw new Error(`首次运行未导入完整系统模板：${systemTemplates.length}`);
    }
    if (systemTemplates.some((item) => 'source_name' in item || 'source_url' in item)) {
        throw new Error('系统模板 API 仍返回已移除的来源字段');
    }
    if (systemTemplates.some((item) => item.storage_mode !== 'Permanent')) {
        throw new Error('系统模板未使用永久存储默认值');
    }
    const templateWithCover = systemTemplates.find((item) => typeof item?.cover_url === 'string' && item.cover_url.startsWith('/file/cases/'));
    if (!templateWithCover) throw new Error('未找到系统模板封面');
    const coverResponse = await fetch(`http://127.0.0.1:${port}${templateWithCover.cover_url}`);
    if (!coverResponse.ok || (await coverResponse.arrayBuffer()).byteLength === 0) {
        throw new Error(`内嵌模板封面不可用：${templateWithCover.cover_url}`);
    }
    console.log('单二进制冒烟测试通过：内嵌前端、数据库、密钥、系统模板及模板封面均正常。');
} finally {
    if (child.exitCode === null) {
        child.kill();
        await new Promise((resolve) => child.once('exit', resolve));
    }
    await rm(testRoot, { recursive: true, force: true });
}
