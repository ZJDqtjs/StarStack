// 平台能力注入层：页面只依赖这里的接口，不直接 import Expo / Kotlin / ArkTS。
// Android 用 platform-expo.tsx 注入 Expo + Kotlin 前台 Service；
// 桌面 RNW 与鸿蒙 RNOH 各自注入自己的实现，从而复用同一套 screens。
import React, { createContext, useContext } from 'react'

export type PickedFile = {
  uri: string
  name: string
  size?: number
  mimeType?: string
}

export type NodePhase =
  | 'idle'
  | 'registering'
  | 'polling'
  | 'fetching'
  | 'transcoding'
  | 'uploading'
  | 'error'

export type NodeStatus = {
  running: boolean
  nodeId: string
  phase: NodePhase
  segId: string
  pct: number
  lastError: string
  served: number
  earned: number
  encoder: string
}

export const EMPTY_NODE_STATUS: NodeStatus = {
  running: false,
  nodeId: '',
  phase: 'idle',
  segId: '',
  pct: 0,
  lastError: '',
  served: 0,
  earned: 0,
  encoder: '',
}

export type NodeLaunchProfile = {
  os: 'android' | 'windows' | 'linux' | 'darwin' | 'harmony'
  arch: 'amd64' | 'arm64'
  name: string
}

export type PlatformNode = {
  /** 本端是否真的带了节点原生模块；Expo Go / 未生成的 RNOH 工程为 false。 */
  available: boolean
  /** 节点形态说明，直接显示在总览卡片上。 */
  hint: string
  /** 换启动码时上报的系统/芯片，以及默认节点名。 */
  launch: NodeLaunchProfile
  start(baseUrl: string, launchCode: string, nodeId: string, slots?: number, price?: number): Promise<void>
  stop(): Promise<void>
  status(): Promise<NodeStatus>
  subscribe(cb: (status: NodeStatus) => void): () => void
}

export type Platform = {
  pickFile(opts: { type: string | string[] }): Promise<PickedFile | null>
  /** 带 Bearer 下载并把文件交给系统（移动端分享面板 / 桌面另存为）。 */
  downloadArtifact(url: string, filename: string, headers?: Record<string, string>): Promise<void>
  node: PlatformNode
}

const Ctx = createContext<Platform | null>(null)

export function PlatformProvider({ value, children }: { value: Platform; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePlatform(): Platform {
  const p = useContext(Ctx)
  if (!p) throw new Error('PlatformProvider 未挂载：页面不能直接依赖某端的原生模块')
  return p
}
