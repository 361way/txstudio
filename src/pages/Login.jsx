/**
 * 登录/注册页
 * SaaS 化入口：未登录时展示此页，登录后跳转主应用
 */
import React, { useState } from 'react';
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
        <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-white">VodStudio</h1>
                    <p className="text-gray-400 mt-2">AI 视频创作工作流平台</p>
                </div>
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-8">
                    <div className="flex gap-2 mb-6">
                        <button type="button" onClick={() => { setMode('login'); setError(''); }}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${mode === 'login' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                            登录
                        </button>
                        <button type="button" onClick={() => { setMode('register'); setError(''); }}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${mode === 'register' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                            注册
                        </button>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {mode === 'register' && (
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">显示名称</label>
                                <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder="你的名字"
                                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
                            </div>
                        )}
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">邮箱</label>
                            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                                placeholder="you@example.com"
                                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">密码</label>
                            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                                required minLength={6} placeholder="至少 6 位"
                                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
                        </div>
                        {error && (
                            <div className="text-red-400 text-sm bg-red-950/50 border border-red-800 rounded-lg px-4 py-2">{error}</div>
                        )}
                        <button type="submit" disabled={loading}
                            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition">
                            {loading ? '处理中...' : (mode === 'login' ? '登录' : '注册')}
                        </button>
                    </form>
                </div>
                <p className="text-center text-gray-600 text-xs mt-6">注册即自动创建你的专属工作空间</p>
            </div>
        </div>
    );
}
