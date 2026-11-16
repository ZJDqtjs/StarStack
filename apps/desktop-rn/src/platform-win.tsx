// Windows 平台实现：所有原生能力走 windows/ 里的 StarStackDesktop TurboModule。
// JS 侧只定义契约，C# 模块（native/StarStackDesktopModule.cs）负责文件对话框、
// 带 Bearer 下载与 starstack-worker.exe 子进程。
import { NativeEventEmitter, NativeModules } from 'react-native'
import type { NodeStatus, Platform } from '../../mobile-rn/src/platform'

const Native = NativeModules.StarStackDesktop as any
const events = Native ? new NativeEventEmitter(Native) : null

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
      return parseStatus(await Native.nodeStatus())
    },
    subscribe(cb) {
      const sub = events?.addListener('StarStackNodeStatus', (raw: any) => cb(parseStatus(raw)))
      return () => sub?.remove()
    },
  },
}
