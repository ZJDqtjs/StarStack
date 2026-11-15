import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../ctx'
import { Btn, Empty, Sheet } from '../ui'
import { f2, relTime } from '../../../shared/index.js'
import { parseIntent, MOBILE_ROUTES } from '../../../shared/agent.js'

// 试聊对话记录：浏览器本地持久化。键名与数据结构与 web-react / 内嵌原生版完全一致
// （ss-agent-chats-v1），WebView 壳与网页端互通同一份历史。
// { v:1, activeId, sessions:[{ id,title,model,msgs,createdAt,updatedAt }] }
// 时间戳为「秒」（可带小数以保序），可直接复用 shared/format.js 的 relTime()。
const STORE_KEY = 'ss-agent-chats-v1'
const MAX_SESSIONS = 50
const MAX_MSGS = 200
// /api/models/try 的服务端限制：最多 12 条、单条 2000 字、合计 8000 字、末条必须是 user
const CTX_MAX_MSGS = 12
const CTX_MAX_CHARS = 8000
const CTX_MAX_ONE = 2000

const SUGGEST = [
  '查看我的任务进度',
  '充值 100 点',
  '我的节点在线吗',
  '打开模型 API',
  '转码一个视频',
  '租一台云主机',
]

const now = () => Date.now() / 1000
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const newSession = (model: string) => ({ id: uid(), title: '新对话', model: model || '', msgs: [] as any[], createdAt: now(), updatedAt: now() })
const titleOf = (text: any) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s ? (s.length > 22 ? s.slice(0, 22) + '…' : s) : '新对话'
}
const summaryOf = (list: any[]) => {
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if ((m.role === 'user' || m.role === 'assistant') && m.content) {
      return (m.role === 'user' ? '我：' : '') + String(m.content).replace(/\s+/g, ' ')
    }
  }
  return '还没有消息'
}
// 长对话按后端上限裁剪后再发送，避免历史记录累积后试聊直接报错
const buildContext = (list: any[]) => {
  const arr = list
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, CTX_MAX_ONE) }))
  const out = arr.slice(-CTX_MAX_MSGS)
  while (out.length > 1 && out.reduce((n, m) => n + m.content.length, 0) > CTX_MAX_CHARS) out.shift()
  while (out.length && out[out.length - 1].role !== 'user') out.pop()
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}
const freshState = () => {
  const s = newSession('')
  return { v: 1, activeId: s.id, sessions: [s] as any[] }
}
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
    if (!raw || !Array.isArray(raw.sessions)) return freshState()
    const sessions = raw.sessions
      .filter((s: any) => s && typeof s.id === 'string' && Array.isArray(s.msgs))
      .slice(-MAX_SESSIONS)
      .map((s: any) => ({
        id: s.id, title: String(s.title || '新对话'), model: String(s.model || ''),
        msgs: s.msgs.slice(-MAX_MSGS),
        createdAt: Number(s.createdAt) || now(), updatedAt: Number(s.updatedAt) || now(),
      }))
    if (!sessions.length) return freshState()
    return { v: 1, activeId: sessions.some((s: any) => s.id === raw.activeId) ? raw.activeId : sessions[0].id, sessions }
  } catch (e) {
    return freshState()
  }
}
// 返回真正落盘的状态：配额不足时丢弃最旧的会话再试，避免「历史记录静默丢失」
function persist(st: any) {
  const write = (s: any) => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); return true } catch (e) { return false }
  }
  if (write(st)) return st
  let keep = st.sessions.slice().sort((a: any, b: any) => b.updatedAt - a.updatedAt)
  for (let n = 0; n < 3 && keep.length > 1; n++) {
    keep = keep.slice(0, Math.max(1, Math.floor(keep.length / 2)))
    const alt = { ...st, sessions: keep, activeId: keep.some((s: any) => s.id === st.activeId) ? st.activeId : keep[0].id }
    if (write(alt)) return alt
  }
  return st
}

// 切换 tab 会卸载组件：内存快照保证禁用 localStorage 时当前对话也不会丢
let CACHE: any = null

export default function AgentChat() {
  const { api, me, jobs, workers, setView, showToast, setPrefill } = useApp()
  const [state, setState] = useState(() => CACHE || loadState())
  const stateRef = useRef(state)
  const [input, setInput] = useState('')
  const [busyIds, setBusyIds] = useState<string[]>([])
  const [catalog, setCatalog] = useState<any[]>([])
  const [model, setModel] = useState(() => (state.sessions.find((s: any) => s.id === state.activeId) || {}).model || '')
  const [histOpen, setHistOpen] = useState(false)
  const defaultModelRef = useRef('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const { sessions, activeId } = state
  const active = sessions.find((s: any) => s.id === activeId) || sessions[0] || { msgs: [], title: '新对话' }
  const msgs = active.msgs
  const convo = msgs.length > 0
  const busy = busyIds.includes(activeId)
  const ordered = useMemo(() => sessions.slice().sort((a: any, b: any) => b.updatedAt - a.updatedAt), [sessions])

  // 所有写入都基于同步 ref，异步回调（确认框、模型请求）始终落到发起时的那条对话
  const commit = (fn: any) => {
    const draft = fn(stateRef.current)
    if (!draft || draft === stateRef.current) return
    const next = persist(draft)
    stateRef.current = next
    CACHE = next
    setState(next)
  }
  const updateSession = (sid: string, fn: any) =>
    commit((st: any) => {
      const i = st.sessions.findIndex((s: any) => s.id === sid)
      if (i < 0) return st
      const s = fn(st.sessions[i])
      if (!s) return st
      const next = st.sessions.slice()
      next[i] = s
      return { ...st, sessions: next }
    })
  const pushTo = (sid: string, m: any) =>
    updateSession(sid, (s: any) => ({
      ...s,
      msgs: [...s.msgs, m].slice(-MAX_MSGS),
      title: !s.msgs.length && m.role === 'user' ? titleOf(m.content) : s.title,
      updatedAt: now(),
    }))
  const markBusy = (sid: string, on: boolean) =>
    setBusyIds((prev) => (on ? (prev.includes(sid) ? prev : [...prev, sid]) : prev.filter((x) => x !== sid)))

  // 撑满视口、composer 沉底（与 web-react 同一策略）
  useEffect(() => {
    const fit = () => {
      const el = wrapRef.current
      if (!el) return
      if (!convo) { el.style.height = ''; return }
      const top = el.getBoundingClientRect().top
      el.style.height = Math.max(320, window.innerHeight - top - 16) + 'px'
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [convo, activeId])

  useEffect(() => {
    api.catalog().then((d: any) => {
      const c = d.models || []
      setCatalog(c)
      if (!c.length) return
      const def = (c.find((x: any) => x.official) || c[0]).id
      defaultModelRef.current = def
      const cur = stateRef.current
      const s = cur.sessions.find((x: any) => x.id === cur.activeId)
      const keep = s && c.some((x: any) => x.id === s.model) ? s.model : def
      setModel(keep)
      if (s && s.model !== keep) updateSession(cur.activeId, (x: any) => ({ ...x, model: keep }))
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [msgs, busy, activeId])

  const switchTo = (sid: string) => {
    if (sid === stateRef.current.activeId) return
    const s = stateRef.current.sessions.find((x: any) => x.id === sid)
    // 历史会话里记录的模型可能已下架，回落到当前目录里的官方模型
    const saved = (s && s.model) || ''
    const m = !catalog.length ? saved : catalog.some((c: any) => c.id === saved) ? saved : defaultModelRef.current
    commit((st: any) => ({ ...st, activeId: sid }))
    setModel(m)
    if (s && s.model !== m) updateSession(sid, (x: any) => ({ ...x, model: m }))
    setInput('')
    setHistOpen(false)
  }
  const newChat = () => {
    const st = stateRef.current
    const cur = st.sessions.find((s: any) => s.id === st.activeId)
    // 已经是空对话时直接复用，不产生一堆无意义的空记录
    if (cur && !cur.msgs.length) { setInput(''); setHistOpen(false); if (taRef.current) taRef.current.focus(); return }
    const s = newSession(model || defaultModelRef.current)
    commit((x: any) => ({ ...x, sessions: [...x.sessions, s].slice(-MAX_SESSIONS), activeId: s.id }))
    setInput('')
    setHistOpen(false)
    if (taRef.current) taRef.current.focus()
  }
  const clearChat = () => {
    if (!msgs.length) return
    if (!window.confirm('清空当前对话的全部消息？历史列表会保留这条对话。')) return
    updateSession(activeId, (s: any) => ({ ...s, msgs: [], title: '新对话', updatedAt: now() }))
  }
  const deleteChat = (sid: string) => {
    const target = stateRef.current.sessions.find((s: any) => s.id === sid)
    if (!window.confirm(`删除对话「${(target && target.title) || '新对话'}」？消息将无法恢复。`)) return
    const fallback = model || defaultModelRef.current
    commit((st: any) => {
      const left = st.sessions.filter((s: any) => s.id !== sid)
      if (!left.length) {
        const s = newSession(fallback)
        return { v: 1, activeId: s.id, sessions: [s] }
      }
      const nextActive = st.activeId === sid
        ? left.slice().sort((a: any, b: any) => b.updatedAt - a.updatedAt)[0].id
        : st.activeId
      return { ...st, sessions: left, activeId: nextActive }
    })
    const s = stateRef.current.sessions.find((x: any) => x.id === stateRef.current.activeId)
    setModel((s && s.model) || fallback)
  }

  const modelChat = async (sid: string, hist: any[], mdl: string) => {
    if (!mdl) { pushTo(sid, { role: 'error', content: '当前没有可用模型，请先在网页端「上游接入」登记一个 OpenAI 兼容上游。' }); return }
    markBusy(sid, true)
    try {
      const d = await api.tryChat(mdl, hist)
      const content = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content
      const usage = d.usage ? `输入 ${d.usage.prompt_tokens || 0} · 输出 ${d.usage.completion_tokens || 0} tokens` : ''
      pushTo(sid, { role: 'assistant', content: content || '（模型没有返回文本内容）', usage, model: mdl })
    } catch (err: any) {
      pushTo(sid, { role: 'error', content: String(err && err.message ? err.message : err) })
    } finally {
      markBusy(sid, false)
    }
  }

  const run = async (sid: string, text: string) => {
    const cur = stateRef.current.sessions.find((s: any) => s.id === sid)
    const hist = buildContext([...(cur ? cur.msgs : []), { role: 'user', content: text }])
    const mdl = model
    pushTo(sid, { role: 'user', content: text })
    const push = (m: any) => pushTo(sid, m)
    const pushAgent = (title: string, detail: string, extra?: any) => push({ role: 'agent', title, detail, ...(extra || {}) })
    const it: any = parseIntent(text, MOBILE_ROUTES)
    const titleOfView = (v: string) => (MOBILE_ROUTES.titles as any)[v] || v
    switch (it.type) {
      case 'nav':
        pushAgent('导航', `已打开「${titleOfView(it.view)}」`, { view: it.view })
        setView(it.view); return
      case 'image':
      case 'video': {
        const label = it.type === 'image' ? '生图' : '生视频'
        pushAgent(label, `${label}工作台目前只在星舷网页端提供；已记下你的描述，到网页端继续创作。`, { detail2: it.prompt })
        return
      }
      case 'render':
        setPrefill({ view: 'render', tpl: {}, kind: it.kind })
        setView('render')
        pushAgent('渲染', `已打开渲染工作台（${it.kind === 'blender' ? 'Blender' : '视频转码'}），上传素材即可提交`, { view: 'render' })
        return
      case 'build':
        setView('build')
        pushAgent('编排', '已打开任务编排，上传源码 zip 并填写命令即可提交', { view: 'build' })
        return
      case 'marketSearch':
        setView('market')
        pushAgent('搜索', `已打开算力市场（关键词「${it.q || '全部'}」；按关键词筛选能力档位请用网页端服务市场）`, { view: 'market' })
        return
      case 'vmRent':
        setView('vm')
        pushAgent('云主机', '已打开云主机列表，选择配置即可下单', { view: 'vm' })
        return
      case 'sellPublish':
        pushAgent('发布', '服务挂牌发布目前只在星舷网页端提供。')
        return
      case 'forumPost':
        setPrefill({ view: 'forum', tpl: { title: it.title } })
        setView('forum')
        pushAgent('发帖', '已打开论坛并预填标题，补充正文后即可发布', { view: 'forum' })
        return
      case 'createKey': {
        if (!window.confirm(`创建 API Key「${it.name || '默认密钥'}」？密钥只显示一次。`)) { pushAgent('已取消', '未创建密钥'); return }
        try {
          const d = await api.createKey(it.name || '默认密钥', 0)
          pushAgent('密钥已创建', '请立即复制保存（仅显示一次）', { secret: d.key })
          showToast('API Key 已创建', 'ok')
        } catch (e: any) { push({ role: 'error', content: '创建失败：' + (e.message || e) }) }
        return
      }
      case 'recharge': {
        if (!window.confirm(`充值 ${f2(it.amount)} 算力点？`)) { pushAgent('已取消', '未充值'); return }
        try {
          await api.recharge(it.amount)
          pushAgent('充值成功', `已充值 ${f2(it.amount)} 算力点`)
        } catch (e: any) { push({ role: 'error', content: '充值失败：' + (e.message || e) }) }
        return
      }
      case 'balance':
        pushAgent('余额', `当前账户余额 ${f2(me ? me.credits : 0)} 算力点`, { view: 'bill' }); return
      case 'tasks': {
        const running = jobs.filter((j: any) => ['queued', 'running', 'pending', 'leased', 'fetching', 'uploading', 'merging'].includes(j.status)).length
        const done = jobs.filter((j: any) => j.status === 'done').length
        const failed = jobs.filter((j: any) => j.status === 'failed').length
        pushAgent('任务概览', `共 ${jobs.length} 个任务：进行中 ${running} · 完成 ${done} · 失败 ${failed}`, { view: 'jobs' }); return
      }
      case 'nodes': {
        const mine = workers.filter((w: any) => w.mine)
        const on = mine.filter((w: any) => w.online).length
        const earn = mine.reduce((a: number, w: any) => a + Number(w.earned || 0), 0)
        pushAgent('节点概览', `我的节点 ${mine.length} 台，在线 ${on} 台，累计贡献 ${f2(earn)} 点`, { view: 'nodes' }); return
      }
      default:
        await modelChat(sid, hist, mdl)
    }
  }
  const submit = (e: any) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    run(activeId, text)
  }

  return (
    <div className="agent-wrap" ref={wrapRef}>
      <div className="agent-head">
        <div className="agent-head-title">
          <b title={active.title}>{active.title}</b>
          <span>{msgs.length} 条消息{active.model ? ` · ${active.model}` : ''}</span>
        </div>
        <div className="agent-head-btns">
          <Btn variant="ghost" tiny onClick={() => setHistOpen(true)}>历史 {sessions.length}</Btn>
          <Btn variant="ghost" tiny onClick={newChat}>新对话</Btn>
        </div>
      </div>
      {convo ? (
        <div className="agent-msgs" ref={listRef}>
          {msgs.map((m: any, i: number) => {
            if (m.role === 'user') return <div key={i} className="bubble me"><span className="who">我</span>{m.content}</div>
            if (m.role === 'assistant') return <div key={i} className="bubble"><span className="who">{m.model || model || '模型'}</span>{m.content}{m.usage && <span className="usage">{m.usage}</span>}</div>
            if (m.role === 'error') return <div key={i} className="bubble bad"><span className="who">提示</span>{m.content}</div>
            return (
              <div key={i} className="agent-card">
                <div className="agent-card-main">
                  <b>{m.title}</b>
                  <span>{m.detail}</span>
                  {m.detail2 && <code>{m.detail2}</code>}
                  {m.secret && <pre className="code">{m.secret}</pre>}
                </div>
                {m.view && <Btn variant="ghost" tiny onClick={() => setView(m.view)}>打开</Btn>}
              </div>
            )
          })}
          {busy && <div className="bubble"><span className="who">agent</span>正在执行…</div>}
        </div>
      ) : (
        <div className="agent-hero">
          <span className="wb-eyebrow">Starstack Agent</span>
          <h2>一句话，直达你想做的事</h2>
          <p>输入自然语言指令：导航到任意界面、查余额/任务/节点、充值、创建密钥、打开渲染与编排；识别不了时自动回落模型对话。</p>
          <div className="chips sm">
            {SUGGEST.map((s) => (
              <button key={s} type="button" className="tag" onClick={() => { setInput(s); if (taRef.current) taRef.current.focus() }}>{s}</button>
            ))}
          </div>
        </div>
      )}
      <form className="agent-composer" onSubmit={submit}>
        <textarea ref={taRef} rows={convo ? 2 : 3} maxLength={CTX_MAX_ONE} value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="一句话下达指令，例如：查看我的任务 / 充值 100 点；也可以直接提问模型"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e) } }} />
        <div className="agent-composer-row">
          <select value={model} onChange={(e) => {
            const v = e.target.value
            setModel(v)
            updateSession(activeId, (s: any) => ({ ...s, model: v }))
          }}>
            {catalog.length ? catalog.map((m: any) => <option key={m.id} value={m.id}>{m.id}</option>) : <option value="">（无可用模型）</option>}
          </select>
          <Btn variant="ghost" tiny onClick={clearChat} disabled={!msgs.length}>清空</Btn>
          <Btn onClick={submit as any} disabled={busy || !input.trim()}>{busy ? '执行中…' : '发送'}</Btn>
        </div>
      </form>

      <Sheet open={histOpen} title="历史对话" onClose={() => setHistOpen(false)}>
        <div className="agent-hist">
          <div className="btnrow"><Btn block onClick={newChat}>新建对话</Btn></div>
          {ordered.length === 1 && !ordered[0].msgs.length ? (
            <Empty>还没有历史对话，发第一条消息后会自动保存。</Empty>
          ) : (
            <div className="list">
              {ordered.map((s: any) => (
                <div key={s.id} className={'listrow' + (s.id === activeId ? ' on' : '')} onClick={() => switchTo(s.id)}>
                  <div className="grow">
                    <div className="name">{s.title}</div>
                    <div className="meta">{summaryOf(s.msgs)}</div>
                  </div>
                  <div className="meta" style={{ flex: '0 0 auto' }}>{relTime(s.updatedAt)}</div>
                  <Btn variant="ghost" tiny onClick={(e: any) => { e.stopPropagation(); deleteChat(s.id) }}>删除</Btn>
                </div>
              ))}
            </div>
          )}
          <div className="hint">对话记录保存在本机；长对话自动裁剪为最近 {CTX_MAX_MSGS} 条上下文。</div>
        </div>
      </Sheet>
    </div>
  )
}
