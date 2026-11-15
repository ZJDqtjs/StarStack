import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppCtx } from './store.jsx'
import { api, post, setAdminToken, BASE } from './api.js'

const TOKEN_KEY = 'ss-admin-token'
const sortWorkers = ws => ws.slice().sort((a, b) => (b.online - a.online) || (b.mine - a.mine) || String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh-CN'))
let seq = 0

export function AdminProvider({ children }) {
  const [token, setToken] = useState(() => { try { return localStorage.getItem(TOKEN_KEY) || '' } catch (e) { return '' } })
  const [ready, setReady] = useState(false)
  const [me, setMe] = useState(null)
  const [policy, setPolicy] = useState(null)
  const [workers, setWorkers] = useState([])
  const [jobs, setJobs] = useState([])
  const [contrib, setContrib] = useState(null)
  const [target, setTarget] = useState(null)
  const [prefill, setPrefill] = useState(null)
  const [toasts, setToasts] = useState([])
  const [dialog, setDialog] = useState(null)
  const [theme, setThemeState] = useState(() => document.documentElement.dataset.theme || 'dark')

  const toast = useCallback((msg, kind = 'info', title) => {
    const id = ++seq
    setToasts(t => [...t, { id, msg, kind, title }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200)
  }, [])
  const confirm = useCallback((body, title = '请确认') => new Promise(res => setDialog({ mode: 'confirm', title, body, resolve: res })), [])
  const prompt = useCallback((body, def = '', title = '输入') => new Promise(res => setDialog({ mode: 'input', title, body, input: String(def), resolve: res })), [])
  const closeDialog = useCallback(val => setDialog(d => { if (d) d.resolve(val); return null }), [])
  const setTheme = useCallback(t => { document.documentElement.dataset.theme = t; try { localStorage.setItem('ss-admin-theme', t) } catch (e) {} setThemeState(t) }, [])

  const signedIn = !!token
  useEffect(() => { setAdminToken(token) }, [token])

  // 校验既有 token
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!token) { setReady(true); return }
      setAdminToken(token)
      try { const m = await api('/api/me'); if (alive) setMe(m) } catch (e) { if (alive) { setToken(''); try { localStorage.removeItem(TOKEN_KEY) } catch (e2) {} } }
      if (alive) setReady(true)
    })()
    return () => { alive = false }
  }, [token])

  // 登录后轮询（独立 admin 认证面）
  useEffect(() => {
    if (!signedIn) return
    let stop = false
    const tick = async () => {
      try {
        const st = await api('/api/state')
        if (stop) return
        setMe(st.me); setWorkers(sortWorkers(st.workers || [])); setJobs(st.jobs || [])
        if (st.policy) setPolicy(st.policy)
      } catch (e) {}
    }
    tick()
    const iv = setInterval(tick, 1000)
    const lc = () => api('/api/contribution').then(c => { if (!stop) setContrib(c) }).catch(() => {})
    lc(); const cv = setInterval(lc, 5000)
    return () => { stop = true; clearInterval(iv); clearInterval(cv) }
  }, [signedIn])

  const login = useCallback(async password => {
    const r = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
    const t = await r.text(); let d = null; try { d = JSON.parse(t) } catch (e) {}
    if (!r.ok) throw (d && d.error) || t || ('HTTP ' + r.status)
    setAdminToken(d.token); setToken(d.token)
    try { localStorage.setItem(TOKEN_KEY, d.token) } catch (e) {}
    return d
  }, [])
  const logout = useCallback(async () => {
    try { await fetch(BASE + '/api/admin/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }) } catch (e) {}
    setAdminToken(''); setToken(''); setMe(null); setWorkers([]); setJobs([])
    try { localStorage.removeItem(TOKEN_KEY) } catch (e) {}
    location.hash = ''
  }, [token])

  const value = useMemo(() => ({
    ready, signedIn, me, policy, workers, jobs, contrib, advanced: false, setAdvanced: async () => false,
    target, setTarget, prefill, setPrefill, isPlatform: true, isAdminApp: true,
    toasts, toast, confirm, prompt, theme, setTheme, login, logout,
  }), [ready, signedIn, me, policy, workers, jobs, contrib, target, prefill, toasts, theme, toast, confirm, prompt, setTheme, login, logout])

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={'toast ' + t.kind}>
            <span className="t-ic">{{ ok: '✓', bad: '✕', warn: '!', info: 'i' }[t.kind] || 'i'}</span>
            <div>{t.title && <><b>{t.title}</b><br /></>}{t.msg}</div>
          </div>
        ))}
      </div>
      {dialog && <AdminDialog d={dialog} onClose={closeDialog} />}
    </AppCtx.Provider>
  )
}

function AdminDialog({ d, onClose }) {
  const [val, setVal] = useState(d.input || '')
  const ref = useRef(null)
  useEffect(() => { if (d.mode === 'input' && ref.current) { ref.current.focus(); ref.current.select() } }, [d])
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(d.mode === 'input' ? null : false) }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [d, onClose])
  const ok = () => onClose(d.mode === 'input' ? val : true)
  return (
    <div className="modal-mask on" onMouseDown={e => { if (e.target === e.currentTarget) onClose(d.mode === 'input' ? null : false) }}>
      <div className="modal sm" role="alertdialog" aria-modal="true">
        <div className="modal-head"><h2>{d.title}</h2></div>
        <div className="modal-body">
          <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--body)', whiteSpace: 'pre-wrap' }}>{d.body}</div>
          {d.mode === 'input' && <input ref={ref} style={{ marginTop: 12 }} value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ok() } }} />}
        </div>
        <div className="modal-foot">
          <button className="ghost" onClick={() => onClose(d.mode === 'input' ? null : false)}>取消</button>
          <button className="btn sm" onClick={ok}>确定</button>
        </div>
      </div>
    </div>
  )
}