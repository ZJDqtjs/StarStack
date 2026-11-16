// Android 的平台能力实现：Expo 文件选择/下载/分享 + Kotlin 前台 Service 节点。
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { nodeEvents, nodeService } from './native/nodeService'
import type { Platform } from './platform'

export const expoPlatform: Platform = {
  async pickFile({ type }) {
    const res = await DocumentPicker.getDocumentAsync({ type, copyToCacheDirectory: true })
    if (res.canceled || !res.assets?.length) return null
    const a = res.assets[0]
    return { uri: a.uri, name: a.name, size: a.size ?? undefined, mimeType: a.mimeType ?? undefined }
  },

  async downloadArtifact(url, filename, headers) {
    const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory
    if (!dir) throw new Error('当前平台没有可写缓存目录')
    const res = await FileSystem.downloadAsync(url, dir + filename, { headers: headers || {} })
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(res.uri, { mimeType: 'application/octet-stream', dialogTitle: '保存产物' })
    } else {
      throw new Error('已下载到 ' + res.uri + '，但当前设备没有分享面板')
    }
  },

  node: {
    available: nodeService.available,
    hint: 'Kotlin 前台服务 · 退到后台不中断',
    launch: { os: 'android', arch: 'arm64', name: 'android-node' },
    start: (baseUrl, launchCode, nodeId, slots, price) => nodeService.start(baseUrl, launchCode, nodeId, slots, price),
    stop: () => nodeService.stop(),
    status: () => nodeService.status(),
    subscribe: (cb) => {
      const sub = nodeEvents?.addListener('onNodeStatus', cb)
      return () => sub?.remove()
    },
  },
}
