import React, { useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Card, Btn, Tag, Modal, Stat } from '../ui.jsx'
import { api, f2, workerTS, durCN } from '../api.js'

const hasRt = (w, name) => (w.runtimes || []).some(r => String(r.name || '').toLowerCase() === name)
const bestGPUOf = w => (w.gpus || []).reduce((a, b) => b.mem_mb > ((a && a.mem_mb) || 0) ? b : a, (w.gpus || [])[0] || null)
const priceRange = (min, max, unit) => min === null ? '—' : (min === max ? f2(min) + ' ' + unit : f2(min) + ' ~ ' + f2(max) + ' ' + unit)

export default function Pool() {
  const { workers, setTarget, toast, prompt } = useApp()
  const [node, setNode] = useState(null)
  const on = workers.filter(w => w.online)
  const buckets = {}
  const svcMap = {
    blender: { key: 'blender', label: 'Blender 帧渲染', unit: '点/帧', route: 'render', action: '去渲染', nodes: 0, free: 0, min: null, max: null, gpu: null, extra: '' },
    build: { key: 'build', label: '源码编译打包', unit: '点/分钟', route: 'build', action: '去编排', nodes: 0, free: 0, min: null, max: null, gpu: null, extra: '' },
    comfyui: { key: 'comfyui', label: 'ComfyUI 生图 / 生视频', unit: '点/次', route: 'image', action: '去创作', nodes: 0, free: 0, min: null, max: null, gpu: null, extra: '' },
    vm: { key: 'vm', label: 'IPv6 云主机', unit: '按配置计费', route: 'market?tab=vm', action: '看云主机', nodes: 0, free: 0, min: null, max: null, gpu: null, extra: '' },
  }
  const comfyCkpts = new Set(), comfyLoras = new Set()
  const buildArchs = new Set(), vmAccels = new Set()
  const addSvc = (s, free, price, gpu) => {
    s.nodes++; s.free += free
    if (price > 0) {
      if (s.min === null || price < s.min) s.min = price
      if (s.max === null || price > s.max) s.max = price
    }
    if (gpu && (!s.gpu || gpu.mem_mb > s.gpu.mem_mb)) s.gpu = gpu
  }
  on.forEach(w => {
    const free = Math.max(0, (w.slots || 0) - (w.active || 0))
    const gpu = bestGPUOf(w)
    ;(w.encoders || []).forEach(e => {
      const b = buckets[e] || (buckets[e] = { enc: e, nodes: 0, free: 0, min: w.price, max: w.price, speed: 0, gpu: null })
      b.nodes++; b.free += free; b.speed += w.speed
      if (w.price < b.min) b.min = w.price
      if (w.price > b.max) b.max = w.price
      if (gpu && (!b.gpu || gpu.mem_mb > b.gpu.mem_mb)) b.gpu = gpu
    })
    if (hasRt(w, 'blender')) addSvc(svcMap.blender, free, w.price, gpu)
    if (hasRt(w, 'build')) {
      addSvc(svcMap.build, free, w.price, gpu)
      if (w.os) buildArchs.add(w.os)
    }
    if (hasRt(w, 'comfyui')) {
      addSvc(svcMap.comfyui, free, w.price, gpu)
      if (w.comfy_models && w.comfy_models.reachable) {
        ;(w.comfy_models.checkpoints || []).forEach(c => comfyCkpts.add(c))
        ;(w.comfy_models.loras || []).forEach(l => comfyLoras.add(l))
      }
    }
    if (w.vm) {
      addSvc(svcMap.vm, w.vm.max_vms || 0, 0, gpu)
      if (w.vm.accel) vmAccels.add(w.vm.accel)
    }
  })
  svcMap.blender.extra = svcMap.blender.gpu ? '最强独显 ' + svcMap.blender.gpu.name : (svcMap.blender.nodes ? 'CPU 渲染可用' : '—')
  svcMap.build.extra = buildArchs.size ? Array.from(buildArchs).slice(0, 3).join(' / ') : '—'
  svcMap.comfyui.extra = svcMap.comfyui.nodes
    ? (comfyCkpts.size || comfyLoras.size
      ? `已上报 ${comfyCkpts.size} 个 Checkpoint · ${comfyLoras.size} 个 LoRA`
      : '等待节点上报本地模型列表')
    : '—'
  svcMap.vm.extra = vmAccels.size ? '虚拟化 ' + Array.from(vmAccels).join(' / ') : '—'
  const svcRows = Object.values(svcMap)
  const rows = Object.values(buckets)
  const reprice = async (id, cur) => {
    const v = await prompt('这台机器要的基准单价（转码点/视频秒 · 渲染点/帧 · 编译点/分钟 · ComfyUI 点/次）', cur, '调整单价'); if (v === null) return
    const price = +v; if (!(price > 0)) { toast('请输入大于 0 的单价', 'warn'); return }
    try { await api('/api/nodes/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price }) }); toast('单价已更新', 'ok') } catch (e) { toast(String(e), 'bad') }
  }
  const assign = (dest = 'render') => { setTarget(node.id); setNode(null); nav(dest); toast('已指定节点，任务只会派给它', 'ok') }

  return (
    <div>
      <div className="phead">
        <div className="phead-txt"><span className="eyebrow">Capacity Pool</span><h1>算力市场</h1><p>按运行时服务与视频编码能力聚合的可调度切片与全部在线节点。他人机器只展示规格与价格，不展示主机名与地址。</p></div>
        <div className="phead-actions"><Btn ghost onClick={() => nav('nodes')}>接入我的机器 →</Btn></div>
      </div>
      <Card kicker="Services" title="按运行时与服务聚合的可调度算力">
        <div className="tablewrap"><table><thead><tr><th>算力服务</th><th>在线节点</th><th>空闲槽 / 容量</th><th>单价区间</th><th>能力与模型摘要</th><th /></tr></thead>
          <tbody>{svcRows.map(s => (
            <tr key={s.key}>
              <td><b>{s.label}</b></td>
              <td className="num">{s.nodes > 0 ? <Tag tone="on">{s.nodes} 台</Tag> : <Tag tone="off">0</Tag>}</td>
              <td className="num">{s.free}</td>
              <td className="num">{s.key === 'vm' ? s.unit : priceRange(s.min, s.max, s.unit)}</td>
              <td>{s.extra}</td>
              <td><Btn ghost tiny onClick={() => nav(s.route)}>{s.action} →</Btn></td>
            </tr>
          ))}</tbody></table></div>
        <div className="hint">同一台机器可同时开启转码、Blender、编译、ComfyUI 或云主机；基准单价在不同任务中按对应单位计费（视频秒 / 帧 / 分钟 / 次），云主机按卖方配置单独计价。</div>
      </Card>
      <Card kicker="Encoders" title="按视频编码能力聚合的可调度切片">
        <div className="tablewrap"><table><thead><tr><th>编码能力</th><th>在线节点</th><th>空闲槽位</th><th>单价区间</th><th>实测吞吐</th><th>最强独显</th></tr></thead>
          <tbody>{rows.length ? rows.map(b => (
            <tr key={b.enc}><td><b>{b.enc}</b>{/nvenc|qsv|amf/.test(b.enc) && <Tag tone="gpu">GPU/ASIC</Tag>}</td><td className="num">{b.nodes}</td><td className="num">{b.free}</td>
              <td className="num">{b.min === b.max ? f2(b.min) + ' 点/秒' : f2(b.min) + ' ~ ' + f2(b.max) + ' 点/秒'}</td>
              <td className="num">{(b.speed / b.nodes) > 0 ? f2(b.speed / b.nodes) + '×' : '—'}</td><td>{b.gpu ? b.gpu.name + ' ' + b.gpu.mem_mb + 'MB' : '—'}</td></tr>
          )) : <tr><td colSpan={6} className="empty">尚无在线算力</td></tr>}</tbody></table></div>
        <div className="hint">一台机器可出现在多行；真实并发看「空闲槽位」。点击下面的节点可以把它指定给下一个任务。</div>
      </Card>
      <Card kicker="Nodes" title="全部在线节点">
        <div className="tablewrap"><table><thead><tr><th>节点</th><th>硬件</th><th>运行时 / 能力</th><th>编码能力</th><th>占用</th><th>吞吐</th><th>信誉</th><th>基准单价</th></tr></thead>
          <tbody>{on.length ? on.map(w => {
            const rel = w.ok + w.bad > 0 ? Math.round(100 * w.ok / (w.ok + w.bad)) + '%' : '—'
            const cm = w.comfy_models
            return (
              <tr key={w.id} className="tap" onClick={() => setNode(w)}>
                <td><b>{w.name || w.id}</b><span className="sub-line">{w.os}</span>{w.mine && <Tag tone="mine">我的机器</Tag>}<br /><Tag tone={w.online ? 'on' : 'off'}>{workerTS(w)} {w.online ? '在线' : '离线'}</Tag></td>
                <td>{w.cpus} 核 · {w.mem_mb ? Math.round(w.mem_mb / 1024) + 'GB' : '内存未知'}<br />{(w.gpus || []).map(g => g.name + ' ' + g.mem_mb + 'MB').join('、') || '无独显'}</td>
                <td>
                  {(w.runtimes || []).map(r => <Tag key={r.name} tone={r.name === 'comfyui' ? 'on' : ''}>{r.name}</Tag>)}
                  {w.vm && <Tag tone="gpu">VM×{w.vm.max_vms || 1}</Tag>}
                  {cm && cm.reachable && ((cm.checkpoints || []).length > 0 || (cm.loras || []).length > 0) && (
                    <span className="sub-line">Ckpt {(cm.checkpoints || []).length} · LoRA {(cm.loras || []).length}</span>
                  )}
                </td>
                <td style={{ maxWidth: 190 }}>{(w.encoders || []).map(e => <Tag key={e}>{e}</Tag>)}</td>
                <td className="num">{w.active}/{w.slots}</td>
                <td className="num">{w.speed > 0 ? f2(w.speed) + '×' : '—'}</td>
                <td>{rel}<span className="sub-line">✓{w.ok} ✗{w.bad}</span>{w.parked_sec ? <Tag tone="off">停派 {durCN(w.parked_sec)}</Tag> : null}</td>
                <td className="num">{f2(w.price)} 点/单位{w.mine && <><br /><Btn ghost tiny onClick={e => { e.stopPropagation(); reprice(w.id, w.price) }}>改价</Btn></>}</td>
              </tr>
            )
          }) : <tr><td colSpan={8} className="empty">当前没有在线节点</td></tr>}</tbody></table></div>
        <div className="hint">离线节点不进入算力市场，可到「我的机器」里查看、暂停或删除。</div>
      </Card>
      <Modal open={!!node} onClose={() => setNode(null)} title={node ? (node.name || node.id) : ''}
        foot={<><Btn ghost onClick={() => setNode(null)}>关闭</Btn>
          {node && hasRt(node, 'comfyui') && <Btn sm ghost onClick={() => assign('image')}>派 ComfyUI 给它</Btn>}
          {node && hasRt(node, 'build') && <Btn sm ghost onClick={() => assign('build')}>派编译给它</Btn>}
          <Btn sm onClick={() => assign('render')}>派渲染/转码给它</Btn></>}>
        {node && (
          <>
            <div className="hint" style={{ marginTop: 0 }}>{node.os} · {node.cpus} 核 · {node.mem_mb ? Math.round(node.mem_mb / 1024) + 'GB' : ''} · {(node.gpus || []).map(g => g.name + ' ' + g.mem_mb + 'MB').join('、') || '无独显'}</div>
            <div style={{ marginTop: 8 }}>{(node.runtimes || []).map(r => <Tag key={r.name}>{r.name}</Tag>)}{node.vm && <Tag tone="gpu">云主机 · {node.vm.accel || 'qemu'}</Tag>}{(node.encoders || []).map(e => <Tag key={e}>{e}</Tag>)}</div>
            <div className="stats">
              <Stat v={node.active + '/' + node.slots} l="占用槽位" />
              <Stat v={node.speed > 0 ? f2(node.speed) + '×' : '—'} l="实测吞吐" />
              <Stat v={f2(node.price)} l="基准单价（点）" />
            </div>
            {node.comfy_models && (
              <div style={{ marginTop: 12 }}>
                <div className="hint" style={{ marginTop: 0 }}>
                  <b>ComfyUI 本地模型</b>（{node.comfy_models.reachable ? '在线可达' : '暂不可达'}）：
                </div>
                {(node.comfy_models.checkpoints || []).length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <span className="sub-line">Checkpoints：</span>
                    {(node.comfy_models.checkpoints || []).slice(0, 12).map(m => <Tag key={m} tone="on">{m}</Tag>)}
                    {(node.comfy_models.checkpoints || []).length > 12 && <Tag>+{node.comfy_models.checkpoints.length - 12}</Tag>}
                  </div>
                )}
                {(node.comfy_models.loras || []).length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <span className="sub-line">LoRAs：</span>
                    {(node.comfy_models.loras || []).slice(0, 12).map(m => <Tag key={m}>{m}</Tag>)}
                    {(node.comfy_models.loras || []).length > 12 && <Tag>+{node.comfy_models.loras.length - 12}</Tag>}
                  </div>
                )}
              </div>
            )}
            <div className="hint" style={{ marginTop: 10 }}>指定后任务只会派给这台节点；它离线时会排队等待上线。</div>
            <div className="hint num">编号 {node.id}</div>
          </>
        )}
      </Modal>
    </div>
  )
}