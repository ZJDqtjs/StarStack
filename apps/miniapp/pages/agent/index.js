// 星舷助手：与 web / 安卓 / 桌面 / 鸿蒙端同一套 Agent 意图规则（shared/agent.js），
// 识别不了的输入回落 /api/models/try 模型对话；历史对话本地存储，
// 键名与数据结构与 web-react（ss-agent-chats-v1）完全一致。
const { api, f2, relTime, parseIntent, MINIAPP_ROUTES } = require('../../utils/api.js')

const STORE_KEY = 'ss-agent-chats-v1'
const MAX_SESSIONS = 50
const MAX_MSGS = 200
// /api/models/try 的服务端限制：最多 12 条、单条 2000 字、合计 8000 字、末条必须是 user
const CTX_MAX_MSGS = 12
const CTX_MAX_CHARS = 8000
const CTX_MAX_ONE = 2000

const SUGGEST = ['查看我的任务进度', '充值 100 点', '我的节点在线吗', '打开算力市场']

const now = () => Date.now() / 1000
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const newSession = (model) => ({ id: uid(), title: '新对话', model: model || '', msgs: [], createdAt: now(), updatedAt: now() })
const titleOf = (text) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s ? (s.length > 22 ? s.slice(0, 22) + '…' : s) : '新对话'
}

// 长对话按后端上限裁剪后再发送，避免历史记录累积后试聊直接报错
const buildContext = (list) => {
  const arr = list
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, CTX_MAX_ONE) }))
  const out = arr.slice(-CTX_MAX_MSGS)
  while (out.length > 1 && out.reduce((n, m) => n + m.content.length, 0) > CTX_MAX_CHARS) out.shift()
  while (out.length && out[out.length - 1].role !== 'user') out.pop()
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

function freshState() {
  const s = newSession('')
  return { v: 1, activeId: s.id, sessions: [s] }
}

function loadState() {
  try {
    const raw = JSON.parse(wx.getStorageSync(STORE_KEY) || 'null')
    if (!raw || !Array.isArray(raw.sessions)) return freshState()
    const sessions = raw.sessions
      .filter((s) => s && typeof s.id === 'string' && Array.isArray(s.msgs))
      .slice(-MAX_SESSIONS)
      .map((s) => ({
        id: s.id,
        title: String(s.title || '新对话'),
        model: String(s.model || ''),
        msgs: s.msgs.slice(-MAX_MSGS),
        createdAt: Number(s.createdAt) || now(),
        updatedAt: Number(s.updatedAt) || now(),
      }))
    if (!sessions.length) return freshState()
    return { v: 1, activeId: sessions.some((s) => s.id === raw.activeId) ? raw.activeId : sessions[0].id, sessions }
  } catch (e) {
    return freshState()
  }
}

function persist(st) {
  try {
    wx.setStorageSync(STORE_KEY, JSON.stringify(st))
    return st
  } catch (e) {
    // 配额不足：按更新时间丢弃最旧的一半再试，最多两轮
    let keep = st.sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt)
    for (let n = 0; n < 2 && keep.length > 1; n++) {
      keep = keep.slice(0, Math.max(1, Math.floor(keep.length / 2)))
      const alt = { v: 1, activeId: keep.some((s) => s.id === st.activeId) ? st.activeId : keep[0].id, sessions: keep }
      try {
        wx.setStorageSync(STORE_KEY, JSON.stringify(alt))
        return alt
      } catch (e2) { /* continue */ }
    }
    return st
  }
}

// WXML 不能带函数调用：把消息预处理成渲染友好的视图模型
function viewModel(m) {
  const kind = m.role === 'user' ? 'me' : m.role === 'assistant' ? 'bot' : m.role === 'error' ? 'bad' : 'agent'
  return {
    kind,
    key: m.ts + '-' + kind,
    who: kind === 'me' ? '我' : kind === 'bot' ? (m.model || '模型') : kind === 'bad' ? '提示' : '星舷助手',
    content: m.content || '',
    usage: m.usage || '',
    title: m.title || '',
    detail: m.detail || '',
    detail2: m.detail2 || '',
    secret: m.secret || '',
    view: m.view || '',
  }
}

Page({
  data: {
    msgs: [],
    input: '',
    busy: false,
    showHist: false,
    hist: [],
    catalog: [],
    modelNames: [],
    modelIdx: 0,
    modelLabel: '',
    suggest: SUGGEST,
    scrollInto: '',
    booting: true,
  },

  onLoad() {
    this._state = loadState()
    this.refreshData()
    api
      .catalog()
      .then((d) => {
        const c = d.models || []
        this._catalog = c
        const def = c.length ? (c.find((x) => x.official) || c[0]).id : ''
        this.defaultModel = def
        const cur = this.activeSession()
        const keep = cur && c.some((x) => x.id === cur.model) ? cur.model : def
        if (cur && cur.model !== keep) this.updateSession(cur.id, (s) => Object.assign({}, s, { model: keep }))
        this.setData({
          catalog: c,
          modelNames: c.map((x) => x.id),
          modelIdx: Math.max(0, c.findIndex((x) => x.id === keep)),
          modelLabel: keep,
          booting: false,
        })
      })
      .catch(() => this.setData({ booting: false }))
  },

  onShow() {
    this.refreshData()
  },

  activeSession() {
    const st = this._state
    return st.sessions.find((s) => s.id === st.activeId) || st.sessions[0]
  },

  refreshData() {
    const st = this._state
    const act = this.activeSession()
    const ordered = st.sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt)
    this.setData({
      msgs: (act ? act.msgs : []).map(viewModel),
      hist: ordered.map((s) => ({
        id: s.id,
        title: s.title,
        time: relTime(s.updatedAt),
        last: this.summaryOf(s.msgs),
        on: s.id === st.activeId,
      })),
    })
    this.scrollToBottom()
  },

  summaryOf(list) {
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if ((m.role === 'user' || m.role === 'assistant') && m.content) {
        return (m.role === 'user' ? '我：' : '') + String(m.content).replace(/\s+/g, ' ')
      }
    }
    return '还没有消息'
  },

  scrollToBottom() {
    const msgs = this.data.msgs
    if (msgs.length) this.setData({ scrollInto: 'm-' + msgs[msgs.length - 1].key })
  },

  commit(fn) {
    const draft = fn(this._state)
    if (!draft || draft === this._state) return
    this._state = persist(draft)
    this.refreshData()
  },

  updateSession(sid, fn) {
    this.commit((st) => {
      const i = st.sessions.findIndex((s) => s.id === sid)
      if (i < 0) return st
      const next = st.sessions.slice()
      next[i] = fn(st.sessions[i])
      return Object.assign({}, st, { sessions: next })
    })
  },

  pushTo(sid, m) {
    this.updateSession(sid, (s) => ({
      ...s,
      msgs: [...s.msgs, { ...m, ts: Date.now() }].slice(-MAX_MSGS),
      title: !s.msgs.length && m.role === 'user' ? titleOf(m.content) : s.title,
      updatedAt: now(),
    }))
  },

  onInput(e) {
    this.setData({ input: e.detail.value })
  },

  onSuggest(e) {
    this.setData({ input: e.currentTarget.dataset.t })
  },

  toggleHist() {
    this.setData({ showHist: !this.data.showHist })
  },

  switchChat(e) {
    const sid = e.currentTarget.dataset.id
    const st = this._state
    if (sid === st.activeId) {
      this.setData({ showHist: false })
      return
    }
    const s = st.sessions.find((x) => x.id === sid)
    this.commit((x) => Object.assign({}, x, { activeId: sid }))
    const c = this._catalog || []
    const saved = (s && s.model) || ''
    const keep = !c.length ? saved : c.some((x) => x.id === saved) ? saved : this.defaultModel
    if (keep) {
      this.setData({ modelIdx: Math.max(0, c.findIndex((x) => x.id === keep)), modelLabel: keep })
      if (s && s.model !== keep) this.updateSession(sid, (x) => Object.assign({}, x, { model: keep }))
    }
    this.setData({ showHist: false })
  },

  newChat() {
    const st = this._state
    const cur = st.sessions.find((s) => s.id === st.activeId)
    if (cur && !cur.msgs.length) {
      this.setData({ showHist: false })
      return
    }
    const model = (this._catalog || [])[this.data.modelIdx]
    const s = newSession(model ? model.id : this.defaultModel || '')
    this.commit((x) => ({ v: 1, activeId: s.id, sessions: [...x.sessions, s].slice(-MAX_SESSIONS) }))
    this.setData({ showHist: false, input: '' })
  },

  deleteChat(e) {
    const sid = e.currentTarget.dataset.id
    const st = this._state
    const target = st.sessions.find((s) => s.id === sid)
    wx.showModal({
      title: '删除对话',
      content: `删除对话「${(target && target.title) || '新对话'}」？消息将无法恢复。`,
      success: (r) => {
        if (!r.confirm) return
        this.commit((x) => {
          const left = x.sessions.filter((s) => s.id !== sid)
          if (!left.length) {
            const s = newSession(this.defaultModel || '')
            return { v: 1, activeId: s.id, sessions: [s] }
          }
          const activeId = x.activeId === sid ? left.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0].id : x.activeId
          return Object.assign({}, x, { sessions: left, activeId })
        })
      },
    })
  },

  clearChat() {
    if (!this.data.msgs.length) return
    wx.showModal({
      title: '清空对话',
      content: '清空当前对话的全部消息？历史列表会保留这条对话。',
      success: (r) => {
        if (!r.confirm) return
        this.updateSession(this._state.activeId, (s) => ({ ...s, msgs: [], title: '新对话', updatedAt: now() }))
      },
    })
  },

  onModel(e) {
    const idx = Number(e.detail.value)
    const c = this._catalog || []
    const model = c[idx]
    if (!model) return
    this.setData({ modelIdx: idx, modelLabel: model.id })
    this.updateSession(this._state.activeId, (s) => Object.assign({}, s, { model: model.id }))
  },

  async onSend() {
    const text = String(this.data.input || '').trim()
    if (!text || this.data.busy) return
    this.setData({ input: '' })
    await this.run(this._state.activeId, text)
  },

  modelChat(sid, hist, mdl) {
    if (!mdl) {
      this.pushTo(sid, { role: 'error', content: '当前没有可用模型，请先在网页端「上游接入」登记一个 OpenAI 兼容上游。' })
      return
    }
    this.setData({ busy: true })
    return api
      .tryChat(mdl, hist)
      .then((d) => {
        const content = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content
        const usage = d.usage ? `输入 ${d.usage.prompt_tokens || 0} · 输出 ${d.usage.completion_tokens || 0} tokens` : ''
        this.pushTo(sid, { role: 'assistant', content: content || '（模型没有返回文本内容）', usage, model: mdl })
      })
      .catch((e) => this.pushTo(sid, { role: 'error', content: String(e && e.message ? e.message : e) }))
      .finally(() => this.setData({ busy: false }))
  },

  run(sid, text) {
    const cur = this._state.sessions.find((s) => s.id === sid)
    const hist = buildContext([...(cur ? cur.msgs : []), { role: 'user', content: text }])
    const mdl = this.data.modelLabel
    this.pushTo(sid, { role: 'user', content: text })
    const push = (m) => this.pushTo(sid, m)
    const pushAgent = (title, detail, extra) => push(Object.assign({ role: 'agent', title, detail }, extra || {}))
    const it = parseIntent(text, MINIAPP_ROUTES)
    const goTab = (v) => wx.switchTab({ url: '/pages/' + v + '/index' })

    if (it.type === 'nav') {
      const label = (MINIAPP_ROUTES.titles[it.view] || it.view)
      pushAgent('导航', `已打开「${label}」`, { view: it.view })
      goTab(it.view)
      return Promise.resolve()
    }
    if (it.type === 'render' || it.type === 'build') {
      pushAgent('提交任务', '已打开提交页：可切换视频转码 / Blender 渲染 / 编译打包')
      goTab('submit')
      return Promise.resolve()
    }
    if (it.type === 'marketSearch') {
      pushAgent('搜索', `已打开算力市场（关键词「${it.q || '全部'}」；按关键词筛选服务挂牌请用网页端）`)
      goTab('market')
      return Promise.resolve()
    }
    if (it.type === 'image' || it.type === 'video') {
      pushAgent(it.type === 'image' ? '生图' : '生视频', '创作工作台目前只在星舷网页端提供；已记下你的描述。', { detail2: it.prompt })
      return Promise.resolve()
    }
    if (it.type === 'vmRent') {
      pushAgent('云主机', '云主机租用目前只在星舷网页端与 App 提供。')
      return Promise.resolve()
    }
    if (it.type === 'sellPublish') {
      pushAgent('发布', '服务挂牌发布目前只在星舷网页端提供。')
      return Promise.resolve()
    }
    if (it.type === 'forumPost') {
      pushAgent('发帖', '论坛发帖目前只在星舷网页端与 App 提供。')
      return Promise.resolve()
    }
    if (it.type === 'balance') {
      return api
        .me()
        .then((me) => pushAgent('余额', `当前账户余额 ${f2(me.credits)} 算力点`, { view: 'bill' }))
        .catch((e) => push({ role: 'error', content: '查询失败：' + (e.message || e) }))
    }
    if (it.type === 'tasks') {
      return api
        .jobs()
        .then((d) => {
          const jobs = d.jobs || []
          const running = jobs.filter((j) => ['queued', 'running', 'pending', 'leased', 'fetching', 'uploading', 'merging'].includes(j.status)).length
          const done = jobs.filter((j) => j.status === 'done').length
          const failed = jobs.filter((j) => j.status === 'failed').length
          pushAgent('任务概览', `共 ${jobs.length} 个任务：进行中 ${running} · 完成 ${done} · 失败 ${failed}`, { view: 'jobs' })
        })
        .catch((e) => push({ role: 'error', content: '查询失败：' + (e.message || e) }))
    }
    if (it.type === 'nodes') {
      return api
        .state()
        .then((st) => {
          const mine = (st.workers || []).filter((w) => w.mine)
          const on = mine.filter((w) => w.online).length
          const earn = mine.reduce((a, w) => a + Number(w.earned || 0), 0)
          pushAgent('节点概览', `我的节点 ${mine.length} 台，在线 ${on} 台，累计贡献 ${f2(earn)} 点`, { view: 'me' })
        })
        .catch((e) => push({ role: 'error', content: '查询失败：' + (e.message || e) }))
    }
    if (it.type === 'recharge') {
      return new Promise((resolve) => {
        wx.showModal({
          title: '充值',
          content: `充值 ${f2(it.amount)} 算力点？`,
          success: async (r) => {
            if (!r.confirm) {
              pushAgent('已取消', '未充值')
              resolve()
              return
            }
            try {
              await api.recharge(it.amount)
              pushAgent('充值成功', `已充值 ${f2(it.amount)} 算力点`)
            } catch (e) {
              push({ role: 'error', content: '充值失败：' + (e.message || e) })
            }
            resolve()
          },
        })
      })
    }
    if (it.type === 'createKey') {
      return new Promise((resolve) => {
        wx.showModal({
          title: '创建 API Key',
          content: `创建 API Key「${it.name || '默认密钥'}」？密钥只显示一次。`,
          success: async (r) => {
            if (!r.confirm) {
              pushAgent('已取消', '未创建密钥')
              resolve()
              return
            }
            try {
              const d = await api.createKey(it.name || '默认密钥', 0)
              pushAgent('密钥已创建', '请立即复制保存（仅显示一次）', { secret: d.key })
            } catch (e) {
              push({ role: 'error', content: '创建失败：' + (e.message || e) })
            }
            resolve()
          },
        })
      })
    }
    return this.modelChat(sid, hist, mdl)
  },

  copySecret(e) {
    wx.setClipboardData({ data: e.currentTarget.dataset.s })
  },

  openView(e) {
    const v = e.currentTarget.dataset.view
    if (v) wx.switchTab({ url: '/pages/' + v + '/index' })
  },
})
