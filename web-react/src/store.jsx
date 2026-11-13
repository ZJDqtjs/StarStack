import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, post } from './api.js'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

const sortWorkers = ws => ws.slice().sort((a, b) =>
  (b.online - a.online) || (b.mine - a.mine) ||
  String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh-CN'))

let toastSeq = 0
export function AppProvider({ children }) {
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [me, setMe] = useState(null)
  const [policy, setPolicy] = useState(null)
  const [workers, setWorkers] = useState([])
  const [jobs, setJobs] = useState([])
  const [contrib, setContrib] = useState(null)
  const [advanced, setAdv] = useState(false)
  const [target, setTarget] = useState(null)
  const [prefill, setPrefill] = useState(null)
  const [toasts, setToasts] = useState([])
  const [dialog, setDialog] = useState(null)
  const [theme, setThemeState] = useState(() => document.documentElement.dataset.theme || 'light')

  const toast = useCallback((msg, kind = 'info', title) => {
    const id = ++toastSeq
    setToasts(t => [...t, { id, msg, kind, title }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200)
  }, [])

  const confirm = useCallback((body, title = '请确认') =>
    new Promise(res => setDialog({ mode: 'confirm', title, body, resolve: res })), [])
  const prompt = useCallback((body, def = '', title = '输入') =>
    new Promise(res => setDialog({ mode: 'input', title, body, input: String(def), resolve: res })), [])
  const closeDialog = useCallback(val => {
    setDialog(d => { if (d) d.resolve(val); return null })
  }, [])

  const setTheme = useCallback(t => {
    document.documentElement.dataset.theme = t
    try { localStorage.setItem('ss-theme', t) } catch (e) {}
    setThemeState(t)
  }, [])

  // 启动：匿名取 policy，再判登录
  useEffect(() => {
    let alive = true
    ;(async () => {
      try { const st = await api('/api/state'); if (alive) setPolicy(st.policy || null) } catch (e) {}
      try { const m = await api('/api/me'); if (alive && m.signed_in) { setMe(m); setSignedIn(true) } } catch (e) {}
      if (alive) setReady(true)
    })()
    return () => { alive = false }
  }, [])

  // 登录后轮询 state（1s）与 contribution（5s）
  useEffect(() => {
    if (!signedIn) return
    let stop = false
    const tick = async () => {
      try {
        const st = await api('/api/state')
        if (stop) return
        if (!st.signed_in) { setSignedIn(false); setMe(null); return }
        setMe(st.me); setWorkers(sortWorkers(st.workers || [])); setJobs(st.jobs || [])
        if (st.policy) setPolicy(st.policy)
      } catch (e) {}
    }
    tick()
    const iv = setInterval(tick, 1000)
    const loadContrib = () => api('/api/contribution').then(c => { if (!stop) setContrib(c) }).catch(() => {})
    loadContrib()
    const cv = setInterval(loadContrib, 5000)
    api('/api/me/settings').then(s => { if (!stop) setAdv(!!s.advanced) }).catch(() => {})
    return () => { stop = true; clearInterval(iv); clearInterval(cv) }
  }, [signedIn])

  const login = useCallback(async (name, password, invite, mode) => {
    const payload = { name, password }
    if (mode === 'reg') payload.invite = invite
    const m = await post('/api/auth/' + (mode === 'reg' ? 'register' : 'login'), payload)
    setMe(m); setSignedIn(true)
    return m
  }, [])
  const logout = useCallback(async () => {
    try { await post('/api/auth/logout', {}) } catch (e) {}
    setSignedIn(false); setMe(null); setWorkers([]); setJobs([]); setContrib(null)
    location.hash = ''
  }, [])
  const setAdvanced = useCallback(async on => {
    const r = await api('/api/me/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ advanced: on }) })
    setAdv(!!r.advanced)
    return !!r.advanced
  }, [])

  const value = useMemo(() => ({
    ready, signedIn, me, policy, workers, jobs, contrib, advanced, target, setTarget, prefill, setPrefill,
    toasts, toast, confirm, prompt, theme, setTheme, login, logout, setAdvanced,
  }), [ready, signedIn, me, policy, workers, jobs, contrib, advanced, target, prefill, toasts, theme,
    toast, confirm, prompt, setTheme, login, logout, setAdvanced])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={'toast ' + t.kind}>
            <span className="t-ic">{{ ok: '✓', bad: '✕', warn: '!', info: 'i' }[t.kind] || 'i'}</span>
            <div>{t.title && <><b>{t.title}</b><br /></>}{t.msg}</div>
          </div>
        ))}
      </div>
      {dialog && <DialogBox d={dialog} onClose={closeDialog} />}
    </Ctx.Provider>
  )
}

function DialogBox({ d, onClose }) {
  const [val, setVal] = useState(d.input || '')
  const ref = useRef(null)
  useEffect(() => { if (d.mode === 'input' && ref.current) { ref.current.focus(); ref.current.select() } }, [d])
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(d.mode === 'input' ? null : false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [d, onClose])
  const ok = () => onClose(d.mode === 'input' ? val : true)
  return (
    <div className="modal-mask on" onMouseDown={e => { if (e.target === e.currentTarget) onClose(d.mode === 'input' ? null : false) }}>
      <div className="modal sm" role="alertdialog" aria-modal="true">
        <div className="modal-head"><h2>{d.title}</h2></div>
        <div className="modal-body">
          <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--body)', whiteSpace: 'pre-wrap' }}>{d.body}</div>
          {d.mode === 'input' && (
            <input ref={ref} style={{ marginTop: 12 }} value={val} onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ok() } }} />
          )}
        </div>
        <div className="modal-foot">
          <button className="ghost" onClick={() => onClose(d.mode === 'input' ? null : false)}>取消</button>
          <button className="btn sm" onClick={ok}>确定</button>
        </div>
      </div>
    </div>
  )
}