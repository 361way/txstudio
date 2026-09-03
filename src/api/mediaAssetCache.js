import SparkMD5 from 'spark-md5';
import { apiGet, apiPost, apiPut } from './client';
import { invokeVod } from './vod';

const VERIFY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const EXPIRY_SAFETY_MS = 30 * 60 * 1000;
const TEMPORARY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const memoryCache = new Map();

async function hashBlobMd5(blob) {
    if (!blob || !blob.size) throw new Error('参考图内容为空');
    return SparkMD5.ArrayBuffer.hash(await blob.arrayBuffer());
}

function buildKey(subAppId, mediaType, md5) {
    return `${subAppId}:${mediaType || 'image'}:${md5}`;
}

function normalizeRecord(record) {
    if (!record?.md5) return null;
    return {
        id: record.id || record.ID || 0,
        sub_app_id: Number(record.sub_app_id ?? record.subAppId ?? 0),
        media_type: record.media_type || record.mediaType || 'image',
        md5: record.md5,
        file_id: record.file_id || record.fileId || '',
        media_url: record.media_url || record.mediaUrl || '',
        mime_type: record.mime_type || record.mimeType || '',
        file_size: Number(record.file_size || record.fileSize || 0),
        width: Number(record.width || 0),
        height: Number(record.height || 0),
        storage_mode: record.storage_mode || record.storageMode || 'Permanent',
        expires_at: record.expires_at || record.expiresAt || null,
        status: record.status || 'ready',
        verified_at: record.verified_at || record.verifiedAt || null,
        last_used_at: record.last_used_at || record.lastUsedAt || null,
    };
}

function setMemory(record) {
    const normalized = normalizeRecord(record);
    if (normalized) memoryCache.set(buildKey(normalized.sub_app_id, normalized.media_type, normalized.md5), normalized);
    return normalized;
}

function clearMemory(record) {
    if (record) memoryCache.delete(buildKey(record.sub_app_id, record.media_type, record.md5));
}

function getMemory(subAppId, mediaType, md5) {
    return memoryCache.get(buildKey(subAppId, mediaType, md5)) || null;
}

function isRecordFresh(record) {
    if (!record?.file_id || !record?.media_url) return false;
    if (record.status !== 'ready') return false;
    if (!/^https:\/\//i.test(record.media_url)) return false;
    const expiresAt = record.expires_at ? Date.parse(record.expires_at) : 0;
    if (record.storage_mode === 'Temporary' && expiresAt && expiresAt - Date.now() < EXPIRY_SAFETY_MS) return false;
    return true;
}

function needsVerify(record) {
    const verifiedAt = record.verified_at ? Date.parse(record.verified_at) : 0;
    return !verifiedAt || Date.now() - verifiedAt >= VERIFY_INTERVAL_MS;
}

async function lookupSqlite(ctx, md5, mediaType) {
    // sub_app_id 可为 0：后端会从服务端加密凭证解析真实子应用 ID。
    const subAppId = Number(ctx?.credentials?.subAppId || 0);
    try {
        const data = await apiGet(`/api/media-assets/lookup?sub_app_id=${subAppId}&md5=${encodeURIComponent(md5)}&media_type=${encodeURIComponent(mediaType)}`);
        return data ? setMemory(data) : null;
    } catch {
        return null;
    }
}

async function describeVodImage(record, ctx) {
    const response = await invokeVod({
        action: 'DescribeMediaInfos',
        payload: { SubAppId: ctx?.credentials?.subAppId, FileIds: [record.file_id] },
    });
    return response?.Response?.MediaInfoSet?.[0] || null;
}

function validateMediaInfo(mediaInfo) {
    const basic = mediaInfo?.BasicInfo || {};
    const meta = mediaInfo?.MetaData || {};
    if (String(basic.Status || '') !== 'Normal') return { ok: false };
    if (basic.Category !== 'Image') return { ok: false };
    const width = Number(meta.Width || 0);
    const height = Number(meta.Height || 0);
    if (!width || !height) return { ok: false };
    const mediaUrl = basic.MediaUrl || '';
    if (!/^https:\/\//i.test(mediaUrl)) return { ok: false };
    return { ok: true, width, height, mediaUrl };
}

async function markVerified(record) {
    const id = record.id;
    const verifiedAt = new Date().toISOString();
    if (id) {
        try { await apiPut(`/api/media-assets/${id}/verify`); } catch { }
    }
    return setMemory({ ...record, status: 'ready', verified_at: verifiedAt, last_used_at: verifiedAt });
}

async function markInvalid(record, ctx) {
    const id = record.id;
    if (id) {
        try { await apiPut(`/api/media-assets/${id}/invalidate`); } catch { }
    } else if (Number(record.sub_app_id || 0)) {
        try {
            await apiPut('/api/media-assets/invalidate', {
                sub_app_id: Number(record.sub_app_id),
                md5: record.md5,
                media_type: record.media_type,
            });
        } catch { }
    }
    clearMemory(record);
}

async function verifyCached(record, ctx) {
    if (!isRecordFresh(record)) {
        await markInvalid(record, ctx);
        return null;
    }
    if (!needsVerify(record)) return markVerified(record);
    let mediaInfo;
    try {
        mediaInfo = await describeVodImage(record, ctx);
    } catch {
        await markInvalid(record, ctx);
        return null;
    }
    const check = validateMediaInfo(mediaInfo);
    if (!check.ok) {
        await markInvalid(record, ctx);
        return null;
    }
    return markVerified({
        ...record,
        media_url: check.mediaUrl,
        width: check.width,
        height: check.height,
    });
}

async function upsertSqlite(record) {
    const subAppId = Number(record.sub_app_id || 0);
    const expiresAt = record.expires_at ? Date.parse(record.expires_at) : 0;
    const payload = {
        sub_app_id: subAppId,
        md5: record.md5,
        media_type: record.media_type,
        file_id: record.file_id,
        media_url: record.media_url,
        mime_type: record.mime_type,
        file_size: record.file_size,
        width: record.width,
        height: record.height,
        storage_mode: record.storage_mode,
        expires_at: expiresAt,
        status: 'ready',
        verified_at: Date.now(),
    };
    try {
        const saved = await apiPost('/api/media-assets', payload);
        return setMemory(saved || payload);
    } catch {
        // 后端不可用时降级为内存缓存，保证生成功能不受缓存层故障影响。
        return setMemory(payload);
    }
}

function toAsset(record, fromCache) {
    return {
        id: record.id || 0,
        fileId: record.file_id,
        mediaUrl: record.media_url,
        url: record.media_url,
        md5: record.md5,
        width: record.width,
        height: record.height,
        storageMode: record.storage_mode,
        expiresAt: record.expires_at ? Date.parse(record.expires_at) : 0,
        fromCache,
    };
}

/**
 * 选择参考图时立即完成 MD5 去重、云端有效性验证与上传。
 * SQLite media_assets 是唯一权威缓存；内存 Map 仅用于当前页面提速。
 * 云端被删除或状态异常时自动标记失效并重新上传。
 */
export async function prepareReferenceImage(file, ctx, options = {}) {
    if (!(file instanceof Blob)) throw new Error('参考图内容无效');
    const mediaType = options.mediaType || 'image';
    const subAppId = Number(ctx?.credentials?.subAppId || 0);
    const md5 = await hashBlobMd5(file);

    let cached = getMemory(subAppId, mediaType, md5);
    if (!cached) cached = await lookupSqlite(ctx, md5, mediaType);
    if (cached) {
        const verified = await verifyCached(cached, ctx).catch(() => null);
        if (verified) return toAsset(verified, true);
    }

    const uploaded = await options.upload(file);
    const mediaUrl = uploaded?.mediaUrl || uploaded?.url || '';
    if (!uploaded?.fileId || !/^https:\/\//i.test(mediaUrl)) {
        throw new Error('云端参考图上传完成但未取得可访问地址');
    }
    const storageMode = options.storageMode || 'Permanent';
    const record = await upsertSqlite({
        sub_app_id: subAppId,
        media_type: mediaType,
        md5,
        file_id: uploaded.fileId,
        media_url: mediaUrl,
        mime_type: file.type || '',
        file_size: file.size,
        width: Number(uploaded.width || 0),
        height: Number(uploaded.height || 0),
        storage_mode: storageMode,
        expires_at: storageMode === 'Temporary' ? new Date(Date.now() + TEMPORARY_TTL_MS).toISOString() : null,
    });
    return toAsset(record, false);
}

export function getReferenceAssetUrl(asset) {
    return asset?.mediaUrl || asset?.url || '';
}

export function getReferenceAssetFileId(asset) {
    return asset?.fileId || '';
}
