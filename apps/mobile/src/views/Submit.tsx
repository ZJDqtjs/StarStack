import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../ctx'
import { Btn, Card, Field, Tag } from '../ui'
import { f1, f2 } from '../../../shared/index.js'
import { QUALITY } from '../../../shared/constants.js'

const DEFAULTS = {
  segs: '4',
  path: '',
  vcodec: 'libx264',
  preset: 'fast',
  q: '26',
  height: '0',
  audio: '1',
  need_gpu: '0',
  min_gpu_mem: '0',
  min_cpus: '0',
  min_mem: '0',
  runtime: '',
  arch: '',
  max_price: '0',
  duration: '0',
  baseline: true,
  scene: '',
  engine: '',
  samples: '0',
  from: '1',
  to: '120',
  percent: '0',
  fps: '24',
  command: '',
  output: 'out',
  timeout: '1800',
}

const KIND_NAME: Record<string, string> = { transcode: '视频转码', blender: 'Blender 渲染', pr: '时间线渲染', build: '编译打包' }
const KIND_CARDS = [
  { k: 'transcode', name: '视频转码', desc: '切片并行加速，哈希校验一致性', tag: '按视频秒结算', icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3V9Z" /></> },
  { k: 'blender', name: 'Blender 渲染', desc: '帧级拆分到多节点，Cycles / Eevee', tag: '按帧结算', icon: <><path d="M12 3l9 5-9 5-9-5 9-5Z" /><path d="M3 12l9 5 9-5M3 16l9 5 9-5" /></> },
  { k: 'pr', name: '时间线渲染', desc: 'Premiere FCPXML 工程整线输出', tag: '按时间线秒结算', icon: <><path d="M4 6h16M4 12h10M4 18h14" /><circle cx="18" cy="12" r="2" /></> },
]
const DROP_HINT: Record<string, string> = {
  transcode: '视频 / 音频文件，自动读取时长',
  blender: '.blend 场景，或含贴图 / 缓存的 zip',
  pr: 'FCPXML 工程 + 全部素材打包的 zip',
  build: '源码 zip，解压目录即工作目录',
}
const CMD_CHIPS = [
  { label: 'PowerShell 脚本', cmd: 'powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1' },
  { label: 'npm build', cmd: 'npm install && npm run build' },
  { label: 'go build', cmd: 'go build -o out/app ./...' },
  { label: 'cmake', cmd: 'cmake -B build && cmake --build build --config Release' },
]
const extOk = (name: string, k: string) => {
  const n = name.toLowerCase()
  if (k === 'build' || k === 'pr') return /\.zip$/.test(n)
  if (k === 'blender') return /\.(blend|zip)$/.test(n)
  return /\.(mp4|mov|mkv|avi|webm|flv|wmv|m4v|ts|mp3|wav|aac|flac|m4a|ogg|wma)$/.test(n)
}
const fileSize = (n: number) =>
  n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B'

/* 编排页：选择项目文件夹后在浏览器内打标准 zip（STORE），仍走 /api/jobs/build */
const SKIP_DIR = /^(node_modules|\.git|\.gradle|\.idea|\.vscode|__pycache__|\.next|\.nuxt|\.cache|\.pytest_cache|venv|\.venv|env)$/i
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (u8: Uint8Array) => {
  let c = 0xffffffff
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function zipStore(files: { path: string; data: Uint8Array }[]) {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = []
  let offset = 0
  const u16 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255])
  const u32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255])
  for (const f of files) {
    const name = enc.encode(f.path)
    const data = f.data
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    local.set(u32(0x04034b50), 0); local.set(u16(20), 4); local.set(u16(0x0800), 6)
    local.set(u16(0), 8); local.set(u16(0), 10); local.set(u16(0), 12)
    local.set(u32(crc), 14); local.set(u32(data.length), 18); local.set(u32(data.length), 22)
    local.set(u16(name.length), 26); local.set(u16(0), 28); local.set(name, 30)
    parts.push(local, data)
    central.push({ name, crc, size: data.length, offset })
    offset += 30 + name.length + data.length
  }
  let cdSize = 0
  const cds: Uint8Array[] = []
  for (const c of central) {
    const e = new Uint8Array(46 + c.name.length)
    e.set(u32(0x02014b50), 0); e.set(u16(20), 4); e.set(u16(20), 6); e.set(u16(0x0800), 8)
    e.set(u16(0), 10); e.set(u16(0), 12); e.set(u16(0), 14)
    e.set(u32(c.crc), 16); e.set(u32(c.size), 20); e.set(u32(c.size), 24)
    e.set(u16(c.name.length), 28); e.set(u16(0), 30); e.set(u16(0), 32)
    e.set(u16(0), 34); e.set(u16(0), 36); e.set(u32(0), 38); e.set(u32(c.offset), 42)
    e.set(c.name, 46)
    cds.push(e); cdSize += e.length
  }
  const eocd = new Uint8Array(22)
  eocd.set(u32(0x06054b50), 0); eocd.set(u16(0), 4); eocd.set(u16(0), 6)
  eocd.set(u16(central.length), 8); eocd.set(u16(central.length), 10)
  eocd.set(u32(cdSize), 12); eocd.set(u32(offset), 16); eocd.set(u16(0), 20)
  return new Blob([...parts, ...cds, eocd] as BlobPart[], { type: 'application/zip' })
}
async function packFolder(files: FileList) {
  const list = [...files]
  if (!list.length) throw new Error('没有选择文件')
  const root = (list[0].webkitRelativePath || '').split('/')[0] || 'project'
  const picked: { path: string; file: File }[] = []
  for (const f of list) {
    const rel = (f.webkitRelativePath || '').split('/').slice(1).join('/')
    if (!rel) continue
    if (rel.split('/').some(s => SKIP_DIR.test(s))) continue
    if (/(^|\/)(Thumbs\.db|\.DS_Store)$/i.test(rel)) continue
    picked.push({ path: rel, file: f })
  }
  if (!picked.length) throw new Error('文件夹里没有可打包的文件')
  const total = picked.reduce((a, e) => a + e.file.size, 0)
  if (total > 400 * 1024 * 1024) throw new Error('文件夹超过 400MB，请清理构建产物或改用 zip')
  const packed: { path: string; data: Uint8Array }[] = []
  for (const e of picked) packed.push({ path: e.path, data: new Uint8Array(await e.file.arrayBuffer()) })
  return { blob: zipStore(packed), root, count: picked.length, total }
}

export default function Submit() {
  const { api, policy, view, setView, showToast, targetNode, setTargetNode, workers } = useApp()
  const svc = view === 'build' ? 'build' : 'render'
  const [kind, setKind] = useState('blender')
  const [quality, setQuality] = useState('balanced')
  const [adv, setAdv] = useState(false)
  const [advOpen, setAdvOpen] = useState(false)
  const [f, setF] = useState<any>({ ...DEFAULTS })
  const [file, setFile] = useState<File | null>(null)
  const [drag, setDrag] = useState(false)
  const [folderInfo, setFolderInfo] = useState('')
  const [quote, setQuote] = useState<any>(null)
  const [quoteErr, setQuoteErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const timer = useRef<any>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const set = (k: string, v: any) => setF((prev: any) => ({ ...prev, [k]: v }))

  useEffect(() => {
    api
      .settings()
      .then((d: any) => {
        setAdv(!!d.advanced)
        setAdvOpen(!!d.advanced)
      })
      .catch(() => {})
  }, [api])

  // 与 Web 控制台一致：编排页固定 build，渲染页保留 pr 否则回到 blender
  useEffect(() => {
    setKind((prev) => (svc === 'build' ? 'build' : prev === 'pr' ? 'pr' : 'blender'))
    setMsg('')
  }, [svc])

  // 跨类型不携带不兼容素材
  useEffect(() => {
    if (file && !extOk(file.name, kind)) {
      if (extOk(file.name, 'transcode')) set('duration', '0')
      setFile(null)
      setFolderInfo('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  const applyQuality = (q: string) => {
    const preset = QUALITY[q] || QUALITY.balanced
    setF((prev: any) => ({ ...prev, ...preset }))
  }

  useEffect(() => {
    if (!adv && kind === 'transcode') applyQuality(quality)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, adv, kind])

  const isRender = kind !== 'transcode'
  const units = useMemo(() => {
    if (kind === 'blender') {
      const a = Number(f.from || 0)
      const b = Number(f.to || 0)
      return b - a + 1
    }
    return 0
  }, [kind, f.from, f.to])

  const req = () => {
    const r: any = {}
    if (f.need_gpu === '1') r.need_gpu = true
    if (Number(f.min_gpu_mem) > 0) r.min_gpu_mem_mb = Number(f.min_gpu_mem)
    if (Number(f.min_cpus) > 0) r.min_cpus = Number(f.min_cpus)
    if (Number(f.min_mem) > 0) r.min_mem_mb = Number(f.min_mem)
    if (Number(f.max_price) > 0) r.max_price = Number(f.max_price)
    if (f.runtime) r.runtime = f.runtime
    if (f.arch) r.arch = f.arch
    if (targetNode) r.node_id = targetNode.id
    return r
  }

  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      if (kind === 'build') {
        setQuote(null)
        setQuoteErr('')
        return
      }
      try {
        const duration = Number(f.duration || 0)
        const d = kind === 'blender' ? units : kind === 'pr' ? 1 : 0
        if (kind === 'blender' && !(units > 0)) {
          setQuote(null)
          setQuoteErr('填写起止帧后按帧数估算')
          return
        }
        if (kind === 'transcode' && !(duration > 0)) {
          setQuote(null)
          setQuoteErr('填视频时长或选择文件后自动估算')
          return
        }
        const q = isRender ? await api.estimate({ duration: d, kind, vcodec: 'libx264', req: req() }) : await api.estimate({ duration, vcodec: f.vcodec, req: req() })
        setQuote(q)
        setQuoteErr('')
      } catch (e: any) {
        setQuote(null)
        setQuoteErr('估算失败：' + (e.message || e))
      }
    }, 320)
    return () => clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, f.duration, f.vcodec, f.segs, f.need_gpu, f.min_gpu_mem, f.min_cpus, f.min_mem, f.max_price, f.runtime, f.arch, units])

  const pickFile = (picked: File | null) => {
    setFile(picked)
    setFolderInfo('')
    setMsg('')
    if (picked && kind === 'transcode') {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => {
        if (Number.isFinite(v.duration) && v.duration > 0) set('duration', String(Math.round(v.duration)))
      }
      v.src = URL.createObjectURL(picked)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    const picked = e.dataTransfer.files && e.dataTransfer.files[0]
    if (!picked) return
    if (!extOk(picked.name, kind)) {
      setMsg('文件类型不匹配：' + DROP_HINT[kind])
      return
    }
    pickFile(picked)
  }

  const submit = async () => {
    if (!file && !(kind === 'transcode' && policy?.local_path && f.path)) {
      return showToast('请选择文件', 'bad')
    }
    setBusy(true)
    setMsg('上传并登记任务中…')
    try {
      if (kind === 'build') {
        if (!String(f.command || '').trim()) {
          setBusy(false)
          setMsg('')
          return showToast('请填写编译命令', 'bad')
        }
        const fd = new FormData()
        fd.set('req', JSON.stringify(req()))
        fd.set('file', file!)
        fd.set('command', String(f.command).trim())
        fd.set('output', String(f.output || '').trim())
        fd.set('timeout', String(f.timeout || '1800'))
        const r = await api.submitBuild(fd)
        setMsg(`已入队 ${r.id}，预扣 ${f2(r.hold)} 点（按实际分钟结算）`)
        setTargetNode(null)
        showToast('编译任务已提交')
        setTimeout(() => setView('jobs'), 500)
        return
      }
      const fd = new FormData()
      fd.set('req', JSON.stringify(req()))
      fd.set('segs', String(f.segs || 4))
      if (file) fd.set('file', file)
      if (kind === 'transcode') {
        if (policy?.local_path && f.path) fd.set('path', f.path)
        fd.set('vcodec', f.vcodec)
        fd.set('preset', f.preset)
        fd.set('q', f.q)
        fd.set('height', f.height)
        fd.set('audio', f.audio)
        fd.set('baseline', f.baseline ? '1' : '0')
        const r = await api.submitTranscode(fd)
        setMsg(`已入队 ${r.id}，预扣 ${f2(r.hold)} 点`)
      } else {
        fd.set('kind', kind)
        if (kind === 'blender') {
          fd.set('scene', f.scene)
          fd.set('engine', f.engine)
          fd.set('samples', f.samples)
          fd.set('from', f.from)
          fd.set('to', f.to)
          fd.set('percent', f.percent)
          fd.set('fps', f.fps)
        }
        const r = await api.submitRender(fd)
        setMsg(`已入队 ${r.id}（${r.pieces} 段 / ${f1(r.units)} ${r.unit}），预扣 ${f2(r.hold)} 点`)
      }
      setTargetNode(null)
      showToast('任务已提交')
      setTimeout(() => setView('jobs'), 500)
    } catch (e: any) {
      setMsg('失败：' + (e.message || e))
      showToast('提交失败：' + (e.message || e), 'bad')
    } finally {
      setBusy(false)
    }
  }

  const ok = quote && quote.affordable && quote.eligible > 0
  const online = workers.filter((w: any) => w.online)
  const freeSlots = online.reduce((a: number, w: any) => a + Math.max(0, (w.slots || 0) - (w.active || 0)), 0)
  const prices = online.map((w: any) => Number(w.price) || 0).filter((p: number) => p > 0)
  const minPrice = prices.length ? Math.min(...prices) : null
  const cfgDone = kind === 'build' ? !!String(f.command || '').trim() : true
  const stepCls = (n: number) => {
    if (n === 1) return file ? 'done' : 'cur'
    if (n === 2) return file ? (cfgDone ? 'done' : 'cur') : ''
    return file && cfgDone && (kind === 'build' || ok) ? 'cur' : ''
  }
  const head =
    kind === 'blender'
      ? `第 ${f.from}~${f.to} 帧 · 共 ${units} 帧`
      : kind === 'pr'
        ? '时间线时长由工程决定，按每秒报价'
        : `时长 ${f1(Number(f.duration || 0))} 秒`

  return (
    <div className="stack">
      <div className={'wb-pagehead' + (svc === 'build' ? ' wb-pagehead-build' : '')}>
        <div className="wb-pagehead-ic">
          <svg viewBox="0 0 24 24">
            {svc === 'build' ? (
              <>
                <circle cx="6" cy="6" r="2" />
                <circle cx="18" cy="18" r="2" />
                <path d="M6 8v6a4 4 0 0 0 4 4h6" />
              </>
            ) : (
              <>
                <path d="M12 3l9 5-9 5-9-5 9-5Z" />
                <path d="M3 12l9 5 9-5M3 16l9 5 9-5" />
              </>
            )}
          </svg>
        </div>
        <div className="wb-pagehead-txt">
          <span className="wb-eyebrow">{svc === 'build' ? 'Pipeline · Orchestration' : 'Render Studio'}</span>
          <h1>{svc === 'build' ? '任务编排' : '渲染工作台'}</h1>
          <p>
            {svc === 'build'
              ? '源码 zip 上传后由算力节点执行编译 / 打包命令，产物按输出目录回传；按墙钟分钟结算，失败不结算。'
              : 'Blender 帧渲染、剪辑时间线与视频转码共用一套提交流程；参数在本页填写，提交后按实测用量结算。'}
          </p>
        </div>
        <Btn variant="ghost" tiny onClick={() => setView('jobs')}>
          我的任务 →
        </Btn>
      </div>

      {svc === 'build' && (
        <div className="wb-pipe">
          <div className="wb-pipe-step">
            <span className="wb-pipe-ic">
              <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0l-4 4m4-4l4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
            </span>
            <b>① 上传源码</b>
            <span>zip 打包上传，解压后的目录就是工作目录</span>
          </div>
          <i className="wb-pipe-line" />
          <div className="wb-pipe-step">
            <span className="wb-pipe-ic">
              <svg viewBox="0 0 24 24"><path d="M4 7l4 5-4 5M12 19h8" /></svg>
            </span>
            <b>② 节点编译</b>
            <span>开启 --allow-build 的节点执行命令，按墙钟分钟计费</span>
          </div>
          <i className="wb-pipe-line" />
          <div className="wb-pipe-step">
            <span className="wb-pipe-ic">
              <svg viewBox="0 0 24 24"><path d="M12 4v12m0 0l-4-4m4 4l4-4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
            </span>
            <b>③ 产物回传</b>
            <span>输出目录打包 result.zip，校验后在我的任务下载</span>
          </div>
        </div>
      )}

      <div className="nx-kpis">
        <div className="nx-kpi"><span>在线节点</span><b>{online.length}</b><i>◉</i></div>
        <div className="nx-kpi"><span>空闲槽位</span><b>{freeSlots}</b><i>▦</i></div>
        <div className="nx-kpi"><span>最低单价</span><b>{minPrice === null ? '—' : f2(minPrice) + ' 点/秒'}</b><i>◈</i></div>
      </div>

      {svc === 'build' && (
        <div className="wb-tip">
          接收编排任务需要节点以 <code>--allow-build</code> 启动，且账号在编译白名单内；提交后预扣 10 分钟，编译失败不结算、差额自动退还。
        </div>
      )}

      {targetNode && svc === 'render' && (
        <Card kicker="Target" title="已指定节点">
          <div className="hint">
            本次任务只会派发给 <b>{targetNode.name || targetNode.id}</b>（{targetNode.id}）。它离线时会排队等待上线。
          </div>
          <div className="btnrow">
            <Btn variant="ghost" tiny onClick={() => setTargetNode(null)}>
              取消指定
            </Btn>
          </div>
        </Card>
      )}

      <div className="wb-grid">
        <Card kicker="New Task" title={svc === 'build' ? '提交编排任务' : '提交渲染任务'}>
          <div className="wb-steps">
            <span className={'wb-step ' + stepCls(1)}><b>1</b>上传素材</span>
            <i className="wb-step-line" />
            <span className={'wb-step ' + stepCls(2)}><b>2</b>配置参数</span>
            <i className="wb-step-line" />
            <span className={'wb-step ' + stepCls(3)}><b>3</b>提交结算</span>
          </div>

          {svc === 'render' && (
            <div className="wb-kinds">
              {KIND_CARDS.map((c) => (
                <button key={c.k} type="button" className={'wb-kind' + (kind === c.k ? ' on' : '')} onClick={() => setKind(c.k)}>
                  <span className="wb-kind-ic"><svg viewBox="0 0 24 24">{c.icon}</svg></span>
                  <b>{c.name}</b>
                  <span>{c.desc}</span>
                  <span className="wb-kind-tag">{c.tag}</span>
                </button>
              ))}
            </div>
          )}

          {kind === 'transcode' && !adv && (
            <Field label="画质">
              <select className="in" value={quality} onChange={(e) => setQuality(e.target.value)}>
                <option value="fast">快速</option>
                <option value="balanced">均衡（推荐）</option>
                <option value="high">高质量</option>
              </select>
            </Field>
          )}

          <div className="wb-sec"><i>1</i>上传素材<small>支持拖拽上传</small></div>
          {kind === 'build' && (
            <div className="wb-pick">
              <Btn onClick={() => folderInput.current?.click()}>选择项目文件夹</Btn>
              <span className="wb-pick-or">自动打包为 zip，排除 node_modules / .git 等目录</span>
            </div>
          )}
          <input
            ref={folderInput}
            type="file"
            style={{ display: 'none' }}
            {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
            onChange={async (e) => {
              const files = e.target.files
              if (!files || !files.length) return
              setMsg('正在打包文件夹…')
              try {
                const r = await packFolder(files)
                const f = new File([r.blob], r.root + '.zip', { type: 'application/zip' })
                setFile(f)
                setFolderInfo(`来自文件夹「${r.root}」· ${r.count} 个文件 · ${fileSize(r.total)}（已打包为 ${f.name}）`)
                setMsg('')
              } catch (err: any) {
                setMsg('打包失败：' + (err.message || err))
              } finally {
                if (folderInput.current) folderInput.current.value = ''
              }
            }}
          />
          <div
            className={'wb-drop' + (file ? ' has-file' : '') + (drag ? ' drag' : '')}
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInput.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
          >
            <input
              ref={fileInput}
              type="file"
              style={{ display: 'none' }}
              accept={kind === 'build' ? '.zip' : kind === 'blender' ? '.blend,.zip' : kind === 'pr' ? '.zip' : 'video/*,audio/*'}
              onChange={(e) => pickFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
            />
            {file ? (
              <div className="wb-file">
                <span className="wb-file-ic">
                  <svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" /><path d="M14 3v6h6" /></svg>
                </span>
                <span className="wb-file-name">{file.name}</span>
                <span className="wb-file-size">{fileSize(file.size)}</span>
                <button
                  type="button"
                  className="wb-file-x"
                  aria-label="移除文件"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (kind === 'transcode') set('duration', '0')
                    pickFile(null)
                    if (fileInput.current) fileInput.current.value = ''
                  }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="wb-drop-ph">
                <span className="wb-drop-ic">
                  <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0l-4 4m4-4l4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
                </span>
                <b>拖拽文件到此处，或点击选择</b>
                <span>{DROP_HINT[kind]}</span>
              </div>
            )}
          </div>
          {file && folderInfo && <div className="hint" style={{ marginTop: 8 }}>{folderInfo}</div>}

          {kind === 'blender' && (
            <>
              <div className="wb-sec"><i>2</i>场景与输出<small>Blender</small></div>
              <div className="row">
                <Field label="场景文件（zip 内可省略）">
                  <input className="in" value={f.scene} onChange={(e) => set('scene', e.target.value)} placeholder="scene.blend" />
                </Field>
                <Field label="渲染引擎">
                  <select className="in" value={f.engine} onChange={(e) => set('engine', e.target.value)}>
                    <option value="">沿用场景设置</option>
                    <option value="CYCLES">CYCLES</option>
                    <option value="BLENDER_EEVEE_NEXT">BLENDER_EEVEE_NEXT</option>
                    <option value="BLENDER_EEVEE">BLENDER_EEVEE</option>
                    <option value="BLENDER_WORKBENCH">BLENDER_WORKBENCH</option>
                  </select>
                </Field>
              </div>
              <div className="row3">
                <Field label="起始帧">
                  <input className="in" inputMode="numeric" value={f.from} onChange={(e) => set('from', e.target.value)} />
                </Field>
                <Field label="结束帧">
                  <input className="in" inputMode="numeric" value={f.to} onChange={(e) => set('to', e.target.value)} />
                </Field>
                <Field label="帧率">
                  <input className="in" inputMode="decimal" value={f.fps} onChange={(e) => set('fps', e.target.value)} />
                </Field>
              </div>
              <div className="row">
                <Field label="采样数（0=场景）">
                  <input className="in" inputMode="numeric" value={f.samples} onChange={(e) => set('samples', e.target.value)} />
                </Field>
                <Field label="分辨率百分比（0=场景）">
                  <input className="in" inputMode="numeric" value={f.percent} onChange={(e) => set('percent', e.target.value)} />
                </Field>
              </div>
            </>
          )}

          {kind === 'pr' && (
            <div className="hint" style={{ marginTop: 12 }}>
              上传 zip：从 Premiere 导出 Final Cut Pro XML（或 FCPXML），连同所有素材一起打包。
            </div>
          )}

          {kind === 'build' && (
            <>
              <div className="wb-sec"><i>2</i>编译配置<small>zip → result.zip</small></div>
              <div className="hint">上传源码 zip；解压后的目录就是工作目录，命令在其中执行，产物按「输出目录」打包成 result.zip 回传。</div>
              <Field label="编译命令">
                <div className="wb-cmd">
                  <span className="wb-cmd-ps">$</span>
                  <input className="in" value={f.command} onChange={(e) => set('command', e.target.value)} placeholder="powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1" />
                </div>
              </Field>
              <div className="wb-cmd-chips">
                {CMD_CHIPS.map((c) => (
                  <button key={c.label} type="button" className="wb-cmd-chip" onClick={() => set('command', c.cmd)}>
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="row">
                <Field label="输出目录（相对路径）">
                  <input className="in" value={f.output} onChange={(e) => set('output', e.target.value)} placeholder="out" />
                </Field>
                <Field label="超时（秒）">
                  <input className="in" inputMode="numeric" value={f.timeout} onChange={(e) => set('timeout', e.target.value)} />
                </Field>
              </div>
              <div className="hint">按实际墙钟分钟结算，预扣 10 分钟；编译失败不结算。</div>
            </>
          )}

          {kind === 'transcode' && adv && (
            <>
              <div className="wb-sec"><i>2</i>编码参数<small>Transcode</small></div>
              <div className="row3">
                <Field label="编码器">
                  <select className="in" value={f.vcodec} onChange={(e) => set('vcodec', e.target.value)}>
                    <option value="h264_nvenc">h264_nvenc</option>
                    <option value="hevc_nvenc">hevc_nvenc</option>
                    <option value="libx264">libx264</option>
                    <option value="libx265">libx265</option>
                  </select>
                </Field>
                <Field label="preset">
                  <select className="in" value={f.preset} onChange={(e) => set('preset', e.target.value)}>
                    {['ultrafast', 'veryfast', 'fast', 'medium', 'slow'].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <Field label="QP / CRF">
                  <input className="in" inputMode="numeric" value={f.q} onChange={(e) => set('q', e.target.value)} />
                </Field>
              </div>
              <div className="row">
                <Field label="目标高度（0=原始）">
                  <input className="in" inputMode="numeric" value={f.height} onChange={(e) => set('height', e.target.value)} />
                </Field>
                <Field label="音轨">
                  <select className="in" value={f.audio} onChange={(e) => set('audio', e.target.value)}>
                    <option value="1">保留</option>
                    <option value="0">丢弃</option>
                  </select>
                </Field>
              </div>
            </>
          )}

          {(adv || kind !== 'transcode') && (
            <div className={'wb-adv' + (advOpen ? ' open' : '')}>
              <button type="button" className="wb-adv-head" onClick={() => setAdvOpen(!advOpen)}>
                高级设置 · 硬件约束与调度偏好
              </button>
              {advOpen && (
                <div className="wb-adv-body">
                  {kind !== 'build' && (
                    <Field label="切分片数">
                      <input className="in" inputMode="numeric" value={f.segs} onChange={(e) => set('segs', e.target.value)} />
                    </Field>
                  )}
                  {kind === 'transcode' && policy?.local_path && (
                    <Field label="或使用服务端本机路径">
                      <input className="in" value={f.path} onChange={(e) => set('path', e.target.value)} placeholder="D:/videos/input.mp4" />
                    </Field>
                  )}
                  {kind === 'transcode' && (
                    <Field label="视频时长（估费用，秒）">
                      <input className="in" inputMode="decimal" value={f.duration} onChange={(e) => set('duration', e.target.value)} />
                    </Field>
                  )}
                  <div className="row">
                    <Field label="需要独显">
                      <select className="in" value={f.need_gpu} onChange={(e) => set('need_gpu', e.target.value)}>
                        <option value="0">不限</option>
                        <option value="1">必须有 GPU</option>
                      </select>
                    </Field>
                    <Field label="最小显存 MB">
                      <input className="in" inputMode="numeric" value={f.min_gpu_mem} onChange={(e) => set('min_gpu_mem', e.target.value)} />
                    </Field>
                  </div>
                  <div className="row">
                    <Field label="最少 CPU 核">
                      <input className="in" inputMode="numeric" value={f.min_cpus} onChange={(e) => set('min_cpus', e.target.value)} />
                    </Field>
                    <Field label="最小内存 MB">
                      <input className="in" inputMode="numeric" value={f.min_mem} onChange={(e) => set('min_mem', e.target.value)} />
                    </Field>
                  </div>
                  <div className="row">
                    <Field label="要求运行时">
                      <select className="in" value={f.runtime} onChange={(e) => set('runtime', e.target.value)}>
                        <option value="">不限</option>
                        <option value="ffmpeg">ffmpeg</option>
                        <option value="blender">blender</option>
                        <option value="cuda">cuda</option>
                        <option value="docker">docker</option>
                        <option value="python">python</option>
                      </select>
                    </Field>
                    <Field label="系统架构">
                      <select className="in" value={f.arch} onChange={(e) => set('arch', e.target.value)}>
                        <option value="">不限</option>
                        <option value="amd64">amd64</option>
                        <option value="arm64">arm64</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="单价上限 点/单位（0=不限）">
                    <input className="in" inputMode="decimal" value={f.max_price} onChange={(e) => set('max_price', e.target.value)} />
                  </Field>
                  {kind === 'transcode' && !policy?.public && (
                    <label className="check">
                      <input type="checkbox" checked={f.baseline} onChange={(e) => set('baseline', e.target.checked)} />
                      同时跑单机基线（用于真实加速比对比）
                    </label>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="wb-side">
          <Card kicker="Summary" title="费用摘要">
            <div className="wb-sumrows">
              <div className="wb-sumrow"><span>任务类型</span><b>{KIND_NAME[kind]}</b></div>
              <div className="wb-sumrow"><span>素材</span><b title={file ? file.name : ''}>{file ? file.name : kind === 'transcode' && f.path ? f.path : '未选择'}</b></div>
            </div>
            {kind === 'build' ? (
              <div className="q-note">编译任务按实际墙钟分钟结算，预扣 <b>10</b> 分钟；编译失败不结算，差额自动退还。</div>
            ) : quote ? (
              <>
                <div className="q-line">{head} · 可用节点 <b>{quote.eligible}</b> 台</div>
                <div className={'q-total' + (ok ? '' : ' no')}>
                  <span>{kind === 'blender' ? '预扣' : kind === 'pr' ? '每秒预扣' : '预扣'}</span>
                  <span className="big">{f2(quote.hold)}</span>
                  <span className="q-unit">点</span>
                  <span className="q-basis">{quote.hold_basis} {f2(quote.hold_price)} 点/{quote.unit}{kind === 'transcode' && quote.cheapest !== undefined ? ` · 最省 ${f2(quote.cheapest)} 点` : ''}</span>
                </div>
                <div className="q-line">余额 {f2(quote.balance)} 点 {quote.affordable ? '· 足够' : <span className="no">· 不足，请到账单页充值</span>}</div>
                {quote.first_pick && kind === 'transcode' && (
                  <div className="q-line q-faint">首片预计派给 {quote.first_pick.name}（{f2(quote.first_pick.price)} 点/秒）</div>
                )}
                {quote.nodes && quote.nodes.length > 0 ? (
                  <div className="q-nodes">
                    {quote.nodes.map((n: any, i: number) => (
                      <Tag key={i} tone={n.mine ? 'link' : ''}>{n.name} · {f2(n.price)} 点/{quote.unit}</Tag>
                    ))}
                  </div>
                ) : (
                  <div className="q-warn">没有在线节点满足要求，任务会排队等待匹配的算力上线。</div>
                )}
              </>
            ) : (
              <div className="q-note">{quoteErr || '选择文件后自动估算'}</div>
            )}
            {policy?.min_job_deadline_sec > 0 && (
              <div className="hint" style={{ marginTop: 10 }}>
                任务从提交起最多运行 max({Math.round(policy.min_job_deadline_sec / 60)} 分钟, {f1(policy.job_slow_factor)} × 视频时长)，超时自动失败并退还未使用的预扣。
              </div>
            )}
            <div className="formfoot">
              <Btn block onClick={submit} disabled={busy}>
                {busy ? <span className="spin" /> : null}
                {busy ? '处理中…' : kind === 'build' ? '提交编排任务' : kind === 'transcode' ? '开始处理' : '提交渲染任务'}
              </Btn>
            </div>
            {msg && <div className={'hint' + (msg.startsWith('失败') ? ' warn' : '')} style={{ marginTop: 10 }}>{msg}</div>}
          </Card>
          {!adv && (
            <Card kicker="Tips" title="想要更多控制？">
              <div className="wb-tip">到「我的」打开高级选项，可以自选编码器、硬件要求、分片数与服务端本机路径。</div>
              <div className="hint">提交后在「任务」里可查看每个分片的派发去向、哈希校验与结算明细。</div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}