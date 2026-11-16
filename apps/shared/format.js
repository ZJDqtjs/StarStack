export const f1 = (v) => Number(v || 0).toFixed(1)
export const f2 = (v) => Number(v || 0).toFixed(2)
export const points = (v) => f2(v) + ' 点'

export const ts = (sec) => (sec ? new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false }) : '—')

// 时间点统一写成「2026年11月16日12:45:45」，不再只展示一个秒数。
export const tsCN = (t) => {
  const s = Number(t || 0)
  if (!(s > 0)) return '—'
  const d = new Date(s * 1000)
  if (isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 节点最后一次心跳的时刻：新后端给 last_seen，旧后端只有 since（距心跳秒数）。
export const workerTS = (w) => {
  if (!w) return '—'
  if (w.last_seen) return tsCN(w.last_seen)
  const since = Number(w.since || 0)
  if (since > 0 && since < 31536000) return tsCN(Math.floor(Date.now() / 1000 - since))
  return '—'
}

// 时长：按天/小时/分展示，避免 2154761.4s 这种读不懂的数字。
export const durCN = (v) => {
  const s = Math.max(0, Math.round(Number(v) || 0))
  if (s < 60) return s + ' 秒'
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60), ss = s % 60
  if (d) return `${d} 天 ${h} 小时`
  if (h) return `${h} 小时 ${m} 分`
  return `${m} 分 ${ss} 秒`
}

// 相对时间：agent 历史会话列表用（与 web-react api.js 的 relTime 行为一致）。
export function relTime(t) {
  const d = Date.now() - t * 1000
  if (d < 60000) return '刚刚'
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前'
  if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前'
  if (d < 7 * 86400000) return Math.floor(d / 86400000) + ' 天前'
  return ts(t).slice(0, 10)
}

export const hms = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0))
  const p = (n) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`
}

export const ctxLabel = (n) => {
  if (!n) return '32K'
  if (n >= 1048576) return (n / 1048576).toFixed(n % 1048576 ? 2 : 0) + 'M'
  if (n >= 1024) return Math.round(n / 1024) + 'K'
  return String(n)
}

export const memGB = (mb) => (mb ? Math.round((mb / 1024) * 10) / 10 + 'G' : '—')

export function fileSize(bytes) {
  const n = Number(bytes || 0)
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB'
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB'
  if (n >= 1024) return Math.round(n / 1024) + ' KB'
  return n + ' B'
}

export function portsLabel(ports) {
  const list = (ports || []).map((p) => `${p.host_port || '自动'}:${p.guest_port}${p.proto === 'udp' ? '/udp' : ''}`)
  return list.join(' · ') || '仅 SSH'
}

export const shortId = (id, n = 10) => String(id || '').slice(0, n)
