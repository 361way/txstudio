import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import i18n from './i18n'
import Login from './pages/Login.jsx'
import AppShell from './pages/AppShell.jsx'
import Admin from './pages/Admin.jsx'
import { isLoggedIn, me } from './api/auth'
import { onForceLogout } from './api/authEvents'

const BOOT_TIMEOUT_MS = 5000
const rootElement = document.getElementById('root')
const t = i18n.t.bind(i18n)

window.__APP_BOOTED__ = false
window.__APP_ERRORS__ = window.__APP_ERRORS__ || []

const recordAppError = (error, meta = {}) => {
    const entry = {
        time: new Date().toISOString(),
        message: error?.message || String(error),
        stack: error?.stack || '',
        meta
    }
    window.__APP_ERRORS__.push(entry)
    if (window.__APP_ERRORS__.length > 50) {
        window.__APP_ERRORS__.shift()
    }
    return entry
}

const buildErrorPayload = (error, meta = {}) => {
    const latest = recordAppError(error, meta)
    return JSON.stringify({ latest, errors: window.__APP_ERRORS__ }, null, 2)
}

const copyText = async (text) => {
    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text)
            return true
        }
    } catch { }
    try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'absolute'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        return true
    } catch {
        return false
    }
}

const renderFallbackDom = (error, meta = {}) => {
    if (!rootElement) return
    const payload = buildErrorPayload(error, meta)
    rootElement.innerHTML = `
      <div style="position:fixed;inset:0;background:#0b0b0c;color:#f3f3f3;display:flex;align-items:center;justify-content:center;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;">
        <div style="width:min(900px,92vw);background:#141416;border:1px solid #2a2a2d;border-radius:12px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
          <div style="font-size:18px;font-weight:700;margin-bottom:8px;">${t('VodStudio 启动失败')}</div>
          <div style="font-size:12px;color:#b6b6c2;margin-bottom:16px;">${t('应用启动过程中发生异常，已启用黑屏保护。')}</div>
          <div style="background:#0f0f12;border:1px solid #2a2a2d;border-radius:8px;padding:12px;font-size:12px;white-space:pre-wrap;max-height:240px;overflow:auto;">${payload.replace(/</g, '&lt;')}</div>
          <div style="display:flex;gap:10px;margin-top:16px;">
            <button id="vodstudio-reload" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-size:12px;cursor:pointer;">${t('重新加载')}</button>
            <button id="vodstudio-copy" style="background:#27272a;color:#fff;border:1px solid #3f3f46;border-radius:8px;padding:8px 12px;font-size:12px;cursor:pointer;">${t('复制错误详情')}</button>
          </div>
        </div>
      </div>
    `
    const reloadBtn = document.getElementById('vodstudio-reload')
    const copyBtn = document.getElementById('vodstudio-copy')
    if (reloadBtn) reloadBtn.onclick = () => window.location.reload()
    if (copyBtn) copyBtn.onclick = () => copyText(payload)
}

const attachGlobalErrorHandlers = () => {
    const previousOnError = window.onerror
    const previousOnUnhandled = window.onunhandledrejection

    window.onerror = (message, source, lineno, colno, error) => {
        recordAppError(error || message, { type: 'onerror', source, lineno, colno })
        if (typeof previousOnError === 'function') {
            return previousOnError(message, source, lineno, colno, error)
        }
        return false
    }

    window.onunhandledrejection = (event) => {
        recordAppError(event?.reason || 'UnhandledRejection', { type: 'unhandledrejection' })
        if (typeof previousOnUnhandled === 'function') {
            return previousOnUnhandled(event)
        }
        return false
    }
}

const FatalScreen = ({ error, meta }) => {
    const payload = buildErrorPayload(error, meta)
    return (
        <div style={{ position: 'fixed', inset: 0, background: '#0b0b0c', color: '#f3f3f3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,Segoe UI,Roboto,Helvetica,Arial' }}>
            <div style={{ width: 'min(900px,92vw)', background: '#141416', border: '1px solid #2a2a2d', borderRadius: 12, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{t('VodStudio 启动失败')}</div>
                <div style={{ fontSize: 12, color: '#b6b6c2', marginBottom: 16 }}>{t('应用启动过程中发生异常，已启用黑屏保护。')}</div>
                <div style={{ background: '#0f0f12', border: '1px solid #2a2a2d', borderRadius: 8, padding: 12, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>{payload}</div>
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                    <button onClick={() => window.location.reload()} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}>{t('重新加载')}</button>
                    <button onClick={() => copyText(payload)} style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46', borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}>{t('复制错误详情')}</button>
                </div>
            </div>
        </div>
    )
}

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { error: null }
    }
    static getDerivedStateFromError(error) {
        return { error }
    }
    componentDidCatch(error, info) {
        recordAppError(error, { type: 'error_boundary', info })
    }
    render() {
        if (this.state.error) {
            return <FatalScreen error={this.state.error} meta={{ type: 'error_boundary' }} />
        }
        return this.props.children
    }
}

const BootGuard = ({ children }) => {
    const [timedOut, setTimedOut] = React.useState(false)
    React.useEffect(() => {
        const timer = window.setTimeout(() => {
            if (!window.__APP_BOOTED__) {
                recordAppError(new Error('APP_BOOT_TIMEOUT'), { type: 'boot_timeout' })
                setTimedOut(true)
            }
        }, BOOT_TIMEOUT_MS)
        window.__APP_BOOT_TIMER__ = timer
        return () => window.clearTimeout(timer)
    }, [])

    if (timedOut) {
        return <FatalScreen error={new Error(t('启动超时'))} meta={{ type: 'boot_timeout' }} />
    }
    return children
}

attachGlobalErrorHandlers()

// AuthGate: 多态门禁 — 未登录显示 Login；已登录按角色显示工具选择页/管理后台/工具页/画布
// needLogin 事件（token 失效）会强制回到登录态
const AuthGate = () => {
    const [authed, setAuthed] = React.useState(() => isLoggedIn())
    const [view, setView] = React.useState('shell') // shell|admin
    const [shellTab, setShellTab] = React.useState('image') // image|video|canvas|templates
    const [currentProject, setCurrentProject] = React.useState(null)
    const [appliedTemplate, setAppliedTemplate] = React.useState(null)
    const [userProfile, setUserProfile] = React.useState(null) // {is_super_admin, quota, user}
    const [theme, setTheme] = React.useState(() => {
        try { return localStorage.getItem('vodstudio_theme') || 'dark' } catch { return 'dark' }
    })

    // 登录后拉取用户信息（角色 + 配额）
    const refreshProfile = React.useCallback(async () => {
        try {
            const data = await me();
            // me() 返回 {user, is_super_admin, quota}
            setUserProfile(data);
        } catch (e) { /* 静默，token 失效会被 forceLogout 处理 */ }
    }, []);

    React.useEffect(() => {
        if (authed) refreshProfile();
    }, [authed, view, refreshProfile]);

    // 监听强制登出事件（api 层 401 刷新失败时触发）
    React.useEffect(() => {
        const unsub = onForceLogout(() => {
            setAuthed(false)
            setCurrentProject(null)
            setUserProfile(null)
            setView('shell')
        })
        return unsub
    }, [])

    // BootGuard 等待 App 设置 __APP_BOOTED__；但登录/工具态下 App 未挂载，
    // AuthGate 一旦渲染就说明 React 启动成功，立即标记，避免 BootGuard 5s 超时误报。
    React.useEffect(() => {
        window.__APP_BOOTED__ = true
        if (window.__APP_BOOT_TIMER__) { clearTimeout(window.__APP_BOOT_TIMER__); window.__APP_BOOT_TIMER__ = null }
    }, [])

    // 跟踪主题
    React.useEffect(() => {
        const sync = () => { try { setTheme(localStorage.getItem('vodstudio_theme') || 'dark') } catch { } }
        window.addEventListener('storage', sync)
        const interval = setInterval(sync, 1000)
        return () => { window.removeEventListener('storage', sync); clearInterval(interval) }
    }, [])

    const handleLoginSuccess = () => {
        setAuthed(true)
        setView('shell')
        setShellTab('image')
        setCurrentProject(null)
    }

    // 画布：项目列表 → 编辑器，全部内嵌在 AppShell 的画布标签页中
    const handleOpenProject = (project) => { setCurrentProject(project) }
    const handleExitToProjects = () => { setCurrentProject(null) }
    const forcedLogout = () => { setAuthed(false); setCurrentProject(null); setUserProfile(null); setView('shell') }

    const quota = userProfile?.quota || null
    const isSuperAdmin = userProfile?.is_super_admin || false

    if (!authed) return <Login onLoginSuccess={handleLoginSuccess} />

    // 管理员后台（独立页，超管专用）
    if (view === 'admin') {
        return <Admin onForcedLogout={forcedLogout} theme={theme} onBack={() => setView('shell')} />
    }

    // 默认主界面：侧边栏 Shell（图片/视频/画布/模板全部内联，仅管理后台跳转）
    return <AppShell
        active={shellTab}
        onNavigate={(tab) => { setShellTab(tab); }}
        onOpenAdmin={() => setView('admin')}
        quota={quota}
        theme={theme}
        isSuperAdmin={isSuperAdmin}
        onForcedLogout={forcedLogout}
        appliedTemplate={appliedTemplate}
        onApplyTemplate={(tpl) => { setAppliedTemplate(tpl); setShellTab(tpl.type === 'image' ? 'image' : 'video'); }}
        canvasProject={currentProject}
        onOpenProject={handleOpenProject}
        onExitToProjects={handleExitToProjects}
    />
}

try {
    if (!rootElement) throw new Error('Root element not found')
    const root = ReactDOM.createRoot(rootElement)
    root.render(
        <React.StrictMode>
            <ErrorBoundary>
                <BootGuard>
                    <AuthGate />
                </BootGuard>
            </ErrorBoundary>
        </React.StrictMode>
    )
} catch (error) {
    renderFallbackDom(error, { type: 'bootstrap' })
}
