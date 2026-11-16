/**
 * RNOH TurboModule：JS 侧 NativeModules.StarStackNode 的 ArkTS 实现。
 * 只暴露 start / stop / status / pickFile / download 五个方法；
 * 事件走 rnInstance.emitDeviceEvent('StarStackNodeStatus', snapshot)。
 */
import { AnyThreadTurboModule } from '@rnoh/react-native-openharmony'
import type { AnyThreadTurboModuleContext } from '@rnoh/react-native-openharmony'
import { NodeService } from '../node/NodeService'

export class StarStackNodeModule extends AnyThreadTurboModule {
  static readonly NAME: string = 'StarStackNode'

  constructor(ctx: AnyThreadTurboModuleContext) {
    super(ctx)
  }

  start(baseUrl: string, launchCode: string, nodeId: string, slots: number, price: number): void {
    NodeService.start(this.ctx, baseUrl, launchCode, nodeId, slots, price)
  }

  stop(): void {
    NodeService.stop()
  }

  status(): string {
    return NodeService.statusJson()
  }

  pickFile(typesJson: string): Promise<string | null> {
    return NodeService.pickFile(this.ctx, typesJson)
  }

  download(url: string, filename: string, headersJson: string): Promise<string> {
    return NodeService.download(this.ctx, url, filename, headersJson)
  }
}
