// 星舷设计系统（与控制台 web-react / 欢迎页保持同一套色板）
export const C = {
  bg: '#f6f8fd',
  surface: '#ffffff',
  surfaceAlt: '#fbfcff',
  line: '#e8ecf5',
  lineStrong: '#dce3f0',
  text: '#1f2937',
  muted: '#64748b',
  dim: '#94a3b8',
  primary: '#5a6bff',
  primary2: '#8b5cf6',
  soft: '#eef0ff',
  softBorder: '#dfe2ff',
  success: '#16a34a',
  danger: '#ef4444',
  amber: '#f59e0b',
} as const

export const R = { sm: 8, md: 12, lg: 16, xl: 20 } as const

export const card = {
  backgroundColor: C.surface,
  borderWidth: 1,
  borderColor: C.line,
  borderRadius: R.md,
} as const
