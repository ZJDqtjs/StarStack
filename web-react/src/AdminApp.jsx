import React, { useState } from 'react'
import { useApp } from './store.jsx'
import { useHashRoute, nav } from './router.js'
import { I, StarMark, Btn } from './ui.jsx'
import { f2 } from './api.js'
import AdminOverview from './views/admin/Overview.jsx'
import AdminNodes from './views/admin/Nodes.jsx'
import AdminPool from './views/admin/Pool.jsx'
import AdminAlloc from './views/admin/Alloc.jsx'

const ADMIN_NAV = [
  ['admin', '管理总览', 'trend'],
  ['admin-nodes', '节点监控', 'nodes'],
  ['admin-pool', 'API 池部署', 'api'],
  ['admin-alloc', '算力调拨', 'settings'],
]
const TITLES = { admin: '管理总览', 'admin-nodes': '节点监控', 'admin-pool': 'API 池部署', 'admin-alloc': '算力调拨' }

function AdminLogin() {
  const { login } = useApp()
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async e => {
    e.preventDefault()
    if (!pw) { setMsg('请输入管理口令'); return }
    setBusy(true); setMsg('')
    try { await login(pw); setPw('') } catch (err) { setMsg('登录失败：' + err) } finally { setBusy(false) }
  }
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <form onSubmit={submit} className="card" style={{ width: 'min(420px,94vw)', margin: 0, padding: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <div className="mark" style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#b45309,#dc2626)', color: '#fff' }}><StarMark size={18} /></div>
          <div><b style={{ fontSize: 16 }}>星栈管理控制台</b><div className="sub-line">STARSTACK OPS · 独立认证</div></div>
        </div>
        <div className="hint" style={{ marginTop: 0 }}>管理控制台使用独立的管理口令与会话（admin token），与用户控制台会话完全隔离。</div>
        <label>管理口令</label>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" placeholder="STARSTACK_ADMIN_PASSWORD" autoFocus />
        <Btn block type="submit" disabled={busy} style={{ marginTop: 18 }}>{busy ? '验证中…' : '进入管理控制台'}</Btn>
        <div className="hint" role="alert" style={{ color: msg ? 'var(--bad)' : undefined }}>{msg}</div>
      </form>
    </div>
  )
}

export default function AdminApp() {
  const app = useApp()
  const { view: raw } = useHashRoute()
  const view = raw && raw.startsWith('admin') ? raw : 'admin'
  const [collapsed, setCollapsed] = useState(false)
  const [sideOpen, setSideOpen] = useState(false)
  if (!app.ready) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><div className="empty inline">载入中…</div></div>
  if (!app.signedIn) return <AdminLogin />
  const online = app.workers.filter(w => w.online).length
  const Body = view === 'admin-nodes' ? AdminNodes : view === 'admin-pool' ? AdminPool : view === 'admin-alloc' ? AdminAlloc : AdminOverview
  return (
    <div className={'app signed' + (collapsed ? ' side-collapsed' : '') + (sideOpen ? ' side-open' : '')} id="app" data-view={view}>
      <div className="side-backdrop" onClick={() => setSideOpen(false)} />
      <aside className="side">
        <div className="side-top">
          <div className="brand">
            <div className="mark" style={{ background: 'linear-gradient(135deg,#b45309,#dc2626)' }}><StarMark /></div>
            <div className="brand-txt"><b>星栈管理</b><span>Ops Console</span></div>
          </div>
          <button className="side-toggle" onClick={() => setCollapsed(c => !c)} aria-label="折叠侧边栏"><I name="chevL" size={14} /></button>
        </div>
        <div className="side-scroll">
          <nav id="nav" aria-label="管理导航">
            <div className="nav-group">
              <span className="nav-group-label">管理 · Admin</span>
              {ADMIN_NAV.map(([v, label, icon]) => (
                <button key={v} data-v={v} className={view === v ? 'on' : ''} onClick={() => { nav(v); setSideOpen(false) }}>
                  <I name={icon} /><span className="nav-label">{label}</span>
                </button>
              ))}
            </div>
          </nav>
        </div>
        <div className="sidefoot">
          <div className="wallet"><span className="wallet-label">平台账户</span><b>{app.me ? app.me.name : 'admin'}</b><span className="wallet-unit">ops</span></div>
          <div className="side-row">
            <button className="iconbtn" onClick={() => app.setTheme(app.theme === 'dark' ? 'light' : 'dark')} aria-label="切换主题"><I name={app.theme === 'dark' ? 'sun' : 'moon'} size={15} /></button>
            <Btn ghost onClick={app.logout}>退出管理</Btn>
          </div>
        </div>
      </aside>
      <main>
        <div className="topbar">
          <button className="menu-btn" onClick={() => setSideOpen(true)} aria-label="打开导航"><I name="menu" size={15} /></button>
          <div className="crumb"><span className="crumb-root">星栈管理控制台</span><span className="sep crumb-root">/</span><b>{TITLES[view]}</b></div>
          <div className="topbar-right">
            <span className="tb-pill hide-sm"><i className="live-dot" />在线节点 <b>{online}</b></span>
            <span className="tb-pill">余额 <b>{f2(app.me ? app.me.credits : 0)}</b> 点</span>
          </div>
        </div>
        <div className="view on" key={view}><Body /></div>
      </main>
    </div>
  )
}