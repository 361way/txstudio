/**
 * 强制登出事件总线
 * client.js 在 401 刷新失败或 needLogin 时触发；AuthGate 订阅后切回登录页。
 * 解耦 api 层与 UI 层：api 不直接操作路由/状态，仅发事件。
 */

const listeners = new Set();

/** 触发强制登出（token 失效、刷新失败等） */
export function emitForceLogout() {
    listeners.forEach((cb) => {
        try { cb(); } catch (e) { /* 单个监听器异常不影响其他 */ }
    });
}

/** 订阅强制登出事件，返回取消订阅函数 */
export function onForceLogout(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}
