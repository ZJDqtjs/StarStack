import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Card, Kpi, Chip, Btn, Empty } from '../ui.jsx'
import { href, f2 } from '../api.js'

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

export default function Create({ kind }) {
  const { workers, toast, prefill, setPrefill } = useApp()
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState(kind === 'image' ? '16:9 · 1344×768' : '16:9')
  const [style, setStyle] = useState('写实摄影')
  const [neg, setNeg] = useState('')
  const [dur, setDur] = useState('5 秒')
  const [motion, setMotion] = useState('')
  const [msg, setMsg] = useState('')
  const cardRef = useRef(null)

  useEffect(() => {
    let alive = true
    loadComfy().then(() => { if (alive && window.ComfyWorkbench) window.ComfyWorkbench.rebindCards() }).catch(() => {})
    return () => { alive = false }
  }, [kind])
  useEffect(() => {
    if (prefill && prefill.view === kind) { setPrompt((prefill.tpl && (prefill.tpl.prompt || prefill.tpl.scene)) || ''); setPrefill(null) }
  }, [prefill, kind, setPrefill])

  const on = workers.filter(w => w.online)
  const free = on.reduce((a, w) => a + Math.max(0, (w.slots || 0) - (w.active || 0)), 0)
  const prices = on.map(w => Number(w.price) || 0).filter(p => p > 0)
  const min = prices.length ? Math.min(...prices) : null

  const submit = e => {
    e.preventDefault()
    if (!prompt.trim()) { setMsg(kind === 'image' ? '先写画面描述' : '先写镜头描述'); return }
    if (!window.ComfyWorkbench) { setMsg('工作台组件尚未加载，请刷新页面重试'); return }
    const p = kind === 'image'
      ? { prompt: prompt.trim(), size, style, negative: neg.trim() }
      : { prompt: prompt.trim(), duration: dur, size, motion: motion.trim() }
    window.ComfyWorkbench.generate(kind, p)
    setMsg('已写入工作流并打开 ComfyUI 工作台')
    toast('参数已写入工作流', 'ok', kind === 'image' ? '生图' : '生视频')
  }

  return (
    <div>
      <div className="phead">
        <div className="phead-txt">
          <span className="eyebrow">{kind === 'image' ? 'Image Generation' : 'Video Generation'}</span>
          <h1>{kind === 'image' ? '生图工作台' : '生视频工作台'}</h1>
          <p>{kind === 'image' ? '部署或导入 ComfyUI 工作流后，画面描述会写进节点参数，一键提交到官方执行队列。' : '部署视频工作流，镜头描述、时长与画幅直接写入节点，提交后由 ComfyUI 队列生成并回传进度。'}</p>
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
              <Btn type="submit">{kind === 'image' ? '生成图片' : '生成视频'}</Btn>
              <div className="hint">{msg}</div>
            </div>
          </form>
        </Card>
        <div className="sticky" ref={cardRef}><ComfyCard kind={kind} /></div>
      </div>
    </div>
  )
}