const DB_NAME = 'txstudio-canvas-save-journal';
const DB_VERSION = 1;
const STORE_NAME = 'pending-snapshots';
const DELETION_KEY_PREFIX = 'txstudio_canvas_deleted_nodes_';

export function getCanvasDeletionTombstones(projectId) {
    if (projectId == null || typeof localStorage === 'undefined') return null;
    try {
        const value = JSON.parse(localStorage.getItem(`${DELETION_KEY_PREFIX}${projectId}`) || 'null');
        return value && Array.isArray(value.nodeIds) ? value : null;
    } catch {
        return null;
    }
}

export function putCanvasDeletionTombstones(projectId, revision, nodeIds) {
    if (projectId == null || typeof localStorage === 'undefined' || !Array.isArray(nodeIds) || nodeIds.length === 0) return;
    try {
        const key = `${DELETION_KEY_PREFIX}${projectId}`;
        const current = getCanvasDeletionTombstones(projectId);
        const merged = new Set([...(current?.nodeIds || []), ...nodeIds]);
        localStorage.setItem(key, JSON.stringify({ revision, nodeIds: Array.from(merged), updatedAt: Date.now() }));
    } catch { }
}

export function reconcileCanvasDeletionTombstones(projectId, presentNodeIds) {
    if (projectId == null || typeof localStorage === 'undefined') return;
    try {
        const current = getCanvasDeletionTombstones(projectId);
        if (!current) return;
        const present = new Set(Array.isArray(presentNodeIds) ? presentNodeIds : []);
        const remaining = current.nodeIds.filter((id) => !present.has(id));
        const key = `${DELETION_KEY_PREFIX}${projectId}`;
        if (remaining.length === 0) localStorage.removeItem(key);
        else if (remaining.length !== current.nodeIds.length) localStorage.setItem(key, JSON.stringify({ ...current, nodeIds: remaining }));
    } catch { }
}

export function clearCanvasDeletionTombstones(projectId, savedRevision) {
    if (projectId == null || typeof localStorage === 'undefined') return;
    try {
        const current = getCanvasDeletionTombstones(projectId);
        if (current && Number(current.revision || 0) <= Number(savedRevision || 0)) {
            localStorage.removeItem(`${DELETION_KEY_PREFIX}${projectId}`);
        }
    } catch { }
}

const openJournalDB = () => new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'projectId' });
        }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开画布保存日志'));
});

const runTransaction = async (mode, operation) => {
    const db = await openJournalDB();
    if (!db) return null;
    try {
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, mode);
            const store = transaction.objectStore(STORE_NAME);
            let result;
            try {
                result = operation(store);
            } catch (error) {
                reject(error);
                return;
            }
            transaction.oncomplete = () => resolve(result?.result ?? null);
            transaction.onerror = () => reject(transaction.error || new Error('画布保存日志事务失败'));
            transaction.onabort = () => reject(transaction.error || new Error('画布保存日志事务已取消'));
        });
    } finally {
        db.close();
    }
};

export async function getPendingCanvasSnapshot(projectId) {
    if (projectId == null) return null;
    return runTransaction('readonly', (store) => store.get(String(projectId)));
}

export async function putPendingCanvasSnapshot(projectId, revision, snapshot) {
    if (projectId == null || !revision || !snapshot) return false;
    const id = String(projectId);
    const db = await openJournalDB();
    if (!db) return false;
    try {
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const current = getRequest.result;
                if (!current || Number(current.revision || 0) <= Number(revision)) {
                    store.put({ projectId: id, revision, snapshot, updatedAt: Date.now() });
                }
            };
            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(transaction.error || new Error('无法记录待保存画布'));
            transaction.onabort = () => reject(transaction.error || new Error('待保存画布事务已取消'));
        });
    } finally {
        db.close();
    }
}

export async function clearPendingCanvasSnapshot(projectId, savedRevision) {
    if (projectId == null) return false;
    const id = String(projectId);
    const db = await openJournalDB();
    if (!db) return false;
    try {
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const current = getRequest.result;
                if (current && Number(current.revision || 0) <= Number(savedRevision || 0)) {
                    store.delete(id);
                }
            };
            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(transaction.error || new Error('无法清理画布保存日志'));
            transaction.onabort = () => reject(transaction.error || new Error('清理画布保存日志事务已取消'));
        });
    } finally {
        db.close();
    }
}
