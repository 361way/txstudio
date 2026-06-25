/**
 * 项目列表页
 * 登录后展示，支持创建/打开/删除项目。打开项目进入画布编辑器。
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, FolderOpen, LogOut, Layout, Sparkles, AlertCircle, Loader2, RotateCw, ArrowLeft } from 'lucide-react';
import { listProjects, createProject, deleteProject } from '../api/project';
import { logout } from '../api/auth';
import i18n from '../i18n';

const t = (s) => i18n.t ? i18n.t(s) : s;

const formatDate = (iso) => {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return d.toLocaleString();
    } catch { return iso; }
};

export default function ProjectList({ onOpenProject, onForcedLogout, theme, onBack, embedded = false }) {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [deletingId, setDeletingId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await listProjects();
            setProjects(Array.isArray(data) ? data : []);
        } catch (err) {
            if (err?.needLogin) { onForcedLogout?.(); return; }
            setError(err.message || '加载项目列表失败');
        } finally {
            setLoading(false);
        }
    }, [onForcedLogout]);

    useEffect(() => { load(); }, [load]);

    const handleCreate = async (e) => {
        e.preventDefault();
        const name = newName.trim();
        if (!name || creating) return;
        setCreating(true);
        setError('');
        try {
            const p = await createProject(name);
            setProjects((prev) => [p, ...prev]);
            setNewName('');
        } catch (err) {
            if (err?.needLogin) { onForcedLogout?.(); return; }
            setError(err.message || '创建项目失败');
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm(t('确认删除该项目？删除后不可恢复。'))) return;
        setDeletingId(id);
        setError('');
        try {
            await deleteProject(id);
            setProjects((prev) => prev.filter((p) => p.id !== id));
        } catch (err) {
            if (err?.needLogin) { onForcedLogout?.(); return; }
            setError(err.message || '删除项目失败');
        } finally {
            setDeletingId(null);
        }
    };

    const handleLogout = () => {
        logout();
        onForcedLogout?.();
    };

    return (
        <div className={embedded ? '' : 'app-surface min-h-screen'}>
            <div className="max-w-5xl mx-auto px-6 py-8">
                {/* 顶部栏（非内嵌时显示；内嵌时由 AppShell 顶栏统一承载标题/配额） */}
                {!embedded && (
                    <div className="flex items-center justify-between mb-8 animate-fade-in">
                        <div className="flex items-center gap-3">
                            {onBack && (
                                <button onClick={onBack} className="btn-ghost px-3 py-2 inline-flex items-center gap-1.5 text-sm">
                                    <ArrowLeft className="w-4 h-4" />{t('返回')}
                                </button>
                            )}
                            <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-400 shadow-lg">
                                <Layout className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight text-white">{t('画布项目')}</h1>
                                <p className="text-sm text-zinc-500">{t('选择一个项目开始创作')}</p>
                            </div>
                        </div>
                        <button onClick={handleLogout} className="btn-ghost px-4 py-2 text-sm">
                            <LogOut className="w-4 h-4" />
                            {t('退出登录')}
                        </button>
                    </div>
                )}

                {/* 新建项目 */}
                <form onSubmit={handleCreate} className="flex gap-2 mb-8 animate-fade-in">
                    <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                        placeholder={t('新项目名称')} className="field flex-1" disabled={creating} />
                    <button type="submit" disabled={creating || !newName.trim()} className="btn-primary px-5 py-2.5 whitespace-nowrap">
                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {creating ? t('创建中...') : t('新建项目')}
                    </button>
                </form>

                {error && (
                    <div className="mb-6 flex items-center justify-between gap-3 p-4 rounded-xl border border-red-800/60 bg-red-950/40 text-red-300 text-sm">
                        <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}</span>
                        <button onClick={load} className="btn-ghost px-3 py-1.5 text-xs">
                            <RotateCw className="w-3.5 h-3.5" />{t('重试')}
                        </button>
                    </div>
                )}

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-24 text-zinc-500">
                        <Loader2 className="w-6 h-6 animate-spin mb-3" />
                        <span className="text-sm">{t('加载中...')}</span>
                    </div>
                ) : projects.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-zinc-800/60 border border-white/8 mb-4">
                            <Sparkles className="w-6 h-6 text-zinc-500" />
                        </div>
                        <p className="text-lg font-medium text-zinc-300 mb-1">{t('还没有项目')}</p>
                        <p className="text-sm text-zinc-500">{t('在上方输入名称创建你的第一个项目')}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {projects.map((p, i) => (
                            <div key={p.id} style={{ animationDelay: `${i * 40}ms` }}
                                className="group glass-card rounded-2xl p-5 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:border-white/15 animate-fade-in">
                                <div className="flex-1 cursor-pointer" onClick={() => onOpenProject(p)}>
                                    <div className="flex items-start gap-3 mb-3">
                                        <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-zinc-800/80 border border-white/8 shrink-0 group-hover:bg-brand-600/20 group-hover:border-brand-500/40 transition">
                                            <FolderOpen className="w-4 h-4 text-zinc-400 group-hover:text-brand-300 transition" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-semibold text-base text-white truncate">{p.name || t('未命名项目')}</div>
                                            <div className="text-xs text-zinc-500 mt-0.5">{t('更新于')} {formatDate(p.updated_at)}</div>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2 mt-2">
                                    <button onClick={() => onOpenProject(p)} className="btn-primary flex-1 px-3 py-2 text-sm">
                                        {t('打开')}
                                    </button>
                                    <button onClick={() => handleDelete(p.id)} disabled={deletingId === p.id}
                                        className="btn-ghost px-3 py-2 text-sm hover:!text-red-300 hover:!border-red-800/60">
                                        {deletingId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
