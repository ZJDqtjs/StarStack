import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Card, Kpi, Chip, Btn, Empty, Tag } from '../ui.jsx'
import { api, href, f2, post, ST } from '../api.js'

let comfyPromise = null
function loadComfy() {
  if (window.ComfyWorkbench) return Promise.resolve()
  if (!comfyPromise) {
    comfyPromise = new Promise((res, rej) => {
      const s = document.createElement('script')
      s.src = href('/assets/comfy.js')
      s.onload = () => res()
      s.onerror = rej
      document.body.appendChild(s)
    })
  }
  return comfyPromise
}

const IMG_PRESETS = ['赛博朋克城市夜景，霓虹雨夜，电影感光效，16:9', '清晨的山间薄雾，柔和逆光，写实摄影，层次丰富', '日系插画风格的校园午后，樱花与单车，暖色调', '未来空间站内部，冷色调电影概念设计，广角镜头']
const VID_PRESETS = ['海边日落延时，镜头缓慢推进，暖色调，电影感', '雨夜城市街道，霓虹倒影，手持跟拍，浅景深', '云海之上的日出，无人机缓慢拉升，胶片颗粒', '产品特写环绕运镜，柔和棚拍光，简洁背景']
const isVideoFile = name => /\.(mp4|webm|mov|mkv)$/i.test(String(name || ''))
const hasComfyRt = w => (w.runtimes || []).some(r => String(r.name || '').toLowerCase() === 'comfyui')
const shortModelName = s => String(s || '').replace(/\\/g, '/').split('/').pop()

function aggregatePoolModels(workers, fallback) {
  const ckpts = new Map(), loras = new Map()
  const add = (m, name, price) => {
    const clean = String(name || '').trim()
    if (!clean) return
    const key = clean.toLowerCase()
    const cur = m.get(key) || { name: clean, nodes: 0, min_price: price || 0 }
    cur.nodes++
    if (price > 0 && (!cur.min_price || price < cur.min_price)) cur.min_price = price
    m.set(key, cur)
  }
  workers.forEach(w => {
    const cm = w.comfy_models
    if (!cm || !cm.reachable) return
    ;(cm.checkpoints || []).forEach(c => add(ckpts, c, w.price))
    ;(cm.loras || []).forEach(l => add(loras, l, w.price))
  })
  const sortList = m => Array.from(m.values()).sort((a, b) => (b.nodes - a.nodes) || a.name.localeCompare(b.name))
  const cList = sortList(ckpts)
  const lList = sortList(loras)
  return {
    checkpoints: cList.length ? cList : ((fallback && fallback.checkpoints) || []),
    loras: lList.length ? lList : ((fallback && fallback.loras) || []),
  }
}

function ComfyCard({ kind }) {
  return (
    <div className="card" data-cw-kind={kind}>
      <div className="cw-card-head">
        <h2 style={{ margin: 0 }}><span className="kicker">Workbench</span>预设工作台</h2>
        <span className="cw-chip" data-cw-conn>检测中…</span>
      </div>
      <div className="cw-card-tabs">
        <button type="button" className="cw-card-tab on" data-cw-tab="template">模板配置</button>
        <button type="button" className="cw-card-tab" data-cw-tab="preset">我的预设</button>
        <button type="button" className="cw-card-tab" data-cw-tab="draft">保存草稿</button>
      </div>
      <div className="cw-card-pane" data-cw-pane></div>
      <div className="cw-mini" data-cw-mini title="点击打开工作台，或拖入工作流文件">
        <svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid meet"></svg>
        <span className="cw-mini-badge">WORKFLOW GRAPH</span>
        <span className="cw-mini-empty">选择并配置一个 ComfyUI 工作流</span>
      </div>
      <div className="cw-mini-info"><span data-cw-info>载入中…</span><span>双击 / 拖入导入</span></div>
      <div className="cw-chips" data-cw-chips></div>
      <div className="cw-card-foot">
        <button type="button" className="btn sm" data-cw-open>选择并打开工作台</button>
        <button type="button" className="ghost tiny" data-cw-import>选择并上传</button>
        <button type="button" className="ghost tiny" data-cw-save>保存草稿</button>
        <button type="button" className="cw-link-btn" data-cw-help>使用教程</button>
      </div>
      <p className="cw-card-note" id={'cw-note-' + kind}>
        {kind === 'image'
          ? '支持官方 workflow.json、API 格式 prompt.json 与含工作流元数据的 PNG；部署后本页表单会把参数写入该工作流并提交队列。'
          : '导入视频工作流后，镜头描述、时长与画幅会写入对应节点；可提交到平台单机或算力池节点执行。'}
      </p>
      <input type="file" className="cw-hidden" data-cw-file accept=".json,.png,application/json,image/png" />
    </div>
  )
}

// PoolCard submits either the current workbench graph or an exported API JSON
// to a provider node running --allow-comfy.
function PoolCard({ kind, allowed, target, checkpoint, lora, formParams }) {
  const { toast } = useApp()
  const [file, setFile] = useState(null)
  const [timeout, setTimeoutSec] = useState('900')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const submitGraph = async (name, graph) => {
    if (!allowed) { setMsg('这台 Broker 没有向你的账号开放 ComfyUI 任务'); return }
    setBusy(true); setMsg('提交到算力池…')
    try {
      const req = {}
      if (target) req.node_id = target
      if (checkpoint) req.comfy_checkpoint = checkpoint
      if (lora) req.comfy_loras = [lora]
      const d = await post('/api/jobs/comfy', {
        name, kind, prompt: graph, timeout: +timeout || 900,
        checkpoint: checkpoint || '', loras: lora ? [lora] : [], req,
      })
      setMsg('任务 ' + d.id + ' 已入队，预扣 ' + f2(d.hold) + ' 点（按次结算，未执行全额退还）。' + (d.note || ''))
      toast('已提交到算力池', 'ok')
    } catch (err) { setMsg('提交失败：' + err) }
    finally { setBusy(false) }
  }

  const submitFile = async e => {
    e.preventDefault()
    if (!file) { setMsg('先选择 API 格式的工作流 JSON，或点「提交当前工作台图」'); return }
    setMsg('正在读取工作流…')
    try {
      const text = await file.text()
      let graph
      try { graph = JSON.parse(text) } catch (err) { throw new Error('不是合法的 JSON 文件') }
      if (graph && graph.nodes && graph.links) throw new Error('这是 UI 工作流，请在 ComfyUI 里用「导出（API）」再提交')
      await submitGraph(file.name.replace(/\.json$/i, ''), graph)
    } catch (err) { setMsg('提交失败：' + (err.message || err)) }
  }

  const submitCurrentGraph = async () => {
    try {
      await loadComfy()
      if (!window.ComfyWorkbench || !window.ComfyWorkbench.buildPrompt) {
        throw new Error('工作台组件尚未就绪')
      }
      const graph = window.ComfyWorkbench.buildPrompt(kind, { ...formParams, checkpoint, lora })
      if (!graph || !Object.keys(graph).length) throw new Error('当前工作流没有可执行节点')
      const title = (formParams && formParams.prompt ? formParams.prompt.slice(0, 24) : (kind === 'image' ? '工作台生图' : '工作台生视频'))
      await submitGraph(title, graph)
    } catch (err) { setMsg('提交失败：' + (err.message || err)) }
  }

  return (
    <Card kicker="Compute Pool" title="提交到算力池（节点执行）">
      <form onSubmit={submitFile}>
        <div className="hint" style={{ marginTop: 0 }}>
          由开启了 <span className="num">--allow-comfy</span> 的算力节点用<b>它自己的</b> ComfyUI 执行这张图：
          调度器会自动按节点上报的 Checkpoint / LoRA 匹配可执行机器，按完成次数结算。
        </div>
        <div className="wb-pick" style={{ marginTop: 12 }}>
          <Btn sm type="button" onClick={() => fileRef.current.click()}>选择工作流 JSON</Btn>
          <span className="wb-pick-or">{file ? file.name : 'API 格式：{ "3": { "class_type": ... } }'}</span>
        </div>
        <input ref={fileRef} type="file" className="sr" accept=".json,application/json"
          onChange={e => { setFile(e.target.files[0] || null); setMsg('') }} />
        <div className="row">
          <div><label>超时（秒）</label><input value={timeout} onChange={e => setTimeoutSec(e.target.value)} inputMode="numeric" /></div>
          <div><label>产物类型</label><input value={kind === 'image' ? '图片（按次）' : '视频（按次）'} readOnly /></div>
        </div>
        <div className="formfoot">
          <Btn type="button" disabled={busy || !allowed} onClick={submitCurrentGraph}>直接提交当前工作台图</Btn>
          <Btn ghost type="submit" disabled={busy || !allowed || !file}>提交上传的 JSON</Btn>
          <Btn ghost type="button" onClick={() => nav('jobs')}>我的任务 →</Btn>
          <div className="hint">{msg}</div>
        </div>
        {!allowed && <div className="hint warn">该部署未开放 ComfyUI 任务：需要服务端 --allow-comfy 且你的账号在 --comfy-users 名单里。</div>}
      </form>
    </Card>
  )
}

function ResultPanel({ kind, running, elapsed, result, online, poolReady, execMode, activeJob, advanced }) {
  const items = (result && result.outputs) || []
  const seg = activeJob && activeJob.segs && activeJob.segs[0]
  const stageText = activeJob
    ? `${ST[activeJob.status] || activeJob.status}${seg && seg.worker ? ` · 节点 ${seg.worker}` : ''}${seg && seg.pct > 0 && activeJob.status !== 'done' ? ` · ${Math.round(seg.pct)}%` : ''}`
    : ''
  return (
    <Card kicker="Result" title="生成结果">
      {running ? (
        <div className="gen-state">
          <span className="gen-spinner" />
          <div>
            <b>正在生成{elapsed ? `（已等待 ${elapsed} 秒）` : ''}</b>
            <span>
              {execMode === 'pool'
                ? `已派发至算力池${stageText ? ' · ' + stageText : ''}。完成后会自动展示结果，也可以切到「我的任务」查看明细。`
                : '任务已提交到平台执行队列，完成后会自动显示在这里，可以先切到别的页面。'}
            </span>
          </div>
        </div>
      ) : items.length ? (
        <>
          <div className="gen-grid">
            {items.map((o, i) => isVideoFile(o.filename)
              ? <video key={i} className="gen-item gen-video" src={o.url} controls preload="metadata" />
              : <a key={i} className="gen-item" href={o.url} target="_blank" rel="noreferrer" title="打开原图">
                <img src={o.url} alt={`生成结果 ${i + 1}`} />
              </a>)}
          </div>
          <div className="hint" style={{ marginBottom: 0 }}>
            共 {items.length} 个产物
            {result && result.id ? ` · 任务 ${String(result.id).slice(0, 12)}` : ''}
            {result && result.worker ? ` · 执行节点 ${result.worker}` : ''}
            {result && result.spent > 0 ? ` · 实结 ${f2(result.spent)} 点` : ''}
            {' · '}点图片在新标签打开原图
            {result && result.downloadUrl && (
              <>
                {' · '}<a href={result.downloadUrl}>下载压缩包</a>
                {' · '}<button type="button" className="linkbtn" onClick={() => nav('jobs')}>任务明细 →</button>
              </>
            )}
          </div>
        </>
      ) : (
        <Empty inline>
          {execMode === 'pool' && !poolReady
            ? '当前没有可用的 ComfyUI 算力池节点；可切换为平台单机或在「我的节点」接入 --allow-comfy 节点。'
            : execMode === 'platform' && online === false
              ? '平台单机 ComfyUI 当前不可用；如有在线算力节点可切换到「算力池节点」执行。'
              : `填好${kind === 'image' ? '画面' : '镜头'}描述后点「生成${kind === 'image' ? '图片' : '视频'}」，结果会直接显示在这里。`}
        </Empty>
      )}
      {!advanced && (
        <div className="hint">
          需要编辑工作流节点或导入自定义 ComfyUI JSON？到「设置」打开<b>高级选项</b>即可解锁完整画布。
          <button type="button" className="linkbtn" onClick={() => nav('settings')}>去设置 →</button>
        </div>
      )}
    </Card>
  )
}

export default function Create({ kind }) {
  const { workers, jobs, policy, target, setTarget, toast, prefill, setPrefill, advanced } = useApp()
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState(kind === 'image' ? '16:9 · 1344×768' : '16:9')
  const [style, setStyle] = useState('写实摄影')
  const [neg, setNeg] = useState('')
  const [dur, setDur] = useState('5 秒')
  const [motion, setMotion] = useState('')
  const [msg, setMsg] = useState('')
  const [comfyStatus, setComfyStatus] = useState(null)
  const [execMode, setExecMode] = useState('auto') // auto | pool | platform
  const [checkpoint, setCheckpoint] = useState('')
  const [lora, setLora] = useState('')
  const [est, setEst] = useState(null)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [activeJobId, setActiveJobId] = useState('')
  const [result, setResult] = useState(null)
  const cardRef = useRef(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])
  useEffect(() => {
    let alive = true
    loadComfy().then(() => { if (alive && window.ComfyWorkbench) window.ComfyWorkbench.rebindCards() }).catch(() => {})
    return () => { alive = false }
  }, [kind, advanced])
  useEffect(() => {
    let alive = true
    setResult(null); setMsg(''); setActiveJobId('')
    api('/api/comfy/status')
      .then(d => { if (alive) setComfyStatus(d) })
      .catch(() => { if (alive) setComfyStatus({ reachable: false, pool_allowed: false, pool_nodes: 0 }) })
    return () => { alive = false }
  }, [kind])
  useEffect(() => {
    if (prefill && prefill.view === kind) { setPrompt((prefill.tpl && (prefill.tpl.prompt || prefill.tpl.scene)) || ''); setPrefill(null) }
  }, [prefill, kind, setPrefill])

  const online = comfyStatus ? !!comfyStatus.reachable : null
  const poolAllowed = comfyStatus && comfyStatus.pool_allowed !== undefined
    ? !!comfyStatus.pool_allowed
    : !!(policy && policy.allow_comfy)

  const comfyWorkers = useMemo(() =>
    workers.filter(w => w.online && !w.paused && !w.parked_sec && hasComfyRt(w) && (w.gpus || []).length > 0),
  [workers])
  const poolModels = useMemo(() =>
    aggregatePoolModels(comfyWorkers, comfyStatus && comfyStatus.pool_models),
  [comfyWorkers, comfyStatus])
  const poolReady = poolAllowed && (comfyWorkers.length > 0 || (comfyStatus && comfyStatus.pool_nodes > 0))
  const targetW = workers.find(w => w.id === target)

  // 自动选择路由：指定了 ComfyUI 节点或算力池可用时优先走算力池，否则回落平台单机
  const effectiveMode = useMemo(() => {
    if (execMode === 'pool' || execMode === 'platform') return execMode
    if (targetW && hasComfyRt(targetW) && poolAllowed) return 'pool'
    if (poolReady) return 'pool'
    if (online) return 'platform'
    return poolAllowed ? 'pool' : 'platform'
  }, [execMode, targetW, poolAllowed, poolReady, online])

  // 默认选中第一个算力池上报的 Checkpoint，避免工作流占位文件名在节点上找不到
  useEffect(() => {
    if (!poolModels.checkpoints.length) return
    setCheckpoint(cur => {
      if (cur && poolModels.checkpoints.some(x => x.name === cur)) return cur
      return poolModels.checkpoints[0].name
    })
  }, [poolModels.checkpoints])

  // 算力池模式实时估价（含首选节点 first_pick）
  useEffect(() => {
    if (effectiveMode !== 'pool' || !poolAllowed) { setEst(null); return }
    const t = setTimeout(async () => {
      const req = { runtime: 'comfyui', need_gpu: true }
      if (target) req.node_id = target
      if (checkpoint) req.comfy_checkpoint = checkpoint
      if (lora) req.comfy_loras = [lora]
      try {
        const e = await api('/api/estimate?duration=1&kind=comfy&req=' + encodeURIComponent(JSON.stringify(req)))
        if (aliveRef.current) setEst(e)
      } catch (err) {
        if (aliveRef.current) setEst(null)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [effectiveMode, poolAllowed, target, checkpoint, lora, comfyWorkers.length])

  const activeJob = useMemo(() =>
    activeJobId ? (jobs.find(j => j.id === activeJobId) || null) : null,
  [jobs, activeJobId])

  const on = workers.filter(w => w.online)
  const comfyFree = comfyWorkers.reduce((a, w) => a + Math.max(0, (w.slots || 0) - (w.active || 0)), 0)
  const comfyPrices = comfyWorkers.map(w => Number(w.price) || 0).filter(p => p > 0)
  const comfyMin = comfyPrices.length ? Math.min(...comfyPrices) : (comfyStatus && comfyStatus.pool_min_price > 0 ? comfyStatus.pool_min_price : null)

  const formParams = kind === 'image'
    ? { prompt: prompt.trim(), size, style, negative: neg.trim() }
    : { prompt: prompt.trim(), duration: dur, size, motion: motion.trim() }

  // 轮询算力池 ComfyUI 任务直到终态，并拉取解压预览文件列表
  const waitPoolJob = async jobId => {
    const start = Date.now()
    for (let i = 0; i < 600; i++) {
      if (!aliveRef.current) return null
      setElapsed(Math.round((Date.now() - start) / 1000))
      try {
        const d = await api('/api/jobs?limit=50')
        const j = (d.jobs || []).find(x => x.id === jobId)
        if (j) {
          if (j.status === 'done') {
            const fd = await api('/api/jobs/' + encodeURIComponent(jobId) + '/files')
            const seg = (j.segs && j.segs[0]) || {}
            const files = (fd.files || []).map(f => ({
              filename: f.filename,
              mime: f.mime,
              url: href(f.url),
            }))
            return {
              id: jobId,
              worker: seg.worker || '',
              spent: j.credits_spent || 0,
              downloadUrl: href('/download/' + encodeURIComponent(jobId)),
              outputs: files,
            }
          }
          if (j.status === 'failed' || j.status === 'cancelled') {
            throw new Error(j.err || '算力池执行失败，未使用的预扣已自动退还')
          }
        }
      } catch (e) {
        if (e && e.message && /失败|取消|退还/.test(e.message)) throw e
      }
      await new Promise(r => setTimeout(r, 1500))
    }
    throw new Error('等待算力池结果超时，任务仍在运行中，可到「我的任务」继续查看')
  }

  const submit = async e => {
    e.preventDefault()
    if (!prompt.trim()) { setMsg(kind === 'image' ? '先写画面描述' : '先写镜头描述'); return }
    if (running) return
    if (!window.ComfyWorkbench) {
      try { await loadComfy() } catch (err) { setMsg('生成组件加载失败，请刷新页面重试'); return }
      if (!window.ComfyWorkbench) { setMsg('生成组件加载失败，请刷新页面重试'); return }
    }

    // 路径 A：算力池节点执行（支持简洁默认模式，直接展示结果）
    if (effectiveMode === 'pool') {
      if (!poolAllowed) {
        setMsg('当前部署未向你的账号开放 ComfyUI 算力池任务，请切到平台单机或联系部署方开启 --allow-comfy')
        return
      }
      setRunning(true); setElapsed(0); setResult(null); setMsg('正在构建工作流并派发到算力池…')
      try {
        const graph = window.ComfyWorkbench.buildPrompt
          ? window.ComfyWorkbench.buildPrompt(kind, { ...formParams, checkpoint, lora })
          : window.ComfyWorkbench.toAPI(window.ComfyWorkbench.graphFor(kind))
        if (!graph || !Object.keys(graph).length) throw new Error('当前工作流没有可执行的输出节点')
        const req = {}
        if (target) req.node_id = target
        if (checkpoint) req.comfy_checkpoint = checkpoint
        if (lora) req.comfy_loras = [lora]
        const created = await post('/api/jobs/comfy', {
          name: prompt.trim().slice(0, 32) || (kind === 'image' ? 'ComfyUI 生图' : 'ComfyUI 生视频'),
          kind,
          prompt: graph,
          timeout: 900,
          checkpoint: checkpoint || '',
          loras: lora ? [lora] : [],
          req,
        })
        if (!aliveRef.current) return
        setActiveJobId(created.id)
        setMsg(`任务 ${created.id} 已派发，预扣 ${f2(created.hold)} 点，等待算力节点出图…`)
        toast('已提交到算力池，等待节点执行', 'ok', kind === 'image' ? '生图' : '生视频')
        const res = await waitPoolJob(created.id)
        if (!aliveRef.current || !res) return
        setResult(res)
        setMsg(res.outputs.length
          ? `生成完成，共 ${res.outputs.length} 个产物 · 实结 ${f2(res.spent)} 点`
          : '任务完成，请点「下载压缩包」查看产物')
        toast('算力池生成完成', 'ok', kind === 'image' ? '生图' : '生视频')
      } catch (err) {
        const m = String((err && err.message) || err)
        if (aliveRef.current) { setMsg(m); toast(m, 'bad', '生成失败') }
      } finally {
        if (aliveRef.current) setRunning(false)
      }
      return
    }

    // 路径 B：平台单机 ComfyUI
    if (advanced) {
      window.ComfyWorkbench.generate(kind, formParams)
      setMsg('已写入工作流并打开 ComfyUI 工作台')
      toast('参数已写入工作流', 'ok', kind === 'image' ? '生图' : '生视频')
      return
    }
    setRunning(true); setElapsed(0); setResult(null); setActiveJobId(''); setMsg('提交中…')
    try {
      const r = await window.ComfyWorkbench.run(kind, formParams, i => {
        if (aliveRef.current) setElapsed(Math.round((i + 1) * 1.5))
      })
      if (!aliveRef.current) return
      setResult(r)
      setMsg(r.outputs.length ? `生成完成，共 ${r.outputs.length} 个产物` : '任务完成，但没有返回产物；请检查工作流是否有输出节点')
      if (r.outputs.length) toast('生成完成', 'ok', kind === 'image' ? '生图' : '生视频')
    } catch (err) {
      const m = String((err && err.message) || err)
      if (aliveRef.current) { setMsg(m); toast(m, 'bad', '生成失败') }
    } finally {
      if (aliveRef.current) setRunning(false)
    }
  }

  return (
    <div>
      <div className="phead">
        <div className="phead-txt">
          <span className="eyebrow">{kind === 'image' ? 'Image Generation' : 'Video Generation'}</span>
          <h1>{kind === 'image' ? '生图工作台' : '生视频工作台'}</h1>
          <p>
            {effectiveMode === 'pool'
              ? '当前已接入共享算力池：描述画面、选择节点已安装的 Checkpoint / LoRA，任务自动派发到最优闲置 GPU 节点并按次结算。'
              : (advanced
                ? '部署或导入 ComfyUI 工作流后，参数写入节点并提交执行队列。'
                : '描述你想要的画面，选好画幅与风格，点生成即可；结果直接显示在本页。')}
          </p>
        </div>
        <div className="phead-actions"><Btn ghost onClick={() => nav('market')}>找卖家工作流 →</Btn></div>
      </div>
      <div className="kpis">
        <Kpi label="ComfyUI 算力节点" value={comfyWorkers.length} icon="◉" />
        <Kpi label="可用 GPU 槽位" value={comfyFree} icon="▦" />
        <Kpi label="算力池最低价" value={comfyMin === null ? '—' : f2(comfyMin) + ' 点/次'} icon="◈" />
        <Kpi label="池内可用模型" value={`${poolModels.checkpoints.length} Ckpt / ${poolModels.loras.length} LoRA`} icon="✦" />
        <Kpi action={<Btn ghost tiny onClick={() => nav('pool')}>查看算力市场（共 {on.length} 台）→</Btn>} />
      </div>
      {target && (
        <div className="targetchip">仅派发到节点 <b>{targetW ? (targetW.name || targetW.id) : target}</b>
          <Btn ghost tiny onClick={() => setTarget(null)}>取消指定</Btn></div>
      )}
      <div className="split">
        <Card kicker={kind === 'image' ? 'Prompt' : 'Shot'} title={kind === 'image' ? '画面描述' : '镜头描述'}>
          <form onSubmit={submit}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="sub-line" style={{ marginRight: 4 }}>执行去向：</span>
              <Chip on={effectiveMode === 'pool'} onClick={() => setExecMode('pool')}>
                算力池节点（{comfyWorkers.length} 台在线{comfyMin !== null ? ` · ${f2(comfyMin)} 点/次起` : ''}）
              </Chip>
              <Chip on={effectiveMode === 'platform'} onClick={() => setExecMode('platform')}>
                平台单机 ComfyUI（{online ? '在线' : online === false ? '离线' : '检测中'}）
              </Chip>
            </div>
            <label style={{ marginTop: 0 }}>{kind === 'image' ? '画面描述' : '镜头描述'}</label>
            <textarea rows={5} value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder={kind === 'image' ? '例如：赛博朋克城市夜景，霓虹雨夜，电影感光效，16:9' : '例如：海边日落延时，镜头缓慢推进，暖色调，5 秒'} />
            <div className="chips sm" style={{ marginTop: 9 }}>
              {(kind === 'image' ? IMG_PRESETS : VID_PRESETS).map((t, i) => (
                <Chip key={i} onClick={() => setPrompt(t)}>{kind === 'image' ? ['赛博夜景', '山间晨雾', '日系插画', '电影概念'][i] : ['海边日落', '雨夜街景', '云海日出', '产品环绕'][i]}</Chip>
              ))}
            </div>
            {effectiveMode === 'pool' && (
              <div className="row">
                <div>
                  <label>Checkpoint 模型（来自在线算力节点）</label>
                  <select value={checkpoint} onChange={e => setCheckpoint(e.target.value)}>
                    <option value="">不限（使用工作流默认模型）</option>
                    {poolModels.checkpoints.map(m => (
                      <option key={m.name} value={m.name}>
                        {shortModelName(m.name)}（{m.nodes} 台节点{m.min_price > 0 ? ` · ${f2(m.min_price)} 点/次起` : ''}）
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>LoRA 风格微调（可选）</label>
                  <select value={lora} onChange={e => setLora(e.target.value)}>
                    <option value="">不使用 LoRA</option>
                    {poolModels.loras.map(m => (
                      <option key={m.name} value={m.name}>{shortModelName(m.name)}（{m.nodes} 台节点）</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <div className="row">
              {kind === 'image' ? (
                <>
                  <div><label>画幅</label><select value={size} onChange={e => setSize(e.target.value)}>
                    <option>1:1 · 1024×1024</option><option>16:9 · 1344×768</option><option>9:16 · 768×1344</option><option>4:3 · 1152×864</option></select></div>
                  <div><label>风格</label><select value={style} onChange={e => setStyle(e.target.value)}>
                    <option>写实摄影</option><option>日系插画</option><option>电影概念</option><option>3D 渲染</option></select></div>
                </>
              ) : (
                <>
                  <div><label>时长</label><select value={dur} onChange={e => setDur(e.target.value)}>
                    <option>3 秒</option><option>5 秒</option><option>10 秒</option></select></div>
                  <div><label>画幅</label><select value={size} onChange={e => setSize(e.target.value)}>
                    <option>16:9</option><option>9:16</option><option>1:1</option></select></div>
                </>
              )}
            </div>
            {kind === 'image' ? (
              <><label>反向提示词（可选）</label><input value={neg} onChange={e => setNeg(e.target.value)} placeholder="例如：低清晰度、多余手指、水印" /></>
            ) : (
              <><label>运镜 / 风格（可选）</label><input value={motion} onChange={e => setMotion(e.target.value)} placeholder="例如：缓慢推进、手持感、胶片颗粒" /></>
            )}
            {effectiveMode === 'pool' && est && (
              <div className="hint" style={{ marginTop: 10 }}>
                匹配节点 <b>{est.eligible}</b> 台 · 预扣 <b className="num">{f2(est.hold)}</b> 点（按次结算，失败全额退还）
                {est.first_pick && <> · 首选派发 <Tag tone="on">{est.first_pick.name || est.first_pick.id} · {f2(est.first_pick.price)} 点/次</Tag></>}
                {!est.affordable && <Tag tone="off">余额不足（余 {f2(est.balance)} 点）</Tag>}
              </div>
            )}
            <div className="formfoot">
              <Btn type="submit" disabled={running}>
                {running ? '生成中…' : (effectiveMode === 'pool' ? `提交算力池生成${kind === 'image' ? '图片' : '视频'}` : (kind === 'image' ? '生成图片' : '生成视频'))}
              </Btn>
              {advanced && <Btn ghost type="button" onClick={() => window.ComfyWorkbench && window.ComfyWorkbench.open(kind)}>打开工作台</Btn>}
              <div className="hint">{msg}</div>
            </div>
            {effectiveMode === 'pool' && !poolAllowed && (
              <div className="hint warn">
                当前部署未向你的账号开放 ComfyUI 算力池任务（需要服务端开启 <span className="num">--allow-comfy</span> 且账号在白名单内）。
              </div>
            )}
            {effectiveMode === 'pool' && poolAllowed && !comfyWorkers.length && (
              <div className="hint warn">
                当前暂无开启 <span className="num">--allow-comfy</span> 的在线 GPU 节点；提交后会排队等待节点上线，也可去「我的节点」接入你自己的机器。
              </div>
            )}
            {effectiveMode === 'platform' && online === false && (
              <div className="hint warn">
                平台单机 ComfyUI 当前不可用{poolReady ? '，建议点上方「算力池节点」使用共享 GPU 算力。' : '。可让部署方配置 --comfyui，或在节点侧开启 --allow-comfy。'}
              </div>
            )}
          </form>
        </Card>
        <div className="sticky" ref={cardRef}>
          {advanced && effectiveMode === 'platform'
            ? <ComfyCard kind={kind} />
            : <ResultPanel kind={kind} running={running} elapsed={elapsed} result={result} online={online} poolReady={poolReady} execMode={effectiveMode} activeJob={activeJob} advanced={advanced} />}
        </div>
      </div>
      {advanced && (
        <div style={{ marginTop: 18 }}>
          <PoolCard kind={kind} allowed={poolAllowed} target={target} checkpoint={checkpoint} lora={lora} formParams={formParams} />
        </div>
      )}
    </div>
  )
}
