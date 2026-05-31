import i18n from './i18n';

/**
 * VodStudio V3.5.20-1 Performance Benchmark Test
 * 
 * 测试说明：
 * 1. 在浏览器 DevTools Console 中运行此脚本
 * 2. 或者在项目中 import 后调用 runBenchmark()
 * 
 * 测试项：
 * - Icon 渲染性能
 * - 事件处理性能
 * - 内存使用
 */

const t = i18n.t.bind(i18n);

const PerformanceBenchmark = {
    results: {},

    // 测试1: 测量 React 渲染性能 (需要 React DevTools)
    async measureRenderTime(componentName, iterations = 100) {
        const times = [];

        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            // 触发一次小更新
            window.dispatchEvent(new Event('resize'));
            await new Promise(r => requestAnimationFrame(r));
            times.push(performance.now() - start);
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const min = Math.min(...times);
        const max = Math.max(...times);

        return { avg: avg.toFixed(2), min: min.toFixed(2), max: max.toFixed(2) };
    },

    // 测试2: 事件处理性能
    measureEventPerformance(iterations = 1000) {
        const canvas = document.querySelector('#canvas-bg');
        if (!canvas) {
            return { error: 'Canvas not found' };
        }

        const times = [];
        const rect = canvas.getBoundingClientRect();

        for (let i = 0; i < iterations; i++) {
            const start = performance.now();

            // 模拟 pointermove 事件
            const event = new PointerEvent('pointermove', {
                clientX: rect.left + Math.random() * rect.width,
                clientY: rect.top + Math.random() * rect.height,
                bubbles: true
            });
            canvas.dispatchEvent(event);

            times.push(performance.now() - start);
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        return {
            avg: avg.toFixed(4) + 'ms',
            total: times.reduce((a, b) => a + b, 0).toFixed(2) + 'ms',
            iterations
        };
    },

    // 测试3: 内存快照
    measureMemory() {
        if (performance.memory) {
            return {
                usedJSHeapSize: (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
                totalJSHeapSize: (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
                jsHeapSizeLimit: (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB'
            };
        }
        return { note: t('performance.memory not available (requires Chrome with --enable-precise-memory-info)') };
    },

    // 测试4: 定时器密度测试
    async measureTimerDensity(durationMs = 2000) {
        let timerCount = 0;
        const intervalId = setInterval(() => timerCount++, 1);

        await new Promise(r => setTimeout(r, durationMs));
        clearInterval(intervalId);

        // 检查 setNodeTimers 的调用频率 (应该是 500ms 一次)
        const expectedNodeTimerCalls = durationMs / 500;

        return {
            systemTimersPerSecond: (timerCount / (durationMs / 1000)).toFixed(0),
            expectedNodeTimerCalls: expectedNodeTimerCalls.toFixed(0),
            note: t('V3.5.20-1 应为 500ms 间隔 (原 100ms)')
        };
    },

    // 测试5: 检查优化是否应用
    checkOptimizations() {
        const checks = {
            directIconImports: false,
            timer500ms: false,
            noMouseListeners: false,
            useMemoFixed: false
        };

        // 检查 Icon 导入 (查看源码注释)
        // 这需要在 console 中手动验证
        checks.directIconImports = t('需手动验证: 查看源码 Line 51-60');

        // 检查定时器设置 (通过观察更新频率)
        checks.timer500ms = t('需手动验证: 查看源码 Line 2511');

        // 检查事件监听器
        const listenerTypes = getEventListeners ?
            Object.keys(getEventListeners(window)) :
            t('无法获取 (需 Chrome DevTools Protocol)');
        checks.noMouseListeners = listenerTypes;

        // useMemo 需要查看源码
        checks.useMemoFixed = t('需手动验证: 查看源码 Line 3569-3570');

        return checks;
    },

    // 运行所有测试
    async runAll() {
        console.log('🚀 VodStudio V3.5.20-1 Performance Benchmark');
        console.log('=========================================\n');

        console.log(`1️⃣ ${t('内存使用')}:`);
        console.table(this.measureMemory());

        console.log(`\n2️⃣ ${t('事件处理性能')} (1000次 pointermove):`);
        console.table(this.measureEventPerformance(1000));

        console.log(`\n3️⃣ ${t('定时器密度测试')} (2秒):`);
        console.table(await this.measureTimerDensity(2000));

        console.log(`\n4️⃣ ${t('优化检查清单')}:`);
        console.table(this.checkOptimizations());

        console.log(`\n✅ ${t('测试完成')}`);
        return this.results;
    }
};

// 自动运行测试
console.log('Performance Benchmark Script Loaded');
console.log('Run: PerformanceBenchmark.runAll()');

// 导出供使用
if (typeof window !== 'undefined') {
    window.PerformanceBenchmark = PerformanceBenchmark;
}

export default PerformanceBenchmark;
