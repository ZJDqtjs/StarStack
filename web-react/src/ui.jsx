import React, { useEffect, useRef } from 'react'

const P = {
  home: ['M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z'],
  image: ['M3 4h18v16H3z', 'M8.5 9.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0', 'M21 16l-5-5-6 7'],
  video: ['M3 5h18v14H3z', 'M10 9l5 3-5 3V9Z'],
  render: ['M12 3l9 5-9 5-9-5 9-5Z', 'M3 12l9 5 9-5M3 16l9 5 9-5'],
  build: ['M6 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M18 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M6 8v6a4 4 0 0 0 4 4h6'],
  api: ['M4 7l4 5-4 5M12 19h8'],
  market: ['M4 7h16l-1.2 12.2a1.5 1.5 0 0 1-1.5 1.3H6.7a1.5 1.5 0 0 1-1.5-1.3L4 7Z', 'M8 10V6a4 4 0 0 1 8 0v4'],
  sell: ['M20 12l-8 8-9-9V4h7l10 8Z', 'M7.5 7.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0'],
  messages: ['M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.8-.8L3 21l1.9-5.2a8.4 8.4 0 1 1 16.1-4.3Z'],
  nodes: ['M3 4h18v7H3zM3 13h18v7H3z', 'M7 7.5h.01M7 16.5h.01'],
  pool: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z'],
  forum: ['M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v9Z'],
  jobs: ['M9 6h11M9 12h11M9 18h11', 'M4 5.5l1 1 2-2M4 11.5l1 1 2-2M4 17.5l1 1 2-2'],
  wallet: ['M3 5h18v14H3z', 'M3 10h18M7 15h4'],
  settings: ['M4 8h10M18 8h2M4 16h2M10 16h10', 'M16 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M8 16m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0'],
  plus: ['M12 5v14M5 12h14'],
  search: ['M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M20 20l-3.5-3.5'],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'],
  sun: ['M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4'],
  menu: ['M4 7h16M4 12h16M4 17h16'],
  chevL: ['M15 6l-6 6 6 6'],
  upload: ['M12 16V4m0 0l-4 4m4-4l4 4', 'M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'],
  file: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z', 'M14 3v6h6'],
  x: ['M6 6l12 12M18 6L6 18'],
  download: ['M12 4v12m0 0l-4-4m4 4l4-4', 'M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'],
  trend: ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
  box: ['M12 3l9 5-9 5-9-5 9-5Z', 'M3 12l9 5 9-5'],
}
export function I({ name, size = 16, fill = false, style }) {
  const ds = P[name] || P.box
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={style}
      fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ds.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}
export const StarMark = ({ size = 17 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4L12 3Z" />
  </svg>
)

export function Btn({ ghost, danger, tiny, sm, block, className = '', children, ...rest }) {
  const cls = [ghost ? 'ghost' : 'btn', tiny ? 'tiny' : '', sm ? 'sm' : '', block ? 'block' : '', danger ? 'danger' : '', className].filter(Boolean).join(' ')
  return <button className={cls} {...rest}>{children}</button>
}
export function Card({ kicker, title, side, className = '', style, children }) {
  return (
    <div className={'card ' + className} style={style}>
      {(title || kicker || side) && (
        <h2>{kicker && <span className="kicker">{kicker}</span>}{title}{side && <span className="h2-side">{side}</span>}</h2>
      )}
      {children}
    </div>
  )
}
export const Tag = ({ tone = '', children }) => <span className={'tag ' + tone}>{children}</span>
export const St = ({ s, children }) => <span className={'st ' + s}>{children}</span>
export const Stat = ({ v, l, hl }) => <div className={'stat' + (hl ? ' hl' : '')}><b>{v}</b><span>{l}</span></div>
export function Kpi({ label, value, icon, action }) {
  if (action) return <div className="kpi kpi-action">{action}</div>
  return <div className="kpi"><span>{label}</span><b>{value}</b>{icon && <i>{icon}</i>}</div>
}
export function Tabs({ items, active, onChange }) {
  return (
    <div className="tabs">
      {items.map(t => (
        <button key={t.key} type="button" className={active === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>
          {t.label}{t.count != null && <span className="cnt">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
export const Chip = ({ on, cat, className = '', children, ...rest }) => (
  <button type="button" className={['chip', cat ? 'cat-' + cat : '', on ? 'on' : '', className].filter(Boolean).join(' ')} {...rest}>{children}</button>
)
export const Field = ({ label, hint, children }) => (
  <div>{label && <label>{label}</label>}{children}{hint && <div className="hint">{hint}</div>}</div>
)
export const Empty = ({ children, inline }) => <div className={'empty' + (inline ? ' inline' : '')}>{children}</div>
export const SearchBox = ({ value, onChange, placeholder, style }) => (
  <div className="searchbox" style={style}>
    <I name="search" size={14} />
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
  </div>
)
export const Avatar = ({ name, size }) => (
  <span className="avatar" style={size ? { width: size, height: size, flex: `0 0 ${size}px`, fontSize: size * 0.42 } : undefined}>
    {String(name || '?').slice(0, 1).toUpperCase()}
  </span>
)
export const Bar = ({ pct }) => <div className="bar"><i style={{ width: Math.max(0, Math.min(100, pct)) + '%' }} /></div>

export function Modal({ open, onClose, title, size = '', children, foot }) {
  useEffect(() => {
    if (!open) return
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="modal-mask on" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'modal ' + size} role="dialog" aria-modal="true">
        <div className="modal-head"><h2>{title}</h2><button className="modal-x" onClick={onClose} aria-label="关闭">✕</button></div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  )
}