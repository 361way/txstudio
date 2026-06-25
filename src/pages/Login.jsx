/**
 * 登录/注册页
 * SaaS 化入口：未登录时展示此页，登录后跳转主应用
 */
import React, { useState } from 'react';
import { Sparkles, Mail, Lock, User, AlertCircle, Loader2 } from 'lucide-react';
import { login, register } from '../api/auth';

export default function Login({ onLoginSuccess }) {
    const [mode, setMode] = useState('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            let user;
            if (mode === 'login') {
                user = await login(email, password);
            } else {
                user = await register({ email, password, displayName });
            }
            if (onLoginSuccess) onLoginSuccess(user);
        } catch (err) {
            setError(err.message || '操作失败');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="app-surface min-h-screen flex items-center justify-center px-4">
            <div className="w-full max-w-md animate-fade-in">
                {/* 品牌头部 */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-gradient shadow-glow mb-4">
                        <Sparkles className="w-7 h-7 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                        VodStudio
                    </h1>
                    <p className="text-zinc-500 mt-2 text-sm">AI 视频创作工作流平台</p>
                </div>

                <div className="glass-card rounded-2xl p-8">
                    <div className="segmented mb-6">
                        <button type="button" data-active={mode === 'login'} onClick={() => { setMode('login'); setError(''); }}>
                            登录
                        </button>
                        <button type="button" data-active={mode === 'register'} onClick={() => { setMode('register'); setError(''); }}>
                            注册
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {mode === 'register' && (
                            <div>
                                <label className="block text-xs font-medium text-zinc-400 mb-1.5">显示名称</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                                    <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                                        placeholder="你的名字" className="field pl-10" />
                                </div>
                            </div>
                        )}
                        <div>
                            <label className="block text-xs font-medium text-zinc-400 mb-1.5">邮箱</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                                    placeholder="you@example.com" className="field pl-10" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-zinc-400 mb-1.5">密码</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                                    required minLength={6} placeholder="至少 6 位" className="field pl-10" />
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-start gap-2 text-red-300 text-sm bg-red-950/40 border border-red-800/60 rounded-xl px-3.5 py-2.5">
                                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2">
                            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                            {loading ? '处理中...' : (mode === 'login' ? '登录' : '注册')}
                        </button>
                    </form>
                </div>

                <p className="text-center text-zinc-600 text-xs mt-6">注册即自动创建你的专属工作空间</p>
            </div>
        </div>
    );
}
