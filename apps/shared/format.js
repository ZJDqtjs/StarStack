export const f1 = (v) => Number(v || 0).toFixed(1)
export const f2 = (v) => Number(v || 0).toFixed(2)
export const points = (v) => f2(v) + ' 点'

export const ts = (sec) => (sec ? new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false }) : '—')

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
