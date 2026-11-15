// 原生算力节点桥：JS 只负责开关与展示，长轮询/转码/心跳全在 Kotlin 前台 Service 里。
// 没装原生模块时（Expo Go）available=false，界面给出明确提示而不是静默失败。
import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core'

export type NodePhase = 'idle' | 'registering' | 'polling' | 'fetching' | 'transcoding' | 'uploading' | 'error'

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

export const EMPTY_STATUS: NodeStatus = {
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

type NativeNodeModule = {
  start(baseUrl: string, launchCode: string, nodeId: string, slots: number, price: number): Promise<void>
  stop(): Promise<void>
  status(): Promise<NodeStatus>
}

const Native = requireOptionalNativeModule<NativeNodeModule>('StarStackNode')

export const nodeService = {
  available: Native != null,
  // 注册走「一次性启动码」而不是用户 session token：
  // /api/worker/hello 认的是 X-Launch-Code / X-Agent-Token / X-Node-Secret，
  // 用户会话 token 不在其中。App 先调 /api/nodes/launch 换码，再把码交给原生服务。
  async start(baseUrl: string, launchCode: string, nodeId: string, slots = 1, price = 0.8): Promise<void> {
    if (!Native) throw new Error('当前运行环境没有原生节点模块，请用 development build 或 APK 运行')
    await Native.start(baseUrl, launchCode, nodeId, slots, price)
  },
  async stop(): Promise<void> {
    await Native?.stop()
  },
  async status(): Promise<NodeStatus> {
    if (!Native) return EMPTY_STATUS
    return Native.status()
  },
}

// 原生侧通过 sendEvent("onNodeStatus", ...) 推送，JS 只订阅展示。
// EventEmitter 的默认事件表是 Record<never, never>，必须显式给出事件名与载荷类型，
// 否则 addListener('onNodeStatus') 会被推断成 never。
type NodeEvents = { onNodeStatus: (status: NodeStatus) => void }

// Native 在运行时带 addListener/removeListeners，但模块类型没声明这些桥接方法，
// 这里只做类型断言，不影响实际调用。
export const nodeEvents = Native
  ? new EventEmitter<NodeEvents>(Native as unknown as ConstructorParameters<typeof EventEmitter>[0])
  : null
