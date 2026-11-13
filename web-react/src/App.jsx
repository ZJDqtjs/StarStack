import React, { useEffect, useState } from 'react'
import { useApp } from './store.jsx'
import { I, StarMark, Avatar, Btn } from './ui.jsx'
import { f2 } from './api.js'
import Auth from './views/Auth.jsx'
import Home from './views/Home.jsx'
import Create from './views/Create.jsx'
import Workbench from './views/Workbench.jsx'
import Api from './views/Api.jsx'
import Market from './views/Market.jsx'
import Sell from './views/Sell.jsx'
import Messages from './views/Messages.jsx'
import Nodes from './views/Nodes.jsx'
import Pool from './views/Pool.jsx'
import Jobs from './views/Jobs.jsx'
import Wallet from './views/Wallet.jsx'
import Forum from './views/Forum.jsx'
import Settings from './views/Settings.jsx'

export const ROUTES = {
  home: '总览', image: '生图', video: '生视频', render: '渲染', build: '任务编排',
  api: '模型 API', market: '服务市场', sell: '我的发布', messages: '消息', nodes: '我的节点',
  pool: '算力市场', jobs: '我的任务', wallet: '钱包账单', forum: '论坛', settings: '设置',
}
const NAV = [
  { label: null, items: [['home', '总览', 'home']] },
  { label: '创作 · Create', items: [['image', '生图', 'image'], ['video', '生视频', 'video'], ['render', '渲染', 'render'], ['build', '编排', 'build'], ['api', '模型 API', 'api']] },
  { label: '交易 · Trade', items: [['market', '服务市场', 'market'], ['sell', '我的发布', 'sell'], ['messages', '消息', 'messages']] },
  { label: '算力 · Compute', items: [['nodes', '我的节点', 'nodes'], ['pool', '算力市场', 'pool']] },
  { label: '社区 · Community', items: [['forum', '论坛', 'forum']] },
  { label: '账户 · Account', items: [['jobs', '我的任务', 'jobs'], ['wallet', '钱包账单', 'wallet'], ['settings', '设置', 'settings']] },
]
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '')
  const [v, q] = h.split('?')
  const tab = q ? new URLSearchParams(q).get('tab') : null
  return { view: ROUTES[v] ? v : 'home', tab }
}
export function nav(view, tab) {
  const want = '#/' + view + (tab ? '?tab=' + tab : '')
  if (location.hash !== want) location.hash = want
}
function useHashRoute() {
  const [r, setR] = useState(parseHash)
  useEffect(() => {
    const h = () => setR(parseHash())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return r
}

function View({ view, tab }) {
  switch (view) {
    case 'home': return <Home />
    case 'image': return <Create kind="image" />
    case 'video': return <Create kind="video" />
    case 'render': return <Workbench svc="render" />
    case 'build': return <Workbench svc="build" />
    case 'api': return <Api tab={tab} />
    case 'market': return <Market tab={tab} />
    case 'sell': return <Sell tab={tab} />
    case 'messages': return <Messages />
    case 'nodes': return <Nodes />
    case 'pool': return <Pool />
    case 'jobs': return <Jobs />
    case 'wallet': return <Wallet />
    case 'forum': return <Forum />
    case 'settings': return <Settings />
    default: return <Home />
  }
}

export default function App() {
  const app = useApp()
  const { view, tab } = useHashRoute()
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('ss-side') === '1' } catch (e) { return false } })
  const [sideOpen, setSideOpen] = useState(false)
  useEffect(() => { setSideOpen(false) }, [view])
  const toggleCollapse = () => setCollapsed(c => { try { localStorage.setItem('ss-side', c ? '0' : '1') } catch (e) {} return !c })
  const signed = app.signedIn
  const online = app.workers.filter(w => w.online).length

  if (!app.ready) return <div className="app"><main><div className="empty inline">载入中…</div></main></div>

  return (
    <div className={'app' + (signed ? ' signed' : '') + (collapsed ? ' side-collapsed' : '') + (sideOpen ? ' side-open' : '')} id="app" data-view={view}>
      <div className="side-backdrop" onClick={() => setSideOpen(false)} />
      <aside className="side">
        <div className="side-top">
          <div className="brand">
            <div className="mark"><StarMark /></div>
            <div className="brand-txt"><b>星栈算力</b><span>Starstack · React</span></div>
          </div>
          <button className="side-toggle" onClick={toggleCollapse} aria-label="展开 / 收起侧边栏"><I name="chevL" size={14} /></button>
        </div>
        <div className="side-scroll">
          <nav id="nav" aria-label="主导航">
            {NAV.map((g, gi) => (
              <div className="nav-group" key={gi}>
                {g.label && <span className="nav-group-label">{g.label}</span>}
                {g.items.map(([v, label, icon]) => (
                  <button key={v} data-v={v} className={view === v ? 'on' : ''} onClick={() => nav(v)}>
                    <I name={icon} /><span className="nav-label">{label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </div>
        <div className="sidefoot">
          <div className="wallet" id="wallet">
            <span className="wallet-label">账户余额</span><b>{f2(app.me ? app.me.credits : 0)}</b><span className="wallet-unit">算力点</span>
          </div>
          <div className="side-row">
            <button className="iconbtn" onClick={() => app.setTheme(app.theme === 'dark' ? 'light' : 'dark')} aria-label="切换深色 / 浅色" title="切换深色 / 浅色">
              <I name={app.theme === 'dark' ? 'sun' : 'moon'} size={15} />
            </button>
            <div className="who" onClick={() => nav('settings')}>
              <Avatar name={app.me ? app.me.name : '?'} /><span className="uname">{app.me ? app.me.name : ''}</span>
            </div>
            <Btn ghost onClick={app.logout}>退出</Btn>
          </div>
        </div>
      </aside>
      <main>
        <div className="topbar">
          <button className="menu-btn" onClick={() => setSideOpen(true)} aria-label="打开导航"><I name="menu" size={15} /></button>
          <div className="crumb"><span className="crumb-root">星栈控制台</span><span className="sep crumb-root">/</span><b>{ROUTES[view]}</b></div>
          <div className="topbar-right">
            <span className="tb-pill hide-sm"><i className="live-dot" />在线节点 <b>{online}</b></span>
            <span className="tb-pill">余额 <b>{f2(app.me ? app.me.credits : 0)}</b> 点</span>
            <button className="tb-new" onClick={() => nav('render')}><I name="plus" size={13} />新建任务</button>
          </div>
        </div>
        <div className="view on" key={view + (tab || '')}>
          {signed ? <View view={view} tab={tab} /> : <Auth />}
        </div>
      </main>
    </div>
  )
}