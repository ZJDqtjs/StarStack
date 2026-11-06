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

const NAV_GROUPS: { label: string; items: [string, string][] }[] = [
  { label: 'Work · 工作台', items: [['submit', '提交'], ['jobs', '任务'], ['market', '市场']] },
  { label: 'Compute · 算力', items: [['vm', '云主机'], ['nodes', '节点'], ['api', '模型 API']] },
  { label: 'Account · 账户', items: [['bill', '账单'], ['forum', '论坛'], ['me', '我的']] },
]
const NAV: [string, string][] = NAV_GROUPS.reduce((all, g) => all.concat(g.items), [] as [string, string][])

const ICONS: Record<string, React.ReactNode> = {
  submit: <><path d="M12 5v14M5 12h14" /></>,
  jobs: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M8 12h8M8 16h5" /></>,
  market: <><path d="M4 7h16M5 7l1 12h12l1-12M9 11v5M15 11v5" /></>,
  vm: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4M7 9h6" /></>,
  nodes: <><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></>,
  api: <><path d="M8 5 4 9l4 4M16 9l4 4-4 4M14 4l-4 12" /></>,
  bill: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></>,
  forum: <><path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v9Z" /></>,
  me: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
}

const PAGE_META: Record<string, { eyebrow: string; title: string; desc: string; tone: string }> = {
  submit: { eyebrow: 'New Task', title: '提交任务', desc: '上传素材、设定参数并预估花费，提交后按实测用量结算。', tone: 'compute' },
  jobs: { eyebrow: 'My Jobs', title: '我的任务', desc: '分片派发、进度、哈希校验与结算明细都在这里。', tone: 'compute' },
  market: { eyebrow: 'Capacity Market', title: '算力市场', desc: '在线节点、可调度切片与实时单价，点击节点可指定派发。', tone: 'market' },
  vm: { eyebrow: 'Cloud Instances', title: '云主机', desc: '按小时租用虚拟机，或把自己的机器发布成可租用配置。', tone: 'compute' },
  nodes: { eyebrow: 'Provider Nodes', title: '我的节点', desc: '把闲置机器接入算力池，按实测用量获得收益。', tone: 'market' },
  api: { eyebrow: 'Model Gateway', title: '模型 API', desc: 'OpenAI 兼容网关、密钥管理与上游接入，按 token 结算。', tone: 'create' },
  bill: { eyebrow: 'Billing & Ledger', title: '账单与收益', desc: '账户流水、充值与节点收益；校验不通过的分片不结算。', tone: 'account' },
  forum: { eyebrow: 'Community', title: '星栈论坛', desc: '分享工作流、讨论调度策略、展示作品。', tone: 'community' },
  me: { eyebrow: 'Account Center', title: '个人中心', desc: '账户资料、连接设置与界面偏好。', tone: 'account' },
}

const VIEWS: Record<string, any> = { submit: Submit, jobs: Jobs, market: Market, vm: Vm, nodes: Nodes, api: ApiView, bill: Bill, forum: Forum, me: Me }

export default function App() {
  const [theme, setTheme] = useState(store.get('ss-theme') || 'light')
  const [me, setMe] = useState<any>(null)
  const [policy, setPolicy] = useState<any>(null)
  const [workers, setWorkers] = useState<any[]>([])
  const [jobs, setJobs] = useState<any[]>([])
  const [view, setView] = useState('submit')
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
                setView('submit')
              }}
            />
          </div>
          {toast && <div className={'toast' + (toast.tone ? ' ' + toast.tone : '')}>{toast.msg}</div>}
        </div>
      </AppCtx.Provider>
    )
  }

  const View = VIEWS[view] || Submit
  const online = workers.filter((w) => w.online).length
  const freeSlots = workers.filter((w) => w.online).reduce((a, w) => a + Math.max(0, (w.slots || 0) - (w.active || 0)), 0)
  const meta = PAGE_META[view] || PAGE_META.submit

  const hero = (
    <>
      <div className="nx-hero" data-tone={meta.tone}>
        <div>
          <span className="nx-eyebrow">{meta.eyebrow}</span>
          <h1>{meta.title}</h1>
          <p>{meta.desc}</p>
        </div>
        <div className="nx-hero-side">
          <div className="nx-hero-badge">
            <b>{online}</b>
            <span>在线节点</span>
          </div>
        </div>
      </div>
      <div className="nx-kpis">
        <div className="nx-kpi"><span>空闲槽位</span><b>{freeSlots}</b><i>▦</i></div>
        <div className="nx-kpi"><span>我的任务</span><b>{jobs.length}</b><i>◈</i></div>
        <div className="nx-kpi"><span>账户余额</span><b>{f2(me.credits)}</b><i>◉</i></div>
      </div>
    </>
  )

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
            {NAV_GROUPS.map((g) => (
              <div className="nav-group" key={g.label}>
                <span className="nav-group-label">{g.label}</span>
                {g.items.map(([v, label]) => (
                  <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                    <svg className="nav-ico" viewBox="0 0 24 24">{ICONS[v]}</svg>
                    {label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <div className="wallet">
              <span>账户余额</span>
              <b>{f2(me.credits)} 算力点</b>
            </div>
            <div className="side-row">
              {themeBtn}
              <span className="avatar">{me.name.slice(0, 1).toUpperCase()}</span>
              <button className="btn ghost tiny" onClick={signOut}>
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
            {hero}
            <View />
          </main>
        </div>
        {toast && <div className={'toast' + (toast.tone ? ' ' + toast.tone : '')}>{toast.msg}</div>}
      </div>
    </AppCtx.Provider>
  )
}
