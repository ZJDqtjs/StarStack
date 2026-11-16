// 鸿蒙平台实现：文件选择/下载/常驻节点都走 ArkTS TurboModule `StarStackNode`。
// 页面本身来自 apps/mobile-rn，不含任何 @ohos / ArkTS 依赖。
import { DeviceEventEmitter, NativeModules } from 'react-native'
import type { NodeStatus, Platform } from '../../mobile-rn/src/platform'

const Native = NativeModules.StarStackNode as any

const missing = (what: string): never => {
  throw new Error(`${what}需要 ArkTS 原生模块：先在 DevEco 里编译 entry 并安装 HAP`)
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

export const ohosPlatform: Platform = {
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
    available: !!Native?.start,
    hint: 'ArkTS 长时任务 · 需系统后台权限',
    launch: { os: 'harmony', arch: 'arm64', name: 'harmony-node' },
    async start(baseUrl, launchCode, nodeId, slots = 1, price = 0.8) {
      if (!Native?.start) return missing('本机节点')
      await Native.start(baseUrl, launchCode, nodeId, slots, price)
    },
    async stop() {
      if (!Native?.stop) return
      await Native.stop()
    },
    async status() {
      if (!Native?.status) return parseStatus(null)
      return parseStatus(await Native.status())
    },
    subscribe(cb) {
      const sub = DeviceEventEmitter.addListener('StarStackNodeStatus', (raw: any) => cb(parseStatus(raw)))
      return () => sub.remove()
    },
  },
}
