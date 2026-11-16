// 星舷设计系统（移动端）：色板 / 圆角 / 字号与 web-react 的 styles.css 一一对应。
// 移动端没有 CSS 变量，所以这里出两套 Palette，由 ThemeProvider 按 data-theme 的语义切换。
// 新增颜色请先去 web-react/src/styles.css 加变量，再来这里同步，避免两端再次跑偏。
import React, { createContext, useContext, useMemo } from 'react'

export type Mode = 'light' | 'dark'

export type Palette = {
  bg: string
  surface: string
  soft: string
  inset: string
  hair: string
  hair2: string
  ink: string
  body: string
  mute: string
  faint: string
  accent: string
  accentHover: string
  accentInk: string
  accentSoft: string
  accentRing: string
  link: string
  ok: string
  okSoft: string
  warn: string
  warnSoft: string
  bad: string
  badSoft: string
  info: string
  infoSoft: string
  vio: string
  vioSoft: string
  cApi: string
  cImage: string
  cVideo: string
  cRender: string
  cBuild: string
  cVm: string
  shadow: string
  overlay: string
}

export const LIGHT: Palette = {
  bg: '#f6f7f9',
  surface: '#ffffff',
  soft: '#f2f4f7',
  inset: '#f8f9fb',
  hair: '#e6e8ee',
  hair2: '#d5d9e2',
  ink: '#16192b',
  body: '#4a5168',
  mute: '#8a91a8',
  faint: '#b0b6c8',
  accent: '#5b6cff',
  accentHover: '#4a5bf0',
  accentInk: '#ffffff',
  accentSoft: 'rgba(91,108,255,0.10)',
  accentRing: 'rgba(91,108,255,0.22)',
  link: '#5b6cff',
  ok: '#0e9f6e',
  okSoft: 'rgba(14,159,110,0.12)',
  warn: '#d97706',
  warnSoft: 'rgba(217,119,6,0.12)',
  bad: '#e02424',
  badSoft: 'rgba(224,36,36,0.10)',
  info: '#0284c7',
  infoSoft: 'rgba(2,132,199,0.10)',
  vio: '#8b5cf6',
  vioSoft: 'rgba(139,92,246,0.12)',
  cApi: '#0284c7',
  cImage: '#db2777',
  cVideo: '#0891b2',
  cRender: '#7c3aed',
  cBuild: '#d97706',
  cVm: '#0d9488',
  shadow: '0 2px 4px rgba(22,25,43,0.05)',
  overlay: 'rgba(14,18,32,0.42)',
}

export const DARK: Palette = {
  bg: '#0b0e17',
  surface: '#121627',
  soft: '#1a1f33',
  inset: '#0e1220',
  hair: '#232a42',
  hair2: '#303a58',
  ink: '#edf0fa',
  body: '#a8b0c8',
  mute: '#6f7896',
  faint: '#4d5674',
  accent: '#7c8aff',
  accentHover: '#93a0ff',
  accentInk: '#0b0e17',
  accentSoft: 'rgba(124,138,255,0.14)',
  accentRing: 'rgba(124,138,255,0.30)',
  link: '#8fa0ff',
  ok: '#34d399',
  okSoft: 'rgba(52,211,153,0.13)',
  warn: '#fbbf24',
  warnSoft: 'rgba(251,191,36,0.13)',
  bad: '#f87171',
  badSoft: 'rgba(248,113,113,0.13)',
  info: '#38bdf8',
  infoSoft: 'rgba(56,189,248,0.13)',
  vio: '#a78bfa',
  vioSoft: 'rgba(167,139,250,0.14)',
  cApi: '#38bdf8',
  cImage: '#f472b6',
  cVideo: '#22d3ee',
  cRender: '#a78bfa',
  cBuild: '#fbbf24',
  cVm: '#2dd4bf',
  shadow: '0 2px 6px rgba(0,0,0,0.45)',
  overlay: 'rgba(4,6,12,0.66)',
}

export const R = { sm: 8, ctl: 8, card: 12, lg: 16, pill: 999 } as const
export const F = {
  sans: undefined as string | undefined,
  mono: 'monospace',
} as const

type ThemeValue = { c: Palette; mode: Mode; toggle: () => void; signedIn: boolean }

const ThemeCtx = createContext<ThemeValue>({ c: LIGHT, mode: 'light', toggle: () => {}, signedIn: false })

export function ThemeProvider({
  mode,
  toggle,
  signedIn,
  children,
}: {
  mode: Mode
  toggle: () => void
  signedIn: boolean
  children: React.ReactNode
}) {
  const value = useMemo<ThemeValue>(
    () => ({ c: mode === 'dark' ? DARK : LIGHT, mode, toggle, signedIn }),
    [mode, toggle, signedIn]
  )
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

export function useTheme(): ThemeValue {
  return useContext(ThemeCtx)
}

// StyleSheet.create 是静态的，主题切换必须重新生成样式表：
// 每个屏幕写一个 makeStyles(c)，再用这个 hook 拿到按主题缓存的结果。
export function useStyles<T>(make: (c: Palette) => T): T {
  const { c, mode } = useTheme()
  return useMemo(() => make(c), [c, mode, make])
}

// 服务标识色：与 web 的 --c-* 对应，用于分类点与图标底色。
export function catColor(c: Palette, cat: string): string {
  switch (cat) {
    case 'api':
      return c.cApi
    case 'image':
      return c.cImage
    case 'video':
      return c.cVideo
    case 'render':
      return c.cRender
    case 'build':
      return c.cBuild
    case 'vm':
      return c.cVm
    default:
      return c.accent
  }
}

export const CAT_LABEL: Record<string, string> = {
  api: 'API',
  image: '生图',
  video: '生视频',
  render: '渲染',
  build: '编译',
  vm: '云主机',
}
