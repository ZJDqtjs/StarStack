// 全局上下文：登录态、机器/任务快照、导航栈、toast 与「从市场带参数去创作」的 prefill。
// 屏幕之间不直接互相 import，全部通过 useApp() 取，避免 RN 里常见的循环依赖。
import { createContext, useContext } from 'react'

export type Route =
  | 'overview'
  | 'create'
  | 'market'
  | 'jobs'
  | 'me'
  | 'wallet'
  | 'nodes'
  | 'pool'
  | 'messages'
  | 'forum'
  | 'api'
  | 'sell'
  | 'settings'
  | 'job'

export type RouteParams = {
  // 市场「立即使用」把卖家的场景模板带进创作页
  kind?: 'transcode' | 'blender' | 'build'
  tpl?: Record<string, any>
  tab?: string
  id?: string
  offer?: any
}

export type Prefill = { kind?: 'transcode' | 'blender' | 'build'; tpl?: Record<string, any> } | null

export type AppApi = {
  me: any
  workers: any[]
  jobs: any[]
  contrib: any
  policy: any
  refresh: () => Promise<void>
  toast: (msg: string, tone?: 'ok' | 'bad' | 'warn') => void
  nav: (route: Route, params?: RouteParams) => void
  back: () => void
  route: Route
  prefill: Prefill
  setPrefill: (p: Prefill) => void
  logout: () => void
}

export const AppCtx = createContext<AppApi>({
  me: null,
  workers: [],
  jobs: [],
  contrib: null,
  policy: null,
  refresh: async () => {},
  toast: () => {},
  nav: () => {},
  back: () => {},
  route: 'overview',
  prefill: null,
  setPrefill: () => {},
  logout: () => {},
})

export const useApp = () => useContext(AppCtx)
