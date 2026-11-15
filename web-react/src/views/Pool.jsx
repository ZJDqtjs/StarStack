import React, { useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Card, Btn, Tag, Modal, Stat } from '../ui.jsx'
import { api, f1, f2 } from '../api.js'

export default function Pool() {
  const { workers, setTarget, toast, confirm, prompt } = useApp()
  const [node, setNode] = useState(null)
  const on = workers.filter(w => w.online)
  const buckets = {}
  on.forEach(w => {
    const free = Math.max(0, w.slots - w.active)
    const gpu = (w.gpus || []).reduce((a, b) => b.mem_mb > (a && a.mem_mb || 0) ? b : a, (w.gpus || [])[0])
    ;(w.encoders || []).forEach(e => {
      const b = buckets[e] || (buckets[e] = { enc: e, nodes: 0, free: 0, min: w.price, max: w.price, speed: 0, gpu: null })
      b.nodes++; b.free += free; b.speed += w.speed
      if (w.price < b.min) b.min = w.price
      if (w.price > b.max) b.max = w.price
      if (gpu && (!b.gpu || gpu.mem_mb > b.gpu.mem_mb)) b.gpu = gpu
    })
  })
  const rows = Object.values(buckets)
  const reprice = async (id, cur) => {
    const v = await prompt('这台机器要的单价（算力点 / 视频秒）', cur, '调整单价'); if (v === null) return
    const price = +v; if (!(price > 0)) { toast('请输入大于 0 的单价', 'warn'); return }
    try { await api('/api/nodes/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price }) }); toast('单价已更新', 'ok') } catch (e) { toast(String(e), 'bad') }
  }
  const assign = () => { setTarget(node.id); setNode(null); nav('render'); toast('已指定节点，任务只会派给它', 'ok') }

  return (
    <div>
      <div className="phead">
        <div className="phead-txt"><span className="eyebrow">Capacity Pool</span><h1>算力市场</h1><p>按编码能力聚合的可调度切片与全部在线节点。他人机器只展示规格与价格，不展示主机名与地址。</p></div>
        <div className="phead-actions"><Btn ghost onClick={() => nav('nodes')}>接入我的机器 →</Btn></div>
      </div>
      <Card kicker="Capacity" title="按能力聚合的可调度切片">
        <div className="tablewrap"><table><thead><tr><th>编码能力</th><th>在线节点</th><th>空闲槽位</th><th>单价区间</th><th>实测吞吐</th><th>最强独显</th></tr></thead>
          <tbody>{rows.length ? rows.map(b => (
            <tr key={b.enc}><td><b>{b.enc}</b>{/nvenc|qsv|amf/.test(b.enc) && <Tag tone="gpu">GPU/ASIC</Tag>}</td><td className="num">{b.nodes}</td><td className="num">{b.free}</td>
              <td className="num">{b.min === b.max ? f2(b.min) + ' 点/秒' : f2(b.min) + ' ~ ' + f2(b.max) + ' 点/秒'}</td>
              <td className="num">{(b.speed / b.nodes) > 0 ? f2(b.speed / b.nodes) + '×' : '—'}</td><td>{b.gpu ? b.gpu.name + ' ' + b.gpu.mem_mb + 'MB' : '—'}</td></tr>
          )) : <tr><td colSpan={6} className="empty">尚无在线算力</td></tr>}</tbody></table></div>
        <div className="hint">一台机器可出现在多行；真实并发看「空闲槽位」。点击下面的节点可以把它指定给下一个任务。</div>
      </Card>
      <Card kicker="Nodes" title="全部在线节点">
        <div className="tablewrap"><table><thead><tr><th>节点</th><th>硬件</th><th>运行时</th><th>编码能力</th><th>占用</th><th>吞吐</th><th>信誉</th><th>单价</th></tr></thead>
          <tbody>{workers.length ? workers.map(w => {
            const rel = w.ok + w.bad > 0 ? Math.round(100 * w.ok / (w.ok + w.bad)) + '%' : '—'
            return (
              <tr key={w.id} className="tap" onClick={() => setNode(w)}>
                <td><b>{w.name || w.id}</b><span className="sub-line">{w.os}</span>{w.mine && <Tag tone="mine">我的机器</Tag>}<br /><Tag tone={w.online ? 'on' : 'off'}>{w.online ? '在线' : '离线 ' + f1(w.since) + 's'}</Tag></td>
                <td>{w.cpus} 核 · {w.mem_mb ? Math.round(w.mem_mb / 1024) + 'GB' : '内存未知'}<br />{(w.gpus || []).map(g => g.name + ' ' + g.mem_mb + 'MB').join('、') || '无独显'}</td>
                <td>{(w.runtimes || []).map(r => <Tag key={r.name}>{r.name}</Tag>)}</td>
                <td style={{ maxWidth: 190 }}>{(w.encoders || []).map(e => <Tag key={e}>{e}</Tag>)}</td>
                <td className="num">{w.active}/{w.slots}</td>
                <td className="num">{w.speed > 0 ? f2(w.speed) + '×' : '—'}</td>
                <td>{rel}<span className="sub-line">✓{w.ok} ✗{w.bad}</span>{w.parked_sec ? <Tag tone="off">停派 {w.parked_sec}s</Tag> : null}</td>
                <td className="num">{f2(w.price)} 点/秒{w.mine && <><br /><Btn ghost tiny onClick={e => { e.stopPropagation(); reprice(w.id, w.price) }}>改价</Btn></>}</td>
              </tr>
            )
          }) : <tr><td colSpan={8} className="empty">尚无节点注册</td></tr>}</tbody></table></div>
      </Card>
      <Modal open={!!node} onClose={() => setNode(null)} title={node ? (node.name || node.id) : ''}
        foot={<><Btn ghost onClick={() => setNode(null)}>关闭</Btn><Btn sm onClick={assign}>派任务给这台节点</Btn></>}>
        {node && (
          <>
            <div className="hint" style={{ marginTop: 0 }}>{node.os} · {node.cpus} 核 · {node.mem_mb ? Math.round(node.mem_mb / 1024) + 'GB' : ''} · {(node.gpus || []).map(g => g.name + ' ' + g.mem_mb + 'MB').join('、') || '无独显'}</div>
            <div style={{ marginTop: 8 }}>{(node.runtimes || []).map(r => <Tag key={r.name}>{r.name}</Tag>)}{(node.encoders || []).map(e => <Tag key={e}>{e}</Tag>)}</div>
            <div className="stats">
              <Stat v={node.active + '/' + node.slots} l="占用槽位" />
              <Stat v={node.speed > 0 ? f2(node.speed) + '×' : '—'} l="实测吞吐" />
              <Stat v={f2(node.price)} l="点/秒" />
            </div>
            <div className="hint" style={{ marginTop: 10 }}>指定后任务只会派给这台节点；它离线时会排队等待上线。</div>
            <div className="hint num">编号 {node.id}</div>
          </>
        )}
      </Modal>
    </div>
  )
}