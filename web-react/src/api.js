// API 层：与原生版/后端契约完全一致。BASE 兼容反代子路径。
//
// 三种运行环境，取址逻辑不同，这里一次处理掉：
//   1. 线上（starstack.run 或反代子路径）：同源相对路径，BASE 从 pathname 推断；
//   2. 桌面 exe：WebView 加载 127.0.0.1:<port>，同源请求由 WPF 主进程反代到 Broker，
//      前端保持相对路径即可（既不用管 CORS，也不用管 Cookie 的 Domain）；
//   3. 鸿蒙 rawfile / file://：没有同源后端，必须用绝对地址。
// 用户在「设置 → 服务器地址」指定的地址优先级最高（写入 localStorage 后重载生效）。
const DEFAULT_BROKER = 'https://starstack.run'
const PATH_BASE = (location.pathname.match(/^(\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)\/[^/]*$/) || ['', ''])[1]

function safeGet(k) {
  try { return localStorage.getItem(k) || '' } catch (e) { return '' }
}
function safeSet(k, v) {
  try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch (e) {}
}

/** 用户手工指定的 Broker 根地址；空字符串表示走同源。 */
export function getBroker() {
  return safeGet('ss-broker')
}
export function setBroker(v) {
  const clean = String(v || '').trim().replace(/\/+$/, '')
  safeSet('ss-broker', clean)
  return clean
}

/** 当前生效的绝对地址（空 = 同源）。 */
export const BROKER = getBroker() || (/(^file:|^resource:|^ms-appx:)/.test(location.protocol) ? DEFAULT_BROKER : '')
export const BASE = BROKER ? '' : PATH_BASE
export const href = u => (typeof u === 'string' && u.startsWith('/') ? BROKER + BASE + u : u)

/** Bearer 令牌：跨 origin（exe 反代 / 鸿蒙绝对地址）时不再依赖 Cookie。 */
export function getToken() {
  return safeGet('ss-token')
}
export function setToken(v) {
  safeSet('ss-token', v)
}

// 独立管理控制台模式：携带 admin token，并把 /api/* 重写到 /api/admin/*（独立认证面）。
let adminToken = null
export function setAdminToken(t) { adminToken = t || null }
export function getAdminToken() { return adminToken }
function adminUrl(u) {
  const full = href(u)
  if (!adminToken) return full
  const prefix = BASE + '/api/'
  if (full.startsWith(prefix)) return BROKER + BASE + '/api/admin/' + full.slice(prefix.length)
  return full
}

export async function api(u, o) {
  const opts = o || {}
  const headers = new Headers(opts.headers || {})
  if (adminToken) headers.set('Authorization', 'Bearer ' + adminToken)
  else if (!headers.has('Authorization')) {
    const t = getToken()
    if (t) headers.set('Authorization', 'Bearer ' + t)
  }
  const r = await fetch(adminUrl(u), { ...opts, headers })
  const t = await r.text()
  let d = null
  try { d = JSON.parse(t) } catch (e) {}
  if (!r.ok) throw (d && d.error) || t || ('HTTP ' + r.status)
  return d
}
export const post = (u, body) => api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const f1 = v => Number(v || 0).toFixed(1)
export const f2 = v => Number(v || 0).toFixed(2)
export const pt = v => f2(v) + ' 点'

// 时间点一律写成「2026年11月16日12:45:45」，不再只甩一个秒数让用户自己换算。
export const tsCN = t => {
  const s = Number(t || 0)
  if (!(s > 0)) return '—'
  const d = new Date(s * 1000)
  if (isNaN(d.getTime())) return '—'
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 节点最后一次心跳的时刻。新后端直接给 last_seen；旧后端只有 since（距心跳的
// 秒数），一年以内的仍然能反推，再久就不猜了。
export const workerTS = w => {
  if (!w) return '—'
  if (w.last_seen) return tsCN(w.last_seen)
  const since = Number(w.since || 0)
  if (since > 0 && since < 31536000) return tsCN(Math.floor(Date.now() / 1000 - since))
  return '—'
}

// 时长：按天/小时/分展示，避免出现 2154761.4s 这种没人读得懂的数字。
export const durCN = v => {
  const s = Math.max(0, Math.round(Number(v) || 0))
  if (s < 60) return s + ' 秒'
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60), ss = s % 60
  if (d) return `${d} 天 ${h} 小时`
  if (h) return `${h} 小时 ${m} 分`
  return `${m} 分 ${ss} 秒`
}
export const apiTS = t => new Date(t * 1000).toLocaleString('zh-CN', { hour12: false })
export function relTime(t) {
  const d = Date.now() - t * 1000
  if (d < 60000) return '刚刚'
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前'
  if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前'
  if (d < 7 * 86400000) return Math.floor(d / 86400000) + ' 天前'
  return apiTS(t).slice(0, 10)
}
export const CAT_LABEL = { api: 'API', image: '生图', video: '生视频', render: '渲染', build: '编译' }
export const KIND = { hold: '预扣', settle: '结算', refund: '退还', earn: '收益', recharge: '充值' }
export const ST = { pending: '待调度', queued: '排队中', leased: '已派发', fetching: '取源中', running: '转码中', uploading: '回传中', done: '完成', failed: '失败', cancelled: '已取消' }
export const VM_ST = { queued: '排队中', provisioning: '启动中', running: '运行中', unreachable: '失联', stopping: '停机中', stopped: '已停机', failed: '失败' }
export const capNames = { tools: '工具调用', json_object: 'JSON 输出', json_schema: 'JSON Schema', regex: '正则约束', vision: '图像输入', reasoning: '推理', deterministic: '确定性', prefix_cache: '前缀缓存' }
export const ctxLabel = n => !n ? '32K' : n >= 1048576 ? (n / 1048576).toFixed(n % 1048576 ? 2 : 0) + 'M' : n >= 1024 ? Math.round(n / 1024) + 'K' : String(n)
export const wbSize = n => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B'