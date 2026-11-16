/**
 * 星栈鸿蒙节点：ArkTS 长时任务 + 控制面长轮询。
 *
 * 当前只接通「注册 / 心跳 / 认领 / 失败回报」：
 * - 不声明 encoders，Broker 不会把转码分片派给本机（没有媒体管线的节点不该抢活）；
 * - 媒体执行（AVDemuxer/AVMuxer/AVCodec）是下一步，接好后在 hello 里声明
 *   h264_mediacodec / hevc_mediacodec 并在这里执行 Claim。
 *
 * 与 Android 的 Kotlin 前台 Service 是两套实现，只共用 Broker 契约。
 */
import http from '@ohos.net.http'
import backgroundTaskManager from '@ohos.resourceschedule.backgroundTaskManager'
import wantAgent from '@ohos.app.ability.wantAgent'
import deviceInfo from '@ohos.deviceInfo'
import fs from '@ohos.file.fs'
import picker from '@ohos.file.picker'
import type { AnyThreadTurboModuleContext } from '@rnoh/react-native-openharmony'

interface GPUDetail {
  name: string
  mem_mb: number
}

interface RuntimeInfo {
  name: string
  version: string
  path?: string
}

interface HelloBody {
  id: string
  node_name: string
  name_set: boolean
  slots: number
  price: number
  hostname: string
  device_id: string
  os: string
  arch: string
  cpus: number
  mem_mb: number
  disk_free_mb: number
  gpus: GPUDetail[]
  encoders: string[]
  runtimes: RuntimeInfo[]
  ffmpeg_version: string
}

interface HelloResp {
  ok: boolean
  id: string
  price: number
  name: string
  claim_code: string
  owned: boolean
  secret: string
}

interface Claim {
  seg_id: string
  job_id: string
  index: number
  start: number
  dur: number
  src_url: string
  vcodec: string
  preset: string
  q: number
  height: number
  audio: boolean
  lease: number
  kind?: string
  bundle?: boolean
}

interface ReportBody {
  worker: string
  seg: string
  state: string
  err: string
}

interface PickedFile {
  uri: string
  name: string
  size: number
  mimeType: string
}

export interface NodeSnapshot {
  running: boolean
  nodeId: string
  phase: string
  segId: string
  pct: number
  lastError: string
  served: number
  earned: number
  encoder: string
}

class NodeServiceImpl {
  static readonly instance: NodeServiceImpl = new NodeServiceImpl()

  private ctx: AnyThreadTurboModuleContext | null = null
  private running: boolean = false
  private baseUrl: string = ''
  private launchCode: string = ''
  private nodeId: string = ''
  private secret: string = ''
  private slots: number = 1
  private price: number = 0.8
  private phase: string = 'idle'
  private lastError: string = ''
  private served: number = 0
  private earned: number = 0

  start(ctx: AnyThreadTurboModuleContext, baseUrl: string, launchCode: string, nodeId: string, slots: number, price: number): void {
    if (this.running) return
    this.ctx = ctx
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.launchCode = launchCode
    this.nodeId = nodeId
    this.secret = ''
    this.slots = Math.max(1, Math.floor(slots || 1))
    this.price = price > 0 ? price : 0.8
    this.phase = 'registering'
    this.lastError = ''
    this.running = true
    this.emit()
    this.startLongTask(ctx).catch((e: Error) => this.fail('后台任务启动失败：' + e.message))
    this.loop().catch((e: Error) => this.fail('节点循环失败：' + e.message))
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.phase = 'idle'
    const ctx = this.ctx
    if (ctx) {
      backgroundTaskManager.stopBackgroundRunning(ctx).catch(() => {})
    }
    this.emit()
  }

  statusJson(): string {
    return JSON.stringify(this.snapshot())
  }

  async pickFile(ctx: AnyThreadTurboModuleContext, typesJson: string): Promise<string | null> {
    const documentPicker = new picker.DocumentViewPicker(ctx)
    const options = new picker.DocumentSelectOptions()
    options.maxSelectNumber = 1
    const uris = await documentPicker.select(options)
    if (!uris || uris.length === 0) return null
    const uri = uris[0]
    let size = 0
    try {
      size = fs.statSync(uri).size
    } catch (e) {
      // 某些提供方返回的 uri 不支持 stat；大小交给服务端按实际上传判断
    }
    const name = uri.substring(uri.lastIndexOf('/') + 1)
    const picked: PickedFile = { uri: uri, name: name, size: size, mimeType: 'application/octet-stream' }
    return JSON.stringify(picked)
  }

  async download(ctx: AnyThreadTurboModuleContext, url: string, filename: string, headersJson: string): Promise<string> {
    const headers: Record<string, string> = JSON.parse(headersJson) as Record<string, string>
    const req = http.createHttp()
    try {
      const res = await req.request(url, {
        method: http.RequestMethod.GET,
        header: headers,
        expectDataType: http.HttpDataType.ARRAY_BUFFER,
        connectTimeout: 15000,
        readTimeout: 120000,
      })
      if (res.responseCode < 200 || res.responseCode >= 300) {
        throw new Error('HTTP ' + res.responseCode)
      }
      const path = ctx.filesDir + '/' + filename
      const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC)
      fs.writeSync(file.fd, res.result as ArrayBuffer)
      fs.closeSync(file)
      return path
    } finally {
      req.destroy()
    }
  }

  private snapshot(): NodeSnapshot {
    return {
      running: this.running,
      nodeId: this.nodeId,
      phase: this.phase,
      segId: '',
      pct: 0,
      lastError: this.lastError,
      served: this.served,
      earned: this.earned,
      encoder: '',
    }
  }

  private emit(): void {
    const ctx = this.ctx
    if (!ctx) return
    ctx.rnInstance.emitDeviceEvent('StarStackNodeStatus', this.snapshot())
  }

  private fail(message: string): void {
    this.lastError = message
    this.phase = 'error'
    this.emit()
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(() => resolve(), ms))
  }

  private async startLongTask(ctx: AnyThreadTurboModuleContext): Promise<void> {
    const info: wantAgent.WantAgentInfo = {
      wants: [
        {
          bundleName: ctx.abilityInfo.bundleName,
          abilityName: ctx.abilityInfo.name,
        },
      ],
      operationType: wantAgent.OperationType.START_ABILITY,
      requestCode: 0,
      wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
    }
    const agent = await wantAgent.getWantAgent(info)
    await backgroundTaskManager.startBackgroundRunning(ctx, backgroundTaskManager.BackgroundMode.DATA_TRANSFER, agent)
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.hello()
        await this.claim()
        this.phase = 'polling'
        this.emit()
        await this.sleep(3000)
      } catch (e) {
        this.fail(e instanceof Error ? e.message : String(e))
        await this.sleep(5000)
      }
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.secret) h['X-Node-Secret'] = this.secret
    return h
  }

  private async hello(): Promise<void> {
    const body: HelloBody = {
      id: this.nodeId,
      node_name: 'harmony-node',
      name_set: true,
      slots: this.slots,
      price: this.price,
      hostname: 'harmony',
      device_id: 'harmony-' + (deviceInfo.udid || deviceInfo.deviceType),
      os: 'harmony',
      arch: 'arm64',
      cpus: 8,
      mem_mb: 8192,
      disk_free_mb: 0,
      gpus: [],
      // 媒体管线接入前不声明编码器：宁可空闲，也不接自己跑不了的分片。
      encoders: [],
      runtimes: [],
      ffmpeg_version: '',
    }
    const req = http.createHttp()
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (this.secret) headers['X-Node-Secret'] = this.secret
      else headers['X-Launch-Code'] = this.launchCode
      const res = await req.request(this.baseUrl + '/api/worker/hello', {
        method: http.RequestMethod.POST,
        header: headers,
        extraData: JSON.stringify(body),
        connectTimeout: 10000,
        readTimeout: 20000,
      })
      if (res.responseCode < 200 || res.responseCode >= 300) {
        throw new Error('hello HTTP ' + res.responseCode)
      }
      const data = JSON.parse(res.result as string) as HelloResp
      if (data.secret) this.secret = data.secret
      if (data.id) this.nodeId = data.id
      this.phase = 'polling'
      this.lastError = ''
      this.emit()
    } finally {
      req.destroy()
    }
  }

  private async claim(): Promise<void> {
    const req = http.createHttp()
    try {
      const res = await req.request(
        this.baseUrl + '/api/claim?worker=' + encodeURIComponent(this.nodeId) + '&wait=20',
        {
          method: http.RequestMethod.GET,
          header: this.headers(),
          connectTimeout: 10000,
          readTimeout: 30000,
        },
      )
      if (res.responseCode === 204) return
      if (res.responseCode !== 200) {
        throw new Error('claim HTTP ' + res.responseCode)
      }
      const claim = JSON.parse(res.result as string) as Claim
      // 媒体管线尚未接入：立即回报失败，让 Broker 按既有重试/重派逻辑处理，
      // 而不是把分片占着租约到超时。
      await this.reportFailed(claim, 'HarmonyOS 媒体管线尚未接入（AVDemuxer/AVMuxer/AVCodec）')
    } finally {
      req.destroy()
    }
  }

  private async reportFailed(claim: Claim, reason: string): Promise<void> {
    const body: ReportBody = {
      worker: this.nodeId,
      seg: claim.seg_id,
      state: 'failed',
      err: reason,
    }
    const req = http.createHttp()
    try {
      await req.request(this.baseUrl + '/api/report', {
        method: http.RequestMethod.POST,
        header: this.headers(),
        extraData: JSON.stringify(body),
        connectTimeout: 10000,
        readTimeout: 20000,
      })
    } finally {
      req.destroy()
    }
  }
}

export const NodeService: NodeServiceImpl = NodeServiceImpl.instance
