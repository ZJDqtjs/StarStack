// 图标：路径直接沿用 web-react/src/ui.jsx 的 24×24 线性图标，
// 保证移动端与控制台是同一套视觉语言（同样的 1.7 描边、同样的圆头圆角）。
import React from 'react'
import Svg, { Path } from 'react-native-svg'

export type IconName =
  | 'home'
  | 'image'
  | 'video'
  | 'render'
  | 'build'
  | 'api'
  | 'market'
  | 'sell'
  | 'messages'
  | 'nodes'
  | 'pool'
  | 'forum'
  | 'jobs'
  | 'wallet'
  | 'settings'
  | 'vm'
  | 'plus'
  | 'search'
  | 'moon'
  | 'sun'
  | 'menu'
  | 'chevL'
  | 'chevR'
  | 'arrowR'
  | 'upload'
  | 'file'
  | 'x'
  | 'download'
  | 'trend'
  | 'box'
  | 'check'
  | 'clock'
  | 'user'
  | 'send'
  | 'refresh'
  | 'play'
  | 'stop'
  | 'bell'
  | 'link'
  | 'star'
  | 'trash'
  | 'key'

const P: Record<IconName, string[]> = {
  home: ['M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z'],
  image: [
    'M3 4h18v16H3z',
    'M8.5 9.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
    'M21 16l-5-5-6 7',
  ],
  video: ['M3 5h18v14H3z', 'M10 9l5 3-5 3V9Z'],
  render: ['M12 3l9 5-9 5-9-5 9-5Z', 'M3 12l9 5 9-5M3 16l9 5 9-5'],
  build: [
    'M6 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M18 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M6 8v6a4 4 0 0 0 4 4h6',
  ],
  api: ['M4 7l4 5-4 5M12 19h8'],
  market: [
    'M4 7h16l-1.2 12.2a1.5 1.5 0 0 1-1.5 1.3H6.7a1.5 1.5 0 0 1-1.5-1.3L4 7Z',
    'M8 10V6a4 4 0 0 1 8 0v4',
  ],
  sell: ['M20 12l-8 8-9-9V4h7l10 8Z', 'M7.5 7.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0'],
  messages: ['M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.8-.8L3 21l1.9-5.2a8.4 8.4 0 1 1 16.1-4.3Z'],
  nodes: ['M3 4h18v7H3zM3 13h18v7H3z', 'M7 7.5h.01M7 16.5h.01'],
  pool: [
    'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0',
    'M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z',
  ],
  forum: ['M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v9Z'],
  jobs: ['M9 6h11M9 12h11M9 18h11', 'M4 5.5l1 1 2-2M4 11.5l1 1 2-2M4 17.5l1 1 2-2'],
  wallet: ['M3 5h18v14H3z', 'M3 10h18M7 15h4'],
  settings: [
    'M4 8h10M18 8h2M4 16h2M10 16h10',
    'M16 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M8 16m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
  vm: ['M3 4h18v12H3z', 'M8 20h8M12 16v4', 'M7 8h5'],
  plus: ['M12 5v14M5 12h14'],
  search: ['M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M20 20l-3.5-3.5'],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'],
  sun: [
    'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
    'M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4',
  ],
  menu: ['M4 7h16M4 12h16M4 17h16'],
  chevL: ['M15 6l-6 6 6 6'],
  chevR: ['M9 6l6 6-6 6'],
  arrowR: ['M5 12h14M13 6l6 6-6 6'],
  upload: ['M12 16V4m0 0l-4 4m4-4l4 4', 'M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'],
  file: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z', 'M14 3v6h6'],
  x: ['M6 6l12 12M18 6L6 18'],
  download: ['M12 4v12m0 0l-4-4m4 4l4-4', 'M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'],
  trend: ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
  box: ['M12 3l9 5-9 5-9-5 9-5Z', 'M3 12l9 5 9-5'],
  check: ['M4 12.5l5 5L20 6.5'],
  clock: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M12 7v5l3.5 2'],
  user: ['M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M4.5 20a7.5 7.5 0 0 1 15 0'],
  send: ['M4 12l16-8-6 16-3-6-7-2Z'],
  refresh: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v5h-5'],
  play: ['M8 5l11 7-11 7V5Z'],
  stop: ['M7 7h10v10H7z'],
  bell: ['M18 16V10a6 6 0 1 0-12 0v6l-2 2h16l-2-2Z', 'M10 20a2 2 0 0 0 4 0'],
  link: [
    'M9 15l6-6',
    'M10.5 6.5l1.8-1.8a4 4 0 0 1 5.6 5.6l-1.8 1.8',
    'M13.5 17.5l-1.8 1.8a4 4 0 0 1-5.6-5.6l1.8-1.8',
  ],
  star: ['M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4L12 3Z'],
  trash: ['M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13', 'M10 11v6M14 11v6'],
  key: ['M14 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M11 10l-7 7v3h3l7-7'],
}

export function Icon({
  name,
  size = 18,
  color = '#16192b',
  fill = false,
  strokeWidth = 1.7,
  style,
}: {
  name: IconName
  size?: number
  color?: string
  fill?: boolean
  strokeWidth?: number
  style?: any
}) {
  const ds = P[name] || P.box
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? color : 'none'}
      stroke={fill ? 'none' : color}
      strokeWidth={fill ? 0 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {ds.map((d, i) => (
        <Path key={i} d={d} fill={fill ? color : 'none'} stroke={fill ? 'none' : color} />
      ))}
    </Svg>
  )
}

export function StarMark({ size = 18, color = '#16192b' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{}}>
      <Path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4L12 3Z" fill={color} />
    </Svg>
  )
}
