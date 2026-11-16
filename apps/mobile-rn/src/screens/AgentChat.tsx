import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from '../api'
import { f2, relTime } from '../api/format'
import { useApp, type Route } from '../ctx'
import { parseIntent, VIEW_TITLE } from '../agent'
import { Btn, Card, Chip, Empty, Icon, Badge, Sheet } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'

// 与 web-react / 原生内嵌版 / 小程序共用同一套本地存储结构：
// { v:1, activeId, sessions:[{ id,title,model,msgs,createdAt,updatedAt }] }
const STORE_KEY = 'ss-agent-chats-v1'
const MAX_SESSIONS = 50
const MAX_MSGS = 200
// /api/models/try 的服务端限制：最多 12 条、单条 2000 字、合计 8000 字、末条必须是 user
const CTX_MAX_MSGS = 12
const CTX_MAX_CHARS = 8000
const CTX_MAX_ONE = 2000

const SUGGEST = ['查看我的任务进度', '充值 100 点', '我的节点在线吗', '打开算力市场', '创建一个 API Key']

type ChatMsg = {
  role: 'user' | 'assistant' | 'error' | 'agent'
  content?: string
  usage?: string
  model?: string
  title?: string
  detail?: string
  detail2?: string
  secret?: string
  view?: string
}

type Session = {
  id: string
  title: string
  model: string
  msgs: ChatMsg[]
  createdAt: number
  updatedAt: number
}

type State = { v: 1; activeId: string; sessions: Session[] }

const now = () => Date.now() / 1000
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const newSession = (model?: string): Session => ({
  id: uid(),
  title: '新对话',
  model: model || '',
  msgs: [],
  createdAt: now(),
  updatedAt: now(),
})
const freshState = (model?: string): State => {
  const s = newSession(model)
  return { v: 1, activeId: s.id, sessions: [s] }
}
const titleOf = (text: string) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s ? (s.length > 22 ? s.slice(0, 22) + '…' : s) : '新对话'
}
const summaryOf = (list: ChatMsg[]) => {
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if ((m.role === 'user' || m.role === 'assistant') && m.content) {
      return (m.role === 'user' ? '我：' : '') + String(m.content).replace(/\s+/g, ' ')
    }
  }
  return '还没有消息'
}
const buildContext = (list: ChatMsg[]) => {
  const arr = list
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, CTX_MAX_ONE) }))
  const out = arr.slice(-CTX_MAX_MSGS)
  while (out.length > 1 && out.reduce((n, m) => n + m.content.length, 0) > CTX_MAX_CHARS) out.shift()
  while (out.length && out[out.length - 1].role !== 'user') out.pop()
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

function sanitize(raw: any): State {
  if (!raw || !Array.isArray(raw.sessions)) return freshState()
  const sessions: Session[] = raw.sessions
    .filter((s: any) => s && typeof s.id === 'string' && Array.isArray(s.msgs))
    .slice(-MAX_SESSIONS)
    .map((s: any) => ({
      id: s.id,
      title: String(s.title || '新对话'),
      model: String(s.model || ''),
      msgs: s.msgs.slice(-MAX_MSGS),
      createdAt: Number(s.createdAt) || now(),
      updatedAt: Number(s.updatedAt) || now(),
    }))
  if (!sessions.length) return freshState()
  return {
    v: 1,
    activeId: sessions.some((s) => s.id === raw.activeId) ? raw.activeId : sessions[0].id,
    sessions,
  }
}

const confirm = (title: string, message: string, okText = '确定') =>
  new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { text: '取消', style: 'cancel', onPress: () => resolve(false) },
      { text: okText, onPress: () => resolve(true) },
    ])
  })

export default function AgentChat() {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const [state, setState] = useState<State>(() => freshState())
  const stateRef = useRef(state)
  const [booting, setBooting] = useState(true)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [catalog, setCatalog] = useState<any[]>([])
  const [model, setModel] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [histOpen, setHistOpen] = useState(false)
  const listRef = useRef<any>(null)

  const sessions = state.sessions
  const active = sessions.find((s) => s.id === state.activeId) || sessions[0]
  const msgs = active ? active.msgs : []
  const ordered = useMemo(() => sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt), [sessions])
  const defaultModelRef = useRef('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const raw = JSON.parse((await AsyncStorage.getItem(STORE_KEY)) || 'null')
        if (alive) {
          const st = sanitize(raw)
          stateRef.current = st
          setState(st)
          const cur = st.sessions.find((x) => x.id === st.activeId)
          setModel(cur?.model || '')
        }
      } catch {
        // 本地记录损坏时从空对话开始，不阻塞页面
      } finally {
        if (alive) setBooting(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    api
      .catalog()
      .then((d) => {
        const list = Array.isArray(d?.models) ? d.models : []
        setCatalog(list)
        if (!list.length) return
        const def = (list.find((x: any) => x.official) || list[0]).id
        defaultModelRef.current = def
        const cur = stateRef.current.sessions.find((x) => x.id === stateRef.current.activeId)
        const keep = cur && list.some((x: any) => x.id === cur.model) ? cur.model : def
        setModel(keep)
        if (cur && cur.model !== keep) updateSession(cur.id, (x) => ({ ...x, model: keep }))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60)
    return () => clearTimeout(t)
  }, [msgs.length, busy, state.activeId])

  const persist = (st: State) => {
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(st)).catch(() => {
      // 配额不足时丢弃最旧的会话再写一次，避免历史记录静默丢失
      const keep = st.sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.max(1, Math.floor(st.sessions.length / 2)))
      const alt = { ...st, sessions: keep, activeId: keep.some((s) => s.id === st.activeId) ? st.activeId : keep[0].id }
      AsyncStorage.setItem(STORE_KEY, JSON.stringify(alt)).catch(() => {})
    })
  }

  const commit = (fn: (st: State) => State) => {
    const draft = fn(stateRef.current)
    if (!draft || draft === stateRef.current) return
    stateRef.current = draft
    persist(draft)
    setState(draft)
  }

  const updateSession = (sid: string, fn: (s: Session) => Session) => {
    commit((st) => {
      const i = st.sessions.findIndex((s) => s.id === sid)
      if (i < 0) return st
      const next = st.sessions.slice()
      next[i] = fn(st.sessions[i])
      return { ...st, sessions: next }
    })
  }

  const pushTo = (sid: string, m: ChatMsg) => {
    updateSession(sid, (s) => ({
      ...s,
      msgs: [...s.msgs, m].slice(-MAX_MSGS),
      title: !s.msgs.length && m.role === 'user' ? titleOf(m.content || '') : s.title,
      updatedAt: now(),
    }))
  }

  const pushAgent = (sid: string, title: string, detail: string, extra?: Partial<ChatMsg>) => {
    pushTo(sid, { role: 'agent', title, detail, ...extra })
  }

  const switchTo = (sid: string) => {
    const st = stateRef.current
    if (sid === st.activeId) {
      setHistOpen(false)
      return
    }
    const target = st.sessions.find((s) => s.id === sid)
    commit((x) => ({ ...x, activeId: sid }))
    const saved = target?.model || ''
    const keep = !catalog.length ? saved : catalog.some((x) => x.id === saved) ? saved : defaultModelRef.current
    setModel(keep)
    if (target && target.model !== keep) updateSession(sid, (x) => ({ ...x, model: keep }))
    setInput('')
    setHistOpen(false)
  }

  const newChat = () => {
    const st = stateRef.current
    const cur = st.sessions.find((s) => s.id === st.activeId)
    if (cur && !cur.msgs.length) {
      setHistOpen(false)
      setInput('')
      return
    }
    const s = newSession(model || defaultModelRef.current)
    commit((x) => ({ ...x, sessions: [...x.sessions, s].slice(-MAX_SESSIONS), activeId: s.id }))
    setInput('')
    setHistOpen(false)
  }

  const clearChat = async () => {
    if (!msgs.length) return
    if (!(await confirm('清空对话', '清空当前对话的全部消息？历史列表会保留这条对话。'))) return
    updateSession(stateRef.current.activeId, (s) => ({ ...s, msgs: [], title: '新对话', updatedAt: now() }))
  }

  const deleteChat = async (sid: string) => {
    const target = stateRef.current.sessions.find((s) => s.id === sid)
    if (!(await confirm('删除对话', `删除对话「${target?.title || '新对话'}」？消息将无法恢复。`, '删除'))) return
    const fallback = model || defaultModelRef.current
    commit((st) => {
      const left = st.sessions.filter((s) => s.id !== sid)
      if (!left.length) {
        const s = newSession(fallback)
        return { v: 1 as const, activeId: s.id, sessions: [s] }
      }
      const activeId = st.activeId === sid ? left.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0].id : st.activeId
      return { ...st, sessions: left, activeId }
    })
  }

  const modelChat = async (sid: string, hist: { role: string; content: string }[], mdl: string) => {
    if (!mdl) {
      pushTo(sid, { role: 'error', content: '当前没有可用模型，请先在「上游接入」登记一个 OpenAI 兼容上游。' })
      return
    }
    setBusy(true)
    try {
      const d: any = await api.tryChat(mdl, hist)
      const content = d?.choices?.[0]?.message?.content
      const usage = d?.usage ? `输入 ${d.usage.prompt_tokens || 0} · 输出 ${d.usage.completion_tokens || 0} tokens` : ''
      pushTo(sid, { role: 'assistant', content: content || '（模型没有返回文本内容）', usage, model: mdl })
    } catch (e: any) {
      pushTo(sid, { role: 'error', content: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  const run = async (sid: string, text: string) => {
    const cur = stateRef.current.sessions.find((s) => s.id === sid)
    const hist = buildContext([...(cur ? cur.msgs : []), { role: 'user', content: text }])
    const mdl = model
    pushTo(sid, { role: 'user', content: text })
    const it = parseIntent(text)

    try {
      switch (it.type) {
        case 'nav': {
          pushAgent(sid, '导航', `已打开「${VIEW_TITLE[it.view] || it.view}」`, { view: it.view })
          app.nav(it.view as Route, it.tab ? { tab: it.tab } : undefined)
          return
        }
        case 'image':
        case 'video': {
          pushAgent(
            sid,
            it.type === 'image' ? '生图' : '生视频',
            'Android 原生端暂不内置 ComfyUI 工作台；描述已记录，请到星舷网页端完成生成。',
            { detail2: it.prompt },
          )
          return
        }
        case 'render': {
          pushAgent(sid, '渲染', `已打开创作工作台（${it.kind === 'blender' ? 'Blender' : '视频转码'}），选择素材即可提交`, {
            view: 'create',
          })
          app.nav('create', { kind: it.kind })
          return
        }
        case 'build': {
          pushAgent(sid, '编排', '已打开创作工作台（编译打包），上传源码 zip 并填写命令即可提交', { view: 'create' })
          app.nav('create', { kind: 'build' })
          return
        }
        case 'marketSearch': {
          pushAgent(sid, '搜索', `已在服务市场搜索「${it.q || '全部'}」`, { view: 'market' })
          app.nav('market', { q: it.q })
          return
        }
        case 'vmRent': {
          pushAgent(sid, '云主机', '已打开云主机租用列表，选择配置即可下单', { view: 'market' })
          app.nav('market', { tab: 'vm' })
          return
        }
        case 'sellPublish': {
          pushAgent(sid, '发布', `已打开我的发布${it.title ? `，标题已记录：${it.title}` : ''}`, { view: 'sell' })
          app.nav('sell')
          return
        }
        case 'forumPost': {
          pushAgent(sid, '发帖', `已打开论坛${it.title ? `，标题已记录：${it.title}` : ''}`, { view: 'forum' })
          app.nav('forum')
          return
        }
        case 'createKey': {
          if (!(await confirm('创建 API Key', `创建「${it.name || '默认密钥'}」？密钥只显示一次。`))) {
            pushAgent(sid, '已取消', '未创建密钥')
            return
          }
          const d: any = await api.createKey(it.name || '默认密钥', 0)
          pushAgent(sid, '密钥已创建', '请立即复制保存（仅显示一次）', { secret: d?.key })
          return
        }
        case 'recharge': {
          if (!(await confirm('充值', `充值 ${f2(it.amount)} 算力点？`))) {
            pushAgent(sid, '已取消', '未充值')
            return
          }
          await api.recharge(it.amount)
          pushAgent(sid, '充值成功', `已充值 ${f2(it.amount)} 算力点`)
          return
        }
        case 'balance': {
          pushAgent(sid, '余额', `当前账户余额 ${f2(app.me?.credits)} 算力点`, { view: 'wallet' })
          return
        }
        case 'tasks': {
          const jobs = app.jobs || []
          const running = jobs.filter((j: any) => ['queued', 'running', 'pending'].includes(j.status)).length
          const done = jobs.filter((j: any) => j.status === 'done').length
          const failed = jobs.filter((j: any) => j.status === 'failed').length
          pushAgent(sid, '任务概览', `共 ${jobs.length} 个任务：进行中 ${running} · 完成 ${done} · 失败 ${failed}`, {
            view: 'jobs',
          })
          return
        }
        case 'nodes': {
          const mine = (app.workers || []).filter((w: any) => w.mine)
          const on = mine.filter((w: any) => w.online).length
          const earn = mine.reduce((a: number, w: any) => a + Number(w.earned || 0), 0)
          pushAgent(sid, '节点概览', `我的节点 ${mine.length} 台，在线 ${on} 台，累计贡献 ${f2(earn)} 点`, {
            view: 'nodes',
          })
          return
        }
        default:
          await modelChat(sid, hist, mdl)
      }
    } catch (e: any) {
      pushTo(sid, { role: 'error', content: String(e?.message || e) })
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    await run(stateRef.current.activeId, text)
  }

  if (booting) {
    return (
      <View style={s.center}>
        <Text style={s.hint}>正在读取历史对话…</Text>
      </View>
    )
  }

  return (
    <View style={s.root}>
      <View style={s.head}>
        <Btn title="历史" kind="ghost" size="xs" icon="messages" onPress={() => setHistOpen(true)} />
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{active?.title || '新对话'}</Text>
          <Text style={s.meta} numberOfLines={1}>
            {msgs.length} 条消息{model ? ` · ${model}` : ''}
          </Text>
        </View>
        <Btn title="新对话" kind="soft" size="xs" icon="plus" onPress={newChat} />
      </View>

      <ScrollView
        ref={listRef}
        style={{ flex: 1 }}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      >
        {msgs.length ? (
          msgs.map((m, i) => {
            if (m.role === 'user') {
              return (
                <View key={i} style={[s.bubble, s.me]}>
                  <Text style={[s.who, { color: c.accentInk, opacity: 0.75 }]}>我</Text>
                  <Text selectable style={[s.body, { color: c.accentInk }]}>{m.content}</Text>
                </View>
              )
            }
            if (m.role === 'assistant') {
              return (
                <View key={i} style={[s.bubble, s.bot]}>
                  <Text style={s.who}>{m.model || model || '模型'}</Text>
                  <Text selectable style={s.body}>{m.content}</Text>
                  {m.usage ? <Text style={s.usage}>{m.usage}</Text> : null}
                </View>
              )
            }
            if (m.role === 'error') {
              return (
                <View key={i} style={[s.bubble, s.err]}>
                  <Text style={[s.who, { color: c.bad }]}>提示</Text>
                  <Text selectable style={s.body}>{m.content}</Text>
                </View>
              )
            }
            return (
              <View key={i} style={s.agentCard}>
                <View style={s.agentIcon}>
                  <Icon name="build" size={14} color={c.accent} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.agentTitle}>{m.title}</Text>
                  <Text style={s.agentDetail}>{m.detail}</Text>
                  {m.detail2 ? <Text selectable style={s.quote}>{m.detail2}</Text> : null}
                  {m.secret ? (
                    <Pressable onPress={() => Alert.alert('密钥只显示一次', m.secret)}>
                      <Text selectable style={s.secret}>{m.secret}</Text>
                    </Pressable>
                  ) : null}
                </View>
                {m.view ? <Btn title="打开" kind="ghost" size="xs" onPress={() => app.nav(m.view as Route)} /> : null}
              </View>
            )
          })
        ) : (
          <View style={s.hero}>
            <Badge text="Starstack Agent" tone="accent" />
            <Text style={s.heroTitle}>一句话，直达你想做的事</Text>
            <Text style={s.heroText}>
              输入自然语言指令：查任务、查余额、充值、创建密钥、打开任意页面；识别不了时自动回落模型对话。
            </Text>
            <View style={s.chips}>
              {SUGGEST.map((t) => (
                <Chip key={t} label={t} onPress={() => setInput(t)} />
              ))}
            </View>
            <Text style={s.hint}>
              对话记录仅保存在本机（与网页端同一个键）；长对话自动裁剪为最近 {CTX_MAX_MSGS} 条上下文。
            </Text>
          </View>
        )}
        {busy ? (
          <View style={[s.bubble, s.bot]}>
            <Text style={s.who}>星舷助手</Text>
            <Text style={s.body}>正在执行…</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={s.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="一句话下达指令，例如：查看我的任务 / 充值 100 点"
          placeholderTextColor={c.faint}
          style={s.input}
          multiline
          maxLength={CTX_MAX_ONE}
          textAlignVertical="top"
        />
        <View style={s.composerRow}>
          <Pressable onPress={() => setModelOpen(true)} style={s.modelBtn}>
            <Icon name="api" size={12} color={c.mute} />
            <Text style={s.modelText} numberOfLines={1}>{model || '（无可用模型）'}</Text>
          </Pressable>
          <Btn title="清空" kind="ghost" size="xs" onPress={clearChat} />
          <Btn title={busy ? '执行中…' : '发送'} size="sm" onPress={send} loading={busy} disabled={!input.trim()} style={{ flex: 1 }} />
        </View>
      </View>

      <Sheet open={histOpen} onClose={() => setHistOpen(false)} title="历史对话">
        <Btn title="新建对话" icon="plus" onPress={newChat} block />
        {ordered.length ? (
          ordered.map((s0) => (
            <Pressable
              key={s0.id}
              onPress={() => switchTo(s0.id)}
              style={[s.histRow, s0.id === state.activeId && { borderColor: c.accent }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.histTitle} numberOfLines={1}>{s0.title}</Text>
                <Text style={s.histLast} numberOfLines={1}>{summaryOf(s0.msgs)}</Text>
              </View>
              <Text style={s.histTime}>{relTime(s0.updatedAt)}</Text>
              <Btn title="删除" kind="ghost" size="xs" onPress={() => deleteChat(s0.id)} />
            </Pressable>
          ))
        ) : (
          <Empty text="还没有历史对话" icon="messages" />
        )}
      </Sheet>

      <Sheet open={modelOpen} onClose={() => setModelOpen(false)} title="回落模型">
        {catalog.length ? (
          catalog.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => {
                setModel(m.id)
                updateSession(stateRef.current.activeId, (x) => ({ ...x, model: m.id }))
                setModelOpen(false)
              }}
              style={[s.modelRow, m.id === model && { borderColor: c.accent }]}
            >
              <Text style={[s.modelRowText, m.id === model && { color: c.accent, fontWeight: '600' }]} numberOfLines={1}>
                {m.id}
              </Text>
              {m.official ? <Badge text="官方" tone="accent" /> : null}
            </Pressable>
          ))
        ) : (
          <Empty text="还没有可用模型，请先登记上游" icon="api" />
        )}
      </Sheet>
    </View>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.hair,
      backgroundColor: c.surface,
    },
    title: { fontSize: 13.5, fontWeight: '700', color: c.ink },
    meta: { fontSize: 9.5, color: c.faint, marginTop: 1 },
    list: { padding: 12, gap: 9, paddingBottom: 18 },
    bubble: { borderRadius: 12, padding: 10, gap: 3, maxWidth: '92%' },
    me: { alignSelf: 'flex-end', backgroundColor: c.accent },
    bot: { alignSelf: 'flex-start', backgroundColor: c.soft },
    err: { alignSelf: 'flex-start', backgroundColor: c.badSoft },
    who: { fontSize: 9, color: c.faint, fontWeight: '600' },
    body: { fontSize: 12.5, lineHeight: 19, color: c.ink },
    usage: { fontSize: 9, color: c.faint, marginTop: 2 },
    agentCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 9,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hair,
      borderRadius: 12,
      padding: 10,
    },
    agentIcon: {
      width: 26,
      height: 26,
      borderRadius: 8,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    agentTitle: { fontSize: 12, fontWeight: '600', color: c.ink },
    agentDetail: { fontSize: 11, lineHeight: 16, color: c.mute },
    quote: { fontSize: 11, color: c.body, backgroundColor: c.inset, borderRadius: 6, padding: 6 },
    secret: { fontSize: 10.5, color: c.accent, backgroundColor: c.accentSoft, borderRadius: 6, padding: 6 },
    hero: { alignItems: 'flex-start', gap: 8, paddingVertical: 10 },
    heroTitle: { fontSize: 20, fontWeight: '700', color: c.ink, lineHeight: 27 },
    heroText: { fontSize: 12, lineHeight: 18, color: c.mute },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 4 },
    hint: { fontSize: 10, lineHeight: 15, color: c.faint },
    composer: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hair,
      backgroundColor: c.surface,
      padding: 10,
      gap: 8,
    },
    input: {
      minHeight: 46,
      maxHeight: 120,
      borderRadius: 10,
      backgroundColor: c.soft,
      color: c.ink,
      paddingHorizontal: 11,
      paddingVertical: 9,
      fontSize: 13,
    },
    composerRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    modelBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      maxWidth: '44%',
      borderRadius: 999,
      backgroundColor: c.soft,
      paddingHorizontal: 9,
      paddingVertical: 6,
    },
    modelText: { fontSize: 10, color: c.mute, flexShrink: 1 },
    histRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hair,
      borderRadius: 10,
      padding: 9,
    },
    histTitle: { fontSize: 12.5, fontWeight: '600', color: c.ink },
    histLast: { fontSize: 10, color: c.mute, marginTop: 2 },
    histTime: { fontSize: 9, color: c.faint },
    modelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hair,
      borderRadius: 9,
      padding: 10,
    },
    modelRowText: { fontSize: 12, color: c.ink, flex: 1 },
  })
