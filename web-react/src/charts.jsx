import React from 'react'

// 管理面板图表：自包含 SVG/div，无第三方依赖；色板取自星舷系统 + 运维强调色。
export const PALETTE = ['#5b6cff', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']

export function HBar({ data, unit = '' }) {
  const max = Math.max(1, ...data.map(d => d.value))
  return (
    <div className="hbar">
      {data.map((d, i) => (
        <div className="hbar-row" key={d.label}>
          <span className="hbar-label" title={d.label}>{d.label}</span>
          <span className="hbar-track">
            <i style={{ width: (d.value / max * 100) + '%', background: d.color || PALETTE[i % PALETTE.length] }} />
          </span>
          <span className="hbar-val num">{d.value}{unit}</span>
        </div>
      ))}
      {!data.length && <div className="empty inline">暂无数据</div>}
    </div>
  )
}

export function VBar({ data, unit = '', height = 150 }) {
  const max = Math.max(1, ...data.map(d => d.value))
  const bw = 100 / Math.max(1, data.length)
  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
        {data.map((d, i) => {
          const h = Math.max(2, d.value / max * (height - 24))
          return <rect key={i} x={i * bw + bw * 0.18} y={height - 18 - h} width={bw * 0.64} height={h} rx="1.5"
            fill={d.color || PALETTE[i % PALETTE.length]} opacity="0.9" />
        })}
      </svg>
      <div className="vbar-labels">
        {data.map((d, i) => <span key={i} title={d.label}>{d.label}</span>)}
      </div>
    </div>
  )
}

export function Spark({ points, color = '#5b6cff', height = 60, fill = true }) {
  if (!points || points.length < 2) return <div className="empty inline">暂无趋势数据</div>
  const max = Math.max(...points), min = Math.min(...points)
  const span = max - min || 1
  const W = 100, H = height
  const pts = points.map((p, i) => [i / (points.length - 1) * W, H - 6 - ((p - min) / span) * (H - 14)])
  const line = pts.map(p => p.join(',')).join(' ')
  const area = `0,${H} ` + line + ` ${W},${H}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
      {fill && <polygon points={area} fill={color} opacity="0.12" />}
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2" fill={color} />
    </svg>
  )
}

export function Donut({ data, size = 120 }) {
  const total = data.reduce((a, d) => a + d.value, 0) || 1
  let acc = 0
  const R = 15.9155
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg viewBox="0 0 42 42" width={size} height={size}>
        <circle cx="21" cy="21" r={R} fill="none" stroke="var(--soft)" strokeWidth="6" />
        {data.map((d, i) => {
          const frac = d.value / total * 100
          const el = <circle key={i} cx="21" cy="21" r={R} fill="none" stroke={d.color || PALETTE[i % PALETTE.length]}
            strokeWidth="6" strokeDasharray={`${frac} ${100 - frac}`} strokeDashoffset={25 - acc} />
          acc += frac
          return el
        })}
        <text x="21" y="21" textAnchor="middle" dominantBaseline="central" fontSize="7" fill="var(--ink)" fontWeight="700">{total}</text>
      </svg>
      <div className="donut-legend">
        {data.map((d, i) => <span key={i}><i style={{ background: d.color || PALETTE[i % PALETTE.length] }} />{d.label} <b className="num">{d.value}</b></span>)}
      </div>
    </div>
  )
}