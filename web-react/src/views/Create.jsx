import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Card, Kpi, Chip, Btn, Empty } from '../ui.jsx'
import { api, href, f2, post } from '../api.js'

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
const isVideoFile = name => /\.(mp4|webm|mov|mkv|gif)$/i.test(String(name || ''))

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
          ? '支持官方 workflow.json、API 格式 prompt.json 与含工作流元数据的 PNG；部署后本页表单会把参数写入该工作流并提交 ComfyUI 队列。'
          : '导入视频工作流后，镜头描述、时长与画幅会写入对应节点；生成由 ComfyUI 队列执行，WebSocket 实时回传进度。'}
      </p>
      <input type="file" className="cw-hidden" data-cw-file accept=".json,.png,application/json,image/png" />
    </div>
  )
}

// PoolCard submits an exported API-format graph to a provider node instead of
// proxying it to the operator's own ComfyUI. Same graph, different executor:
// the node's machine runs it and is paid per completed generation.
function PoolCard({ kind }) {
  const { policy, toast } = useApp()
  const [file, setFile] = useState(null)
  const [timeout, setTimeoutSec] = useState('900')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const allowed = !!(policy && policy.allow_comfy)

  const submit = async e => {
    e.preventDefault()
    if (!file) { setMsg('先选择 API 格式的工作流 JSON（ComfyUI 里「导出（API）」）'); return }
    if (!allowed) { setMsg('这台 Broker 没有向你的账号开放 ComfyUI 任务'); return }
    setBusy(true); setMsg('正在读取工作流…')
    try {
      const text = await file.text()
      let graph
      try { graph = JSON.parse(text) } catch (err) { throw new Error('不是合法的 JSON 文件') }
      if (graph && graph.nodes && graph.links) throw new Error('这是 UI 工作流，请在 ComfyUI 里用「导出（API）」再提交')
      setMsg('提交到算力池…')
      const d = await post('/api/jobs/comfy', {
        name: file.name.replace(/\.json$/i, ''), kind, prompt: graph, timeout: +timeout || 900,
      })
      setMsg('任务 ' + d.id + ' 已入队，预扣 ' + f2(d.hold) + ' 点（按次结算，未执行全额退还）。' + (d.note || ''))
      toast('已提交到算力池', 'ok')
    } catch (err) { setMsg('提交失败：' + err) }
    finally { setBusy(false) }
  }

  return (
    <Card kicker="Compute Pool" title="提交到算力池（节点执行）">
      <form onSubmit={submit}>
        <div className="hint" style={{ marginTop: 0 }}>
          由开启了 <span className="num">--allow-comfy</span> 的算力节点用<b>它自己的</b> ComfyUI 执行这张图：
          模型与自定义节点由节点提供，平台只按完成次数结算。工作台那条路走的是官方 ComfyUI，两条互不影响。
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
          <Btn type="submit" disabled={busy || !allowed}>提交到算力池</Btn>
          <Btn ghost type="button" onClick={() => nav('jobs')}>我的任务 →</Btn>
          <div className="hint">{msg}</div>
        </div>
        {!allowed && <div className="hint warn">该部署未开放 ComfyUI 任务：需要服务端 --allow-comfy 且你的账号在 --comfy-users 名单里。</div>}
      </form>
    </Card>
  )
}

// 默认（非高级）模式下就在这里出结果，用户不需要接触 ComfyUI 工作台
function ResultPanel({ kind, running, elapsed, result, online, advanced }) {
  const items = (result && result.outputs) || []
  return (
    <Card kicker="Result" title="生成结果">
      {running ? (
        <div className="gen-state">
          <span className="gen-spinner" />
          <div>
            <b>正在生成{elapsed ? `（已等待 ${elapsed} 秒）` : ''}</b>
            <span>任务已提交到执行队列，完成后会自动显示在这里，可以先切到别的页面。</span>
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
            共 {items.length} 个产物{result && result.id ? ` · 任务 ${String(result.id).slice(0, 12)}` : ''} · 点图片在新标签打开原图
          </div>
        </>
      ) : (
        <Empty inline>
          {online === false
            ? '平台生图执行器当前不可用，暂时无法生成。'
            : `填好${kind === 'image' ? '画面' : '镜头'}描述后点「生成${kind === 'image' ? '图片' : '视频'}」，结果会显示在这里。`}
        </Empty>
      )}
      {!advanced && (
        <div className="hint">
          需要调工作流节点、导入自己的 ComfyUI 图，或把任务交给算力节点？到「设置」打开<b>高级选项</b>后，本页会显示工作台与算力池。
          <button type="button" className="linkbtn" onClick={() => nav('settings')}>去设置 →</button>
        </div>
      )}
    </Card>
  )
}

export default function Create({ kind }) {
  const { workers, toast, prefill, setPrefill, advanced } = useApp()
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState(kind === 'image' ? '16:9 · 1344×768' : '16:9')
  const [style, setStyle] = useState('写实摄影')
  const [neg, setNeg] = useState('')
  const [dur, setDur] = useState('5 秒')
  const [motion, setMotion] = useState('')
  const [msg, setMsg] = useState('')
  const [online, setOnline] = useState(null)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState(null)
  const cardRef = useRef(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])
  // 高级模式才需要页面内的 ComfyUI 卡片；绑定时机同时依赖 advanced（卡片按需挂载）
  useEffect(() => {
    let alive = true
    loadComfy().then(() => { if (alive && window.ComfyWorkbench) window.ComfyWorkbench.rebindCards() }).catch(() => {})
    return () => { alive = false }
  }, [kind, advanced])
  useEffect(() => {
    let alive = true
    setResult(null); setMsg('')
    api('/api/comfy/status').then(d => { if (alive) setOnline(!!d.reachable) }).catch(() => { if (alive) setOnline(false) })
    return () => { alive = false }
  }, [kind])
  useEffect(() => {
    if (prefill && prefill.view === kind) { setPrompt((prefill.tpl && (prefill.tpl.prompt || prefill.tpl.scene)) || ''); setPrefill(null) }
  }, [prefill, kind, setPrefill])

  const on = workers.filter(w => w.online)
  const free = on.reduce((a, w) => a + Math.max(0, (w.slots || 0) - (w.active || 0)), 0)
  const prices = on.map(w => Number(w.price) || 0).filter(p => p > 0)
  const min = prices.length ? Math.min(...prices) : null

  const submit = async e => {
    e.preventDefault()
    if (!prompt.trim()) { setMsg(kind === 'image' ? '先写画面描述' : '先写镜头描述'); return }
    if (running) return
    if (!window.ComfyWorkbench) {
      try { await loadComfy() } catch (err) { setMsg('生成组件加载失败，请刷新页面重试'); return }
      if (!window.ComfyWorkbench) { setMsg('生成组件加载失败，请刷新页面重试'); return }
    }
    const p = kind === 'image'
      ? { prompt: prompt.trim(), size, style, negative: neg.trim() }
      : { prompt: prompt.trim(), duration: dur, size, motion: motion.trim() }
    // 高级：沿用原来的完整工作台（可调节点、导入工作流、查看队列）
    if (advanced) {
      window.ComfyWorkbench.generate(kind, p)
      setMsg('已写入工作流并打开 ComfyUI 工作台')
      toast('参数已写入工作流', 'ok', kind === 'image' ? '生图' : '生视频')
      return
    }
    // 默认：留在本页直接生成并展示结果
    setRunning(true); setElapsed(0); setResult(null); setMsg('提交中…')
    try {
      const r = await window.ComfyWorkbench.run(kind, p, i => {
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

  const offline = online === false

  return (
    <div>
      <div className="phead">
        <div className="phead-txt">
          <span className="eyebrow">{kind === 'image' ? 'Image Generation' : 'Video Generation'}</span>
          <h1>{kind === 'image' ? '生图工作台' : '生视频工作台'}</h1>
          <p>
            {advanced
              ? (kind === 'image'
                ? '部署或导入 ComfyUI 工作流后，画面描述会写进节点参数，一键提交到官方执行队列。'
                : '部署视频工作流，镜头描述、时长与画幅直接写入节点，提交后由 ComfyUI 队列生成并回传进度。')
              : (kind === 'image'
                ? '描述你想要的画面，选好画幅与风格，点生成即可；结果直接显示在本页，不需要接触 ComfyUI。'
                : '描述镜头与运镜，选好时长与画幅，点生成即可；结果直接显示在本页，不需要接触 ComfyUI。')}
          </p>
        </div>
        <div className="phead-actions"><Btn ghost onClick={() => nav('market')}>找卖家工作流 →</Btn></div>
      </div>
      <div className="kpis">
        <Kpi label="在线节点" value={on.length} icon="◉" />
        <Kpi label="空闲槽位" value={free} icon="▦" />
        <Kpi label="最低单价" value={min === null ? '—' : f2(min) + ' 点/秒'} icon="◈" />
        <Kpi action={<Btn ghost tiny onClick={() => nav('pool')}>查看算力市场 →</Btn>} />
      </div>
      <div className="split">
        <Card kicker={kind === 'image' ? 'Prompt' : 'Shot'} title={kind === 'image' ? '画面描述' : '镜头描述'}>
          <form onSubmit={submit}>
            <label style={{ marginTop: 0 }}>{kind === 'image' ? '画面描述' : '镜头描述'}</label>
            <textarea rows={5} value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder={kind === 'image' ? '例如：赛博朋克城市夜景，霓虹雨夜，电影感光效，16:9' : '例如：海边日落延时，镜头缓慢推进，暖色调，5 秒'} />
            <div className="chips sm" style={{ marginTop: 9 }}>
              {(kind === 'image' ? IMG_PRESETS : VID_PRESETS).map((t, i) => (
                <Chip key={i} onClick={() => setPrompt(t)}>{['赛博夜景', '山间晨雾', '日系插画', '电影概念'][i] && kind === 'image' ? ['赛博夜景', '山间晨雾', '日系插画', '电影概念'][i] : ['海边日落', '雨夜街景', '云海日出', '产品环绕'][i]}</Chip>
              ))}
            </div>
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
            <div className="formfoot">
              <Btn type="submit" disabled={running}>{running ? '生成中…' : (kind === 'image' ? '生成图片' : '生成视频')}</Btn>
              {advanced && <Btn ghost type="button" onClick={() => window.ComfyWorkbench && window.ComfyWorkbench.open(kind)}>打开工作台</Btn>}
              <div className="hint">{msg}</div>
            </div>
            {offline && (
              <div className="hint warn">
                平台生图执行器（ComfyUI）当前不可用，生成会失败。可以让部署方用 <span className="num">--comfyui</span> 指向一个可访问的实例；
                也可以先把工作流导出，交给算力节点执行。
              </div>
            )}
          </form>
        </Card>
        <div className="sticky" ref={cardRef}>
          {advanced
            ? <ComfyCard kind={kind} />
            : <ResultPanel kind={kind} running={running} elapsed={elapsed} result={result} online={online} advanced={advanced} />}
        </div>
      </div>
      {advanced && <div style={{ marginTop: 18 }}><PoolCard kind={kind} /></div>}
    </div>
  )
}
