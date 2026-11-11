const { api, f1, f2, QUALITY, getToken } = require('../../utils/api.js')

const KINDS = ['视频转码', 'Blender 渲染']
const QUALITIES = ['快速', '均衡（推荐）', '高质量']
const QUALITY_KEYS = ['fast', 'balanced', 'high']
const ENGINES = ['沿用场景设置', 'CYCLES', 'BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'BLENDER_WORKBENCH']
const ENGINE_VALUES = ['', 'CYCLES', 'BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'BLENDER_WORKBENCH']
const CMD_CHIPS = [
  { label: 'PowerShell', cmd: 'powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1' },
  { label: 'npm build', cmd: 'npm install && npm run build' },
  { label: 'go build', cmd: 'go build -o out/app ./...' },
]
const DROP_HINTS = {
  transcode: '从相册或拍摄选择视频，自动读取时长',
  blender: '聊天文件中的 .zip / .blend',
  build: '聊天文件中的源码 zip',
}

const extOk = (name, kind) => {
  const n = String(name || '').toLowerCase()
  if (kind === 'build' || kind === 'blender') return /\.(zip|blend)$/.test(n) && (kind === 'blender' || /\.zip$/.test(n))
  return /\.(mp4|mov|mkv|avi|webm|m4v)$/.test(n) || n === 'video.mp4'
}
const fmtSize = (n) =>
  n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B'

Page({
  data: {
    svc: 'render',
    kinds: KINDS,
    kindIndex: 0,
    kindName: '视频转码',
    qualities: QUALITIES,
    qualityIndex: 1,
    engines: ENGINES,
    engineIndex: 0,
    cmdChips: CMD_CHIPS,
    command: '',
    output: 'out',
    timeout: '1800',
    dropHint: DROP_HINTS.transcode,
    file: null,
    fileSize: '',
    duration: 0,
    scene: '',
    samples: '0',
    from: '1',
    to: '120',
    fps: '24',
    percent: '0',
    step1: 'cur',
    step2: '',
    step3: '',
    quote: null,
    quoteErr: '选择文件后自动估算',
    msg: '',
    busy: false,
    progress: 0,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    if (!getToken()) {
      wx.reLaunch({ url: '/pages/login/index' })
      return
    }
    this.quote()
  },

  onHide() {
    clearTimeout(this._qt)
  },

  onUnload() {
    clearTimeout(this._qt)
  },

  kind() {
    return this.data.svc === 'build' ? 'build' : this.data.kindIndex === 1 ? 'blender' : 'transcode'
  },

  refreshSteps() {
    const k = this.kind()
    const hasFile = !!this.data.file
    const cfg = k === 'build' ? !!String(this.data.command || '').trim() : true
    const ready = hasFile && cfg && (k === 'build' || !!(this.data.quote && this.data.quote.ok))
    this.setData({
      step1: hasFile ? 'done' : 'cur',
      step2: hasFile ? (cfg ? 'done' : 'cur') : '',
      step3: ready ? 'cur' : '',
      kindName: k === 'build' ? '编译打包' : KINDS[this.data.kindIndex],
      dropHint: DROP_HINTS[k],
    })
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.k]: e.detail.value }, () => {
      this.refreshSteps()
      this.debounceQuote()
    })
  },

  onSvc(e) {
    const svc = e.currentTarget.dataset.svc
    if (svc === this.data.svc) return
    const keep = this.data.file && extOk(this.data.file.name, svc === 'build' ? 'build' : this.data.kindIndex === 1 ? 'blender' : 'transcode')
    this.setData({ svc, file: keep ? this.data.file : null, fileSize: keep ? this.data.fileSize : '', quote: null, msg: '' }, () => {
      this.refreshSteps()
      this.quote()
    })
  },

  onKindCard(e) {
    const idx = Number(e.currentTarget.dataset.k)
    const keep = this.data.file && extOk(this.data.file.name, idx === 1 ? 'blender' : 'transcode')
    this.setData({ kindIndex: idx, file: keep ? this.data.file : null, fileSize: keep ? this.data.fileSize : '', quote: null, msg: '' }, () => {
      this.refreshSteps()
      this.debounceQuote()
    })
  },

  onKind(e) {
    this.onKindCard({ currentTarget: { dataset: { k: e.detail.value } } })
  },

  onQuality(e) {
    this.setData({ qualityIndex: Number(e.detail.value) }, () => this.debounceQuote())
  },

  onEngine(e) {
    this.setData({ engineIndex: Number(e.detail.value) })
  },

  onCmdChip(e) {
    this.setData({ command: e.currentTarget.dataset.cmd }, () => this.refreshSteps())
  },

  removeFile() {
    this.setData({ file: null, fileSize: '', duration: 0, quote: null }, () => {
      this.refreshSteps()
      this.quote()
    })
  },

  chooseFile() {
    const k = this.kind()
    if (k === 'transcode') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['video'],
        sourceType: ['album', 'camera'],
        success: (r) => {
          const f = r.tempFiles[0]
          this.setData(
            { file: { path: f.tempFilePath, name: 'video.mp4', size: f.size }, fileSize: fmtSize(f.size), duration: Math.round(f.duration || 0), quote: null, msg: '' },
            () => {
              this.refreshSteps()
              this.quote()
            },
          )
        },
      })
      return
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: k === 'build' ? ['zip'] : ['zip', 'blend'],
      success: (r) => {
        const f = r.tempFiles[0]
        this.setData({ file: { path: f.path, name: f.name, size: f.size }, fileSize: fmtSize(f.size), quote: null, msg: '' }, () => {
          this.refreshSteps()
          this.quote()
        })
      },
    })
  },

  debounceQuote() {
    clearTimeout(this._qt)
    this._qt = setTimeout(() => this.quote(), 350)
  },

  units() {
    const a = Number(this.data.from || 0)
    const b = Number(this.data.to || 0)
    return b - a + 1
  },

  decorate(q, head) {
    return {
      ...q,
      head: head || '',
      holdText: f2(q.hold),
      balanceText: f2(q.balance),
      priceText: f2(q.hold_price),
      ok: !!(q.affordable && q.eligible > 0),
    }
  },

  async quote() {
    const kind = this.kind()
    if (kind === 'build') {
      this.setData({ quote: null, quoteErr: '' }, () => this.refreshSteps())
      return
    }
    if (kind === 'blender') {
      const n = this.units()
      if (!(n > 0)) {
        this.setData({ quote: null, quoteErr: '填写起止帧后按帧数估算' }, () => this.refreshSteps())
        return
      }
      try {
        const q = await api.estimate({ duration: n, kind: 'blender', vcodec: 'libx264', req: {} })
        this.setData({ quote: this.decorate(q, `第 ${this.data.from}~${this.data.to} 帧，共 ${n} 帧`), quoteErr: '' }, () => this.refreshSteps())
      } catch (e) {
        this.setData({ quote: null, quoteErr: '估算失败：' + (e.message || e) }, () => this.refreshSteps())
      }
      return
    }
    const dur = Number(this.data.duration || 0)
    if (!(dur > 0)) {
      this.setData({ quote: null, quoteErr: '选择视频后自动估算' }, () => this.refreshSteps())
      return
    }
    try {
      const q = await api.estimate({ duration: dur, vcodec: 'libx264', req: {} })
      this.setData({ quote: this.decorate(q, `时长 ${dur} 秒`), quoteErr: '' }, () => this.refreshSteps())
    } catch (e) {
      this.setData({ quote: null, quoteErr: '估算失败：' + (e.message || e) }, () => this.refreshSteps())
    }
  },

  async submit() {
    if (!this.data.file) return wx.showToast({ title: '请先选择文件', icon: 'none' })
    const kind = this.kind()
    if (kind === 'build' && !String(this.data.command || '').trim()) {
      return wx.showToast({ title: '请填写编译命令', icon: 'none' })
    }
    const preset = QUALITY[QUALITY_KEYS[this.data.qualityIndex]] || QUALITY.balanced
    const formData =
      kind === 'build'
        ? {
            req: '{}',
            command: String(this.data.command).trim(),
            output: String(this.data.output || '').trim(),
            timeout: String(this.data.timeout || '1800'),
          }
        : kind === 'blender'
          ? {
              req: '{}',
              segs: '4',
              kind: 'blender',
              scene: this.data.scene,
              engine: ENGINE_VALUES[this.data.engineIndex],
              samples: this.data.samples,
              from: this.data.from,
              to: this.data.to,
              percent: this.data.percent,
              fps: this.data.fps,
            }
          : { req: '{}', segs: '4', vcodec: preset.vcodec, preset: preset.preset, q: preset.q, height: '0', audio: '1', baseline: '0' }

    this.setData({ busy: true, progress: 0, msg: '上传中…' })
    const form = {
      filePath: this.data.file.path,
      name: 'file',
      formData,
      onProgress: (p) => this.setData({ progress: p, msg: `上传中 ${p}%` }),
    }
    try {
      const r = kind === 'build' ? await api.submitBuild(form) : kind === 'blender' ? await api.submitRender(form) : await api.submitTranscode(form)
      const detail = kind === 'blender' ? `（${r.pieces} 段 / ${f1(r.units)} ${r.unit}）` : ''
      this.setData({ busy: false, msg: `已入队 ${r.id}${detail}，预扣 ${f2(r.hold)} 点` })
      wx.showToast({ title: kind === 'build' ? '编排任务已提交' : '任务已提交', icon: 'success' })
      setTimeout(() => wx.switchTab({ url: '/pages/jobs/index' }), 600)
    } catch (e) {
      this.setData({ busy: false, msg: '失败：' + (e.message || e) })
    }
  },
})