// Windows 平台实现：所有原生能力走 windows/ 里的 StarStackDesktop TurboModule。
// JS 侧只定义契约，C++ 模块（native/StarStackDesktopModule.cpp）负责文件对话框、
// 带 Bearer 下载与 starstack-worker.exe 子进程（含 stderr 状态解析）。
//
// 事件走 DeviceEventEmitter：原生侧是用 RCTDeviceEventEmitter 发的，
// `new NativeEventEmitter(Native)` 要求模块自己实现 addListener/removeListeners，
// 本模块没有，用它拿不到任何回调。
import { DeviceEventEmitter, NativeModules } from 'react-native'
import { api } from '../../mobile-rn/src/api'
import type { NodeStatus, Platform } from '../../mobile-rn/src/platform'

const Native = NativeModules.StarStackDesktop as any

const missing = (what: string): never => {
  throw new Error(`${what}需要 Windows 原生模块：先在节点 84 生成 windows/ 并重新构建桌面端`)
}

const parseStatus = (raw: any): NodeStatus => {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return {
      running: !!v?.running,
      nodeId: String(v?.nodeId || ''),
      phase: v?.phase || 'idle',
      segId: String(v?.segId || ''),
      pct: Number(v?.pct || 0),
      lastError: String(v?.lastError || ''),
      served: Number(v?.served || 0),
      earned: Number(v?.earned || 0),
      encoder: String(v?.encoder || ''),
    }
  } catch {
    return {
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
  }
}

export const winPlatform: Platform = {
  async pickFile({ type }) {
    if (!Native?.pickFile) return missing('文件选择')
    const r = await Native.pickFile(JSON.stringify(type))
    if (!r) return null
    const v = typeof r === 'string' ? JSON.parse(r) : r
    return { uri: String(v.uri), name: String(v.name), size: Number(v.size || 0), mimeType: String(v.mimeType || '') }
  },

  async downloadArtifact(url, filename, headers) {
    if (!Native?.download) return missing('下载产物')
    await Native.download(url, filename, JSON.stringify(headers || {}))
  },

  node: {
    available: !!Native?.nodeStart,
    hint: 'starstack-worker.exe 子进程 · 关掉窗口即停止',
    launch: { os: 'windows', arch: 'amd64', name: 'desktop-node' },
    async start(baseUrl, launchCode, nodeId, slots = 1, price = 0.8) {
      if (!Native?.nodeStart) return missing('本机节点')
      await Native.nodeStart(baseUrl, launchCode, nodeId, slots, price)
    },
    async stop() {
      if (!Native?.nodeStop) return
      await Native.nodeStop()
    },
    async status() {
      if (!Native?.nodeStatus) return parseStatus(null)
      const st = parseStatus(await Native.nodeStatus())
      // 收益只有 Broker 知道（worker 日志里没有），用 /api/contribution 按 nodeId 补齐；
      // 断网/未登录时保持 0，不影响其它字段。
      if (st.nodeId) {
        try {
          const c: any = await api.contribution()
          const mine = (c?.nodes || []).find((n: any) => n.id === st.nodeId)
          if (mine && mine.earned != null) st.earned = Number(mine.earned) || 0
        } catch {
          // 忽略：节点卡片照常显示运行相位
        }
      }
      return st
    },
    subscribe(cb) {
      const sub = DeviceEventEmitter.addListener('StarStackNodeStatus', (raw: any) => cb(parseStatus(raw)))
      return () => sub.remove()
    },
  },
}
