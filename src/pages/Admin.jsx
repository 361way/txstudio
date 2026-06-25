/**
 * 管理员后台 — 用户管理 + 模板管理
 * 仅超级管理员可见
 */
import React, { useState, useEffect, useCallback } from 'react';
import { listUsers, setUserQuota, setUserStatus } from '../api/admin';
import { listTemplates, createTemplate, deleteTemplate } from '../api/template';
import { listCredentials, saveCredential } from '../api/asset';
import { logout } from '../api/auth';
import i18n from '../i18n';

const t = (s) => i18n.t ? i18n.t(s) : s;

export default function Admin({ onForcedLogout, theme, onBack }) {
    const [tab, setTab] = useState('users');
    const [users, setUsers] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [editing, setEditing] = useState(null); // 编辑配额的用户
    const [newTpl, setNewTpl] = useState({ name: '', category: '电商', type: 'image', prompt: '', model_name: 'Kling', model_version: '3.0', ratio: '1:1', ref_image_count: 1, description: '' });
    // VOD 凭证表单
    const [cred, setCred] = useState({ secret_id: '', secret_key: '', sub_app_id: '', region: 'ap-guangzhou' });
    const [credHas, setCredHas] = useState(false);
    const [credMsg, setCredMsg] = useState('');
    const [credSaving, setCredSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true); setError('');
        try {
            if (tab === 'users') {
                const data = await listUsers();
                setUsers(Array.isArray(data) ? data : []);
            } else if (tab === 'templates') {
                const data = await listTemplates();
                setTemplates(Array.isArray(data) ? data : []);
            } else if (tab === 'credentials') {
                const data = await listCredentials();
                const vod = (Array.isArray(data) ? data : []).find((c) => c.provider === 'vod');
                setCredHas(!!vod?.has_data);
            }
        } catch (e) {
            if (e?.needLogin) { onForcedLogout?.(); return; }
            setError(e.message || '加载失败');
        } finally { setLoading(false); }
    }, [tab, onForcedLogout]);

    useEffect(() => { load(); }, [load]);

    const handleLogout = () => { logout(); onForcedLogout?.(); };
    const isDark = theme !== 'light' && theme !== 'solarized';
    const inputCls = isDark ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-white border-zinc-300 text-zinc-800';

    const saveQuota = async (userId, quotas) => {
        try {
            await setUserQuota(userId, quotas);
            setEditing(null);
            load();
        } catch (e) { setError(e.message || '保存失败'); }
    };

    const toggleStatus = async (u) => {
        const next = u.status === 'active' ? 'suspended' : 'active';
        try { await setUserStatus(u.id, next); load(); }
        catch (e) { setError(e.message || '操作失败'); }
    };

    const addTemplate = async () => {
        try { await createTemplate(newTpl); setNewTpl({ ...newTpl, name: '', prompt: '' }); load(); }
        catch (e) { setError(e.message || '创建失败'); }
    };

    const saveCred = async () => {
        if (!cred.secret_id.trim() || !cred.secret_key.trim() || !String(cred.sub_app_id).trim()) {
            setCredMsg('请填写 SecretId、SecretKey、SubAppId'); return;
        }
        setCredSaving(true); setCredMsg('');
        try {
            await saveCredential('vod', {
                secret_id: cred.secret_id.trim(),
                secret_key: cred.secret_key.trim(),
                sub_app_id: String(cred.sub_app_id).trim(),
                region: cred.region.trim() || 'ap-guangzhou',
            });
            setCredMsg('已保存');
            setCred({ secret_id: '', secret_key: '', sub_app_id: '', region: cred.region });
            setCredHas(true);
        } catch (e) {
            setCredMsg(e.message || '保存失败');
        } finally { setCredSaving(false); }
    };

    const removeTemplate = async (id) => {
        if (!confirm(t('确认删除该模板？'))) return;
        try { await deleteTemplate(id); load(); } catch (e) { setError(e.message || '删除失败'); }
    };

    return (
        <div className={`min-h-screen ${isDark ? 'bg-zinc-950' : 'bg-zinc-100'}`}>
            <div className="max-w-6xl mx-auto px-6 py-8">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        {onBack && (
                            <button onClick={onBack} className={`px-3 py-2 rounded-lg text-sm border ${isDark ? 'bg-zinc-900 border-zinc-700 text-zinc-300' : 'bg-white border-zinc-300 text-zinc-600'}`}>{t('← 返回')}</button>
                        )}
                        <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-zinc-800'}`}>{t('管理后台')}</h1>
                    </div>
                    <button onClick={handleLogout} className={`px-4 py-2 rounded-lg text-sm border ${isDark ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-white border-zinc-300 text-zinc-700'}`}>{t('退出登录')}</button>
                </div>

                <div className="flex gap-2 mb-6">
                    <button onClick={() => setTab('users')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'users' ? 'bg-blue-600 text-white' : (isDark ? 'bg-zinc-900 text-zinc-300' : 'bg-white text-zinc-600')}`}>{t('用户管理')}</button>
                    <button onClick={() => setTab('templates')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'templates' ? 'bg-blue-600 text-white' : (isDark ? 'bg-zinc-900 text-zinc-300' : 'bg-white text-zinc-600')}`}>{t('模板管理')}</button>
                    <button onClick={() => setTab('credentials')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'credentials' ? 'bg-blue-600 text-white' : (isDark ? 'bg-zinc-900 text-zinc-300' : 'bg-white text-zinc-600')}`}>{t('凭证配置')}</button>
                </div>

                {error && <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-800 text-red-300 text-sm">{error}</div>}

                {tab === 'users' ? (
                    loading ? <div className="text-center py-10 text-zinc-500">{t('加载中...')}</div> : (
                        <div className={`rounded-xl border overflow-hidden ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
                            <table className="w-full text-sm">
                                <thead className={isDark ? 'bg-zinc-800/50 text-zinc-400' : 'bg-zinc-50 text-zinc-500'}>
                                    <tr>
                                        <th className="text-left px-4 py-3">ID</th>
                                        <th className="text-left px-4 py-3">{t('邮箱')}</th>
                                        <th className="text-left px-4 py-3">{t('显示名')}</th>
                                        <th className="text-left px-4 py-3">{t('租户')}</th>
                                        <th className="text-left px-4 py-3">{t('状态')}</th>
                                        <th className="text-left px-4 py-3">{t('超管')}</th>
                                        <th className="text-left px-4 py-3">{t('操作')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map((u) => (
                                        <tr key={u.id} className={`border-t ${isDark ? 'border-zinc-800' : 'border-zinc-100'}`}>
                                            <td className="px-4 py-3 text-zinc-500">{u.id}</td>
                                            <td className={`px-4 py-3 ${isDark ? 'text-white' : 'text-zinc-800'}`}>{u.email}</td>
                                            <td className="px-4 py-3 text-zinc-400">{u.display_name}</td>
                                            <td className="px-4 py-3 text-zinc-400">{u.tenant_name}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded text-xs ${u.status === 'active' ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>{u.status}</span>
                                            </td>
                                            <td className="px-4 py-3 text-center">{u.is_super_admin ? '✓' : ''}</td>
                                            <td className="px-4 py-3 flex gap-1">
                                                <button onClick={() => setEditing(u)} className="px-2 py-1 text-xs bg-blue-600 text-white rounded">{t('配额')}</button>
                                                <button onClick={() => toggleStatus(u)} className="px-2 py-1 text-xs bg-zinc-700 text-white rounded">{u.status === 'active' ? t('禁用') : t('启用')}</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )
                ) : tab === 'templates' ? (
                    <div>
                        <div className={`rounded-xl border p-4 mb-4 ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
                            <h3 className={`text-sm font-medium mb-3 ${isDark ? 'text-zinc-300' : 'text-zinc-600'}`}>{t('新建模板')}</h3>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                                <input placeholder={t('名称')} value={newTpl.name} onChange={(e) => setNewTpl({ ...newTpl, name: e.target.value })} className={`px-3 py-2 border rounded text-sm ${inputCls}`} />
                                <input placeholder={t('分类')} value={newTpl.category} onChange={(e) => setNewTpl({ ...newTpl, category: e.target.value })} className={`px-3 py-2 border rounded text-sm ${inputCls}`} />
                                <select value={newTpl.type} onChange={(e) => setNewTpl({ ...newTpl, type: e.target.value })} className={`px-3 py-2 border rounded text-sm ${inputCls}`}>
                                    <option value="image">image</option>
                                    <option value="video">video</option>
                                </select>
                                <input placeholder={t('模型')} value={newTpl.model_name} onChange={(e) => setNewTpl({ ...newTpl, model_name: e.target.value })} className={`px-3 py-2 border rounded text-sm ${inputCls}`} />
                                <input placeholder={t('版本')} value={newTpl.model_version} onChange={(e) => setNewTpl({ ...newTpl, model_version: e.target.value })} className={`px-3 py-2 border rounded text-sm ${inputCls}`} />
                                <input placeholder={t('比例')} value={newTpl.ratio} onChange={(e) => setNewTpl({ ...newTpl, ratio: e.target.value })} className={`px-3 py-2 border rounded text-sm ${inputCls}`} />
                                <input type="number" placeholder={t('参考图数')} value={newTpl.ref_image_count} onChange={(e) => setNewTpl({ ...newTpl, ref_image_count: +e.target.value })} className={`px-3 py-2 border rounded text-sm ${inputCls}`} />
                                <button onClick={addTemplate} className="px-3 py-2 bg-blue-600 text-white rounded text-sm">{t('添加')}</button>
                            </div>
                            <textarea placeholder={t('提示词')} value={newTpl.prompt} onChange={(e) => setNewTpl({ ...newTpl, prompt: e.target.value })} rows={2} className={`w-full px-3 py-2 border rounded text-sm ${inputCls}`} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {templates.map((tpl) => (
                                <div key={tpl.id} className={`rounded-lg border p-3 flex justify-between items-center ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
                                    <div>
                                        <div className={`font-medium text-sm ${isDark ? 'text-white' : 'text-zinc-800'}`}>{tpl.name}</div>
                                        <div className="text-xs text-zinc-500">{tpl.category} · {tpl.type} · {tpl.model_name}</div>
                                    </div>
                                    <button onClick={() => removeTemplate(tpl.id)} className="px-2 py-1 text-xs bg-red-600 text-white rounded">{t('删除')}</button>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className={`rounded-xl border p-6 max-w-2xl ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
                        <h3 className={`text-base font-semibold mb-1 ${isDark ? 'text-white' : 'text-zinc-800'}`}>{t('腾讯云 VOD 凭证')}</h3>
                        <p className="text-xs text-zinc-500 mb-4">
                            {t('用于图片/视频生成与上传。保存到当前租户，加密存储。')}
                            {credHas && <span className="ml-2 text-green-400">{t('（已配置，重新填写将覆盖）')}</span>}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">SecretId</label>
                                <input value={cred.secret_id} onChange={(e) => setCred({ ...cred, secret_id: e.target.value })} placeholder="AKID..." className={`w-full px-3 py-2 border rounded-lg text-sm ${inputCls}`} />
                            </div>
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">SecretKey</label>
                                <input type="password" value={cred.secret_key} onChange={(e) => setCred({ ...cred, secret_key: e.target.value })} placeholder="••••••••" className={`w-full px-3 py-2 border rounded-lg text-sm ${inputCls}`} />
                            </div>
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">SubAppId {t('（子应用 ID，正整数）')}</label>
                                <input value={cred.sub_app_id} onChange={(e) => setCred({ ...cred, sub_app_id: e.target.value })} placeholder="1500000000" className={`w-full px-3 py-2 border rounded-lg text-sm ${inputCls}`} />
                            </div>
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">Region</label>
                                <input value={cred.region} onChange={(e) => setCred({ ...cred, region: e.target.value })} placeholder="ap-guangzhou" className={`w-full px-3 py-2 border rounded-lg text-sm ${inputCls}`} />
                            </div>
                        </div>
                        {credMsg && <div className={`mb-3 text-sm ${credMsg === '已保存' ? 'text-green-400' : 'text-red-400'}`}>{credMsg}</div>}
                        <button onClick={saveCred} disabled={credSaving} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                            {credSaving ? t('保存中...') : t('保存凭证')}
                        </button>
                    </div>
                )}

                {editing && (
                    <QuotaModal user={editing} onSave={saveQuota} onClose={() => setEditing(null)} isDark={isDark} inputCls={inputCls} />
                )}
            </div>
        </div>
    );
}

function QuotaModal({ user, onSave, onClose, isDark, inputCls }) {
    const [img, setImg] = useState(20);
    const [vid, setVid] = useState(5);
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className={`rounded-xl border p-6 w-96 ${isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-300'}`} onClick={(e) => e.stopPropagation()}>
                <h3 className={`font-medium mb-4 ${isDark ? 'text-white' : 'text-zinc-800'}`}>{t('设置配额')} - {user.email}</h3>
                <label className="block text-sm mb-1 text-zinc-400">{t('每日图片生成数')}</label>
                <input type="number" value={img} onChange={(e) => setImg(+e.target.value)} className={`w-full px-3 py-2 border rounded mb-3 ${inputCls}`} />
                <label className="block text-sm mb-1 text-zinc-400">{t('每日视频生成数')}</label>
                <input type="number" value={vid} onChange={(e) => setVid(+e.target.value)} className={`w-full px-3 py-2 border rounded mb-4 ${inputCls}`} />
                <div className="flex gap-2">
                    <button onClick={() => onSave(user.id, { daily_image_gen: img, daily_video_gen: vid })} className="flex-1 py-2 bg-blue-600 text-white rounded text-sm">{t('保存')}</button>
                    <button onClick={onClose} className="flex-1 py-2 bg-zinc-700 text-white rounded text-sm">{t('取消')}</button>
                </div>
            </div>
        </div>
    );
}
