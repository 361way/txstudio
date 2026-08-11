import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './i18n'
import FlowHome from './pages/FlowHome'
import { bootstrapRuntimeCredentials } from './api/credential'

const rootElement = document.getElementById('root')

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: 32, fontFamily: 'sans-serif', color: '#7f1d1d' }}>
        <h2>页面运行出错</h2>
        <p>{this.state.error?.message || '未知错误'}</p>
        <button onClick={() => window.location.reload()}>重新加载</button>
      </div>
    )
  }
}

function App() {
  React.useEffect(() => {
    bootstrapRuntimeCredentials().catch(() => {
      // 后端离线时仍展示工作台，由具体操作给出连接错误。
    })
  }, [])

  return <FlowHome />
}

if (!rootElement) {
  document.body.innerHTML = '<div style="padding:24px;font-family:sans-serif">启动失败：未找到 #root 根节点。</div>'
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
