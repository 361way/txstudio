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
    console.log('单二进制冒烟测试通过：无配置启动、内嵌前端、数据库、密钥和日志均正常。');
} finally {
    if (child.exitCode === null) {
        child.kill();
        await new Promise((resolve) => child.once('exit', resolve));
    }
    await rm(testRoot, { recursive: true, force: true });
}
