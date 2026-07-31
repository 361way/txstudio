import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const releaseDirectory = path.join(root, 'release');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd || root,
        env: options.env || process.env,
        encoding: 'utf8',
        stdio: options.capture ? 'pipe' : 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} 执行失败${result.stderr ? `：${result.stderr.trim()}` : ''}`);
    }
    return (result.stdout || '').trim();
}

const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = String(packageInfo.version || 'dev');
const commit = (() => {
    try { return run('git', ['rev-parse', '--short=12', 'HEAD'], { capture: true }); }
    catch { return 'unknown'; }
})();
const buildTime = new Date().toISOString();

console.log('1/3 构建单文件前端…');
run(npmCommand, ['run', 'build:web']);
run('node', [path.join(root, 'scripts', 'sync-frontend.mjs')]);

const goos = process.env.GOOS || run('go', ['env', 'GOOS'], { cwd: backend, capture: true });
const goarch = process.env.GOARCH || run('go', ['env', 'GOARCH'], { cwd: backend, capture: true });
const binaryName = goos === 'windows' ? 'txstudio.exe' : 'txstudio';
const output = path.join(releaseDirectory, binaryName);
await mkdir(releaseDirectory, { recursive: true });
await rm(output, { force: true });

console.log(`2/3 构建 ${goos}/${goarch} 无 CGO 单二进制…`);
const ldflags = [
    '-s', '-w',
    `-X main.version=${version}`,
    `-X main.commit=${commit}`,
    `-X main.buildTime=${buildTime}`,
].join(' ');
run('go', [
    'build', '-trimpath', '-buildvcs=false', '-tags', 'netgo,osusergo',
    '-ldflags', ldflags, '-o', output, './cmd/server',
], {
    cwd: backend,
    env: { ...process.env, CGO_ENABLED: '0', GOOS: goos, GOARCH: goarch },
});

console.log('3/3 验证二进制版本…');
const hostGOOS = process.platform === 'win32' ? 'windows' : process.platform;
if (goos === hostGOOS) {
    run(output, ['-version']);
} else {
    console.log('交叉编译目标无法在当前系统直接执行，已跳过运行验证。');
}
console.log(`完成：${output}`);
console.log('运行时无需 Node、Go、YAML 或系统 SQLite。');
