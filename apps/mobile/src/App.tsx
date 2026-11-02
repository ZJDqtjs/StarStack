import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, store } from './api'
import { AppCtx } from './ctx'
import { f2 } from '../../shared/index.js'
import Auth from './views/Auth'
import Submit from './views/Submit'
import Jobs from './views/Jobs'
import Market from './views/Market'
import Vm from './views/Vm'
import Nodes from './views/Nodes'
import ApiView from './views/ApiView'
import Bill from './views/Bill'
import Forum from './views/Forum'
import Me from './views/Me'

const NAV = [
  ['dashboard', '总览'],
  ['submit', '提交'],
  ['jobs', '任务'],
  ['market', '市场'],
  ['vm', '云主机'],
  ['nodes', '节点'],
  ['api', '模型 API'],
  ['bill', '账单'],
  ['forum', '论坛'],
  ['me', '我的'],
]

const VIEWS: Record<string, any> = { dashboard: Dashboard, submit: Submit, jobs: Jobs, market: Market, vm: Vm, nodes: Nodes, api: ApiView, bill: Bill, forum: Forum, me: Me }

function Dashboard({ workers, jobs, me, onNavigate }: any) {
  const online = workers.filter((w: any) => w.online)
  const free = online.reduce((n: number, w: any) => n + Math.max(0, Number(w.slots || 0) - Number(w.active || 0)), 0)
  const running = jobs.filter((j: any) => j.status === 'running').length
  const gpu = online.reduce((n: number, w: any) => n + (w.gpus || []).reduce((m: number, g: any) => m + Number(g.mem_mb || 0), 0), 0)
  const memory = gpu ? (gpu >= 1024 ? (gpu / 1024).toFixed(1) + ' GB' : Math.round(gpu) + ' MB') : '—'
  const recent = [...jobs].slice(0, 5)
  return (
    <section className="dashboard">
      <div className="dash-hero">
        <div><div className="dash-eyebrow">STARSTACK / COMPUTE CONTROL CENTER</div><h1>算力控制中心</h1><p>你的分布式算力网络，实时运行状态一览。</p></div>
        <button className="btn" onClick={() => onNavigate('submit')}>＋ 创建任务</button>
      </div>
      <div className="dash-metrics">
        {[
          ['在线节点', online.length, '共 ' + workers.length + ' 台已登记节点'],
          ['可用算力槽', free, '在线节点剩余并发槽'],
          ['运行中任务', running, '当前任务 ' + jobs.length + ' 个'],
          ['GPU 显存总量', memory, gpu ? '在线节点上报合计' : '当前无可用显存数据'],
        ].map(([label, value, note]) => <div className="dash-metric" key={String(label)}><span>{label}</span><b>{value}</b><small>{note}</small></div>)}
      </div>
      <div className="dash-columns">
        <div className="card">
          <div className="dash-cardhead"><div><span className="kicker">LIVE COMPUTE POOL</span><h2>算力池状态</h2></div><span className="dash-live">● 实时同步</span></div>
          <div className="dash-pool">
            {online.length ? online.slice(0, 4).map((w: any) => <div className="dash-poolitem" key={w.id}>
              <b>{w.name || w.id}</b><span>{w.cpus || 0} 核 · {w.mem_mb ? (w.mem_mb / 1024).toFixed(1) + ' GB RAM' : '内存未知'}</span>
              <small>并发槽 {Math.max(0, Number(w.slots || 0) - Number(w.active || 0))}/{w.slots || 0}</small>
            </div>) : <div className="empty">算力池暂无在线节点。前往「我的节点」接入设备。</div>}
          </div>
          <button className="btn ghost" onClick={() => onNavigate('market')}>查看算力市场 →</button>
        </div>
        <div className="card">
          <div className="dash-cardhead"><div><span className="kicker">QUICK ACCESS</span><h2>常用入口</h2></div></div>
          <div className="dash-shortcuts">
            {([['submit','＋','提交新任务','转码、渲染与编译'],['jobs','▤','任务中心','进度、日志与产物'],['nodes','⌘','节点管理','接入、收益与调度'],['api','◇','模型 API','上游与模型目录']] as string[][]).map(([id,icon,label,note]) =>
              <button key={id} onClick={() => onNavigate(id)}><b>{icon}</b><span>{label}<small>{note}</small></span><i>→</i></button>)}
          </div>
          <div className="dash-balance"><span>账户可用余额</span><b>{Number(me?.credits || 0).toFixed(2)} 点</b></div>
        </div>
      </div>
      <div className="card dash-recent">
        <div className="dash-cardhead"><div><span className="kicker">RECENT ACTIVITY</span><h2>最近任务</h2></div><button className="btn ghost tiny" onClick={() => onNavigate('jobs')}>全部任务 →</button></div>
        {recent.length ? recent.map((j: any) => <div className="dash-recentrow" key={j.id}><div><b>{j.name || j.id}</b><small>{j.kind || '任务'} · {j.id}</small></div><span className={'tag ' + (j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : 'link')}>{({queued:'排队中',running:'运行中',done:'已完成',failed:'失败',cancelled:'已取消'} as any)[j.status] || j.status}</span></div>) : <div className="empty">还没有任务记录，创建第一个任务开始使用算力池。</div>}
      </div>
      <p className="dash-disclaimer">数据来自当前 Broker 实时状态接口；节点、显存与任务统计仅包含实际上报的数据。</p>
    </section>
  )
}

export default function App() {
  const [theme, setTheme] = useState(store.get('ss-theme') || 'light')
  const [me, setMe] = useState<any>(null)
  const [policy, setPolicy] = useState<any>(null)
  const [workers, setWorkers] = useState<any[]>([])
  const [jobs, setJobs] = useState<any[]>([])
  const [view, setView] = useState('dashboard')
  const [booting, setBooting] = useState(true)
  const [toast, setToast] = useState<{ msg: string; tone?: string } | null>(null)
  const [targetNode, setTargetNode] = useState<any>(null)
  const toastTimer = useRef<any>(null)

  const showToast = useCallback((msg: string, tone?: string) => {
    setToast({ msg, tone })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    store.set('ss-theme', theme)
  }, [theme])

  const signOut = useCallback(() => {
    api.logout().catch(() => {})
    store.set('ss-token', '')
    setMe(null)
    setJobs([])
    setWorkers([])
    setView('submit')
  }, [])

  // Bootstrap: read the deployment policy before login so the auth card can
  // advertise the signup grant, then resume a stored token.
  useEffect(() => {
    ;(async () => {
      try {
        const st = await api.state()
        if (st.policy) setPolicy(st.policy)
      } catch {
        /* broker offline: stay on the auth screen with defaults */
      }
      try {
        const m = await api.me()
        if (m.signed_in) setMe(m)
      } catch {
        /* no session */
      }
      setBooting(false)
    })()
  }, [])

  const signedIn = !!me

  useEffect(() => {
    if (!signedIn) return
    let alive = true
    let timer: any
    const tick = async () => {
      try {
        const st = await api.state()
        if (!alive) return
        if (!st.signed_in) {
          signOut()
          return
        }
        setMe(st.me)
        setWorkers((st.workers || []).slice().sort((a: any, b: any) => b.online - a.online || b.mine - a.mine || String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh-CN')))
        setJobs(st.jobs || [])
        if (st.policy) setPolicy(st.policy)
      } catch (e: any) {
        if (e && e.status === 401) {
          signOut()
          return
        }
      }
      timer = setTimeout(tick, 2000)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [signedIn, signOut])

  const ctx = useMemo(
    () => ({ api, me, policy, workers, jobs, view, setView, showToast, signOut, setMe, targetNode, setTargetNode }),
    [me, policy, workers, jobs, view, showToast, signOut, targetNode],
  )

  if (booting) {
    return (
      <div className="app">
        <div className="main" style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
          <div className="empty">
            <span className="spin" /> 正在连接算力池…
          </div>
        </div>
      </div>
    )
  }

  if (!me) {
    return (
      <AppCtx.Provider value={ctx}>
        <div className="app">
          <div className="main">
            <Auth
              policy={policy}
              onDone={(m: any) => {
                setMe(m)
                setView('dashboard')
              }}
            />
          </div>
          {toast && <div className={'toast' + (toast.tone ? ' ' + toast.tone : '')}>{toast.msg}</div>}
        </div>
      </AppCtx.Provider>
    )
  }

  const View = VIEWS[view] || Submit

  const themeBtn = (
    <button className="iconbtn" aria-label="切换深浅色" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      <svg className="i-sun" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </svg>
      <svg className="i-moon" viewBox="0 0 24 24">
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
      </svg>
    </button>
  )

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand side-brand">
            <div className="mark">星</div>
            <div>
              <b>星栈算力</b>
              <span>Compute Share</span>
            </div>
          </div>
          <nav className="side-nav">
            {NAV.map(([v, label]) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="side-foot">
            <div className="wallet">
              余额 <b>{f2(me.credits)}</b>
            </div>
            <div className="side-row">
              {themeBtn}
              <span className="avatar">{me.name.slice(0, 1).toUpperCase()}</span>
              <button className="ghost tiny" onClick={signOut}>
                退出
              </button>
            </div>
          </div>
        </aside>

        <div className="content">
          <header className="header">
            <div className="header-row">
              <div className="brand">
                <div className="mark">星</div>
                <div>
                  <b>星栈算力</b>
                  <span>Compute Share</span>
                </div>
              </div>
              <div className="wallet">
                余额 <b>{f2(me.credits)}</b>
              </div>
              {themeBtn}
            </div>
            <nav className="tabs">
              {NAV.map(([v, label]) => (
                <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                  {label}
                </button>
              ))}
            </nav>
          </header>
          <main className="main">
            {view === 'dashboard' ? <Dashboard workers={workers} jobs={jobs} me={me} onNavigate={setView} /> : <View />}
          </main>
        </div>
        {toast && <div className={'toast' + (toast.tone ? ' ' + toast.tone : '')}>{toast.msg}</div>}
      </div>
    </AppCtx.Provider>
  )
}
