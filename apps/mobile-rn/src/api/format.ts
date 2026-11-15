// 迁移自 apps/shared/format.js
export const f1 = (v: number | string | null | undefined) => Number(v || 0).toFixed(1)
export const f2 = (v: number | string | null | undefined) => Number(v || 0).toFixed(2)
export const points = (v: number | string | null | undefined) => f2(v) + ' 点'

export const ts = (sec?: number) =>
  sec ? new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false }) : '—'

export function relTime(t?: number): string {
  if (!t) return '—'
  const d = Date.now() - t * 1000
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return Math.floor(d / 60_000) + ' 分钟前'
  if (d < 86_400_000) return Math.floor(d / 3_600_000) + ' 小时前'
  if (d < 7 * 86_400_000) return Math.floor(d / 86_400_000) + ' 天前'
  return ts(t).slice(0, 10)
}

export const hms = (sec?: number) => {
  const s = Math.max(0, Math.floor(sec || 0))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`
}
