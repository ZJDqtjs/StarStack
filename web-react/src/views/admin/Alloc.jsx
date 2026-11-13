import React, { useCallback, useEffect, useState } from 'react'
import { useApp } from '../../store.jsx'
import { Card, Btn, Tag, St, Empty, Stat, Field } from '../../ui.jsx'
import { api, f2 } from '../../api.js'

export default function AdminAlloc() {
  const { workers, target, setTarget, toast, confirm, isAdminApp } = useApp()
  const platform = isAdminApp ? workers : workers.filter(w => w.mine)
  const [nodeId, setNodeId] = useState('')
  const [price, setPrice] = useState('0.8')
  const [ups, setUps] = useState([])
  const [upId, setUpId] = useState('')

  const loadUps = useCallback(async () => { try { const d = await api('/api/models/upstreams'); setUps(d.upstreams || []) } catch (e) {} }, [])
  useEffect(() => { loadUps() }, [loadUps])
  useEffect(() => { if (!nodeId && platform.length) { setNodeId(platform[0].id); setPrice(String(platform[0].price)) } }, [platform, nodeId])
  useEffect(() => { if (!upId && ups.length) setUpId(ups[0].id) }, [ups, upId])

  const node = workers.find(w => w.id === nodeId) || null
  const up = ups.find(u => u.id === upId) || null
  const enabledUps = ups.filter(u => u.enabled)
  const cheapest = enabledUps.slice().sort((a, b) => a.price - b.price)[0] || null

  const selectNode = id => { setNodeId(id); const w = workers.find(x => x.id === id); if (w) setPrice(String(w.price)) }
  const applyPrice = async () => {
    if (!node) return
    const v = +price; if (!(v >= 0.05 && v <= 1000)) { toast('单价需在 0.05 ~ 1000 之间', 'warn'); return }
    try { await api('/api/nodes/' + encodeURIComponent(node.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price: v }) }); toast('节点单价已调拨为 ' + f2(v), 'ok') } catch (e) { toast(String(e), 'bad') }
  }
  const pauseNode = async (id, paused) => { try { await api('/api/nodes/' + encodeURIComponent(id) + '/pause', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }) }); toast(paused ? '已暂停派活（排水）' : '已恢复派活', 'ok') } catch (e) { toast(String(e), 'bad') } }
  const toggleUp = async (id, enabled) => {
    const prev = ups
    setUps(v => v.map(u => u.id === id ? { ...u, enabled } : u))
    try { await api('/api/models/upstreams/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }); toast(enabled ? '上游进入路由' : '上游退出路由', 'ok') }
    catch (e) { setUps(prev); toast(String(e), 'bad', '已回滚') }
  }
  const bulk = async paused => {
    if (!platform.length) { toast('没有平台自营节点', 'warn'); return }
    if (!await confirm(paused ? '暂停全部平台节点派活（排水）？' : '恢复全部平台节点派活？', '批量调拨')) return
    for (const w of platform) { try { await api('/api/nodes/' + encodeURIComponent(w.id) + '/pause', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }) }) } catch (e) {} }
    toast(paused ? '已批量暂停' : '已批量恢复', 'ok')
  }
  const refresh = () => { loadUps(); if (node) setPrice(String(node.price)); toast('已刷新', 'info') }
  const reset = () => { if (node) setPrice(String(node.price)) }
  const applyInline = async (id, v) => {
    const p = +v; if (!(p >= 0.05 && p <= 1000)) { toast('单价需在 0.05 ~ 1000 之间', 'warn'); return }
    try { await api('/api/nodes/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price: p }) }); toast('单价已更新', 'ok') } catch (e) { toast(String(e), 'bad') }
  }

  return (
    <div>
      <div className="phead">
        <div className="phead-txt"><span className="eyebrow">Compute Allocation</span><h1>算力调拨</h1><p>对平台自营节点与 API 池路由做实时调拨：单价、派活开关、目标指派与上游启停。第三方节点不可强制调拨。</p></div>
      </div>

      <div className="ctrl-region">
        <div className="ctrl-title">调拨控制台 <Tag tone="warn">实时生效</Tag></div>
        <div className="ctrl-grid">
          <div className="ctrl-item"><label>平台节点</label>
            <select value={nodeId} onChange={e => selectNode(e.target.value)}>{platform.length ? platform.map(w => <option key={w.id} value={w.id}>{w.name || w.id}</option>) : <option value="">无平台节点</option>}</select></div>
          <div className="ctrl-item"><label>单价滑杆（点/视频秒） <span className="ctrl-val">{f2(price)}</span></label>
            <input className="range" type="range" min="0.05" max="5" step="0.05" value={Math.min(5, +price || 0.05)} onChange={e => setPrice(e.target.value)} /></div>
          <div className="ctrl-item"><label>单价步进</label>
            <input type="number" min="0.05" max="1000" step="0.05" value={price} onChange={e => setPrice(e.target.value)} /></div>
          <div className="ctrl-item"><label>派活开关</label>
            <label className="check" style={{ margin: 0, padding: '8px 12px' }}><input type="checkbox" checked={!!node && !node.paused} disabled={!node} onChange={e => node && pauseNode(node.id, !e.target.checked)} style={{ width: 'auto' }} /><span>{node ? (node.paused ? '已暂停' : '派活中') : '—'}</span></label></div>
          <div className="ctrl-item"><label>下一任务目标指派</label>
            <select value={target || ''} onChange={e => setTarget(e.target.value || null)}><option value="">不指定（自动调度）</option>{workers.map(w => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}</select></div>
          <div className="ctrl-item"><label>上游路由</label>
            <select value={upId} onChange={e => setUpId(e.target.value)}>{ups.length ? ups.map(u => <option key={u.id} value={u.id}>{u.name}</option>) : <option value="">无上游</option>}</select></div>
          <div className="ctrl-item"><label>上游启停</label>
            <label className="check" style={{ margin: 0, padding: '8px 12px' }}><input type="checkbox" checked={!!up && up.enabled} disabled={!up} onChange={e => up && toggleUp(up.id, e.target.checked)} style={{ width: 'auto' }} /><span>{up ? (up.enabled ? '路由中' : '已停用') : '—'}</span></label></div>
          <div className="ctrl-item"><label>操作</label>
            <div className="ctrl-actions">
              <Btn sm onClick={applyPrice} disabled={!node}>应用单价</Btn>
              <Btn sm ghost onClick={reset}>重置</Btn>
              <Btn sm ghost onClick={refresh}>刷新</Btn>
            </div></div>
        </div>
        <div className="ctrl-actions" style={{ marginTop: 12 }}>
          <Btn sm ghost onClick={() => bulk(true)}>批量暂停平台节点</Btn>
          <Btn sm ghost onClick={() => bulk(false)}>批量恢复平台节点</Btn>
          {target && <Btn sm ghost onClick={() => setTarget(null)}>清除目标指派</Btn>}
        </div>
      </div>

      <div className="grid">
        <Card kicker="Preview" title="调拨预览">
          {node ? (
            <div className="stats" style={{ marginTop: 0 }}>
              <Stat v={f2(node.price)} l="当前单价" />
              <Stat hl v={f2(price)} l="拟调拨单价" />
              <Stat v={node.active + '/' + node.slots} l="占用槽位" />
              <Stat v={node.paused ? '暂停' : '派活'} l="派活状态" />
            </div>
          ) : <Empty>无平台节点</Empty>}
          <div className="hint">目标指派：{target ? <b>{(workers.find(w => w.id === target) || {}).name || target}</b> : '自动调度'}。上游路由最低价：{cheapest ? <b>{cheapest.name} · {f2(cheapest.price)} 点/千token</b> : '—'}（路由挑最便宜健康上游）。</div>
        </Card>
        <Card kicker="Routing" title="API 池路由启停">
          {ups.length ? ups.map(u => (
            <div className="listrow" key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 13 }}>{u.name}</b> {u.official && <Tag tone="mine">官方</Tag>}<span className="sub-line">{f2(u.price)} 点/千token · {(u.models || []).join('/')}</span></div>
              <Btn sm ghost onClick={() => toggleUp(u.id, !u.enabled)}>{u.enabled ? '停用' : '启用'}</Btn>
            </div>
          )) : <Empty>无上游</Empty>}
        </Card>
      </div>

      <Card kicker="Platform Nodes" title={isAdminApp ? '可调度节点（inline 调拨）' : '平台自营节点（可 inline 调拨）'}>
        <div className="tablewrap"><table><thead><tr><th>节点</th><th>状态</th><th>槽位</th><th>当前单价</th><th>调拨单价</th><th>派活</th></tr></thead>
          <tbody>{platform.length ? platform.map(w => (
            <tr key={w.id}>
              <td><b>{w.name || w.id}</b><span className="sub-line">{w.os} · {w.cpus} 核</span></td>
              <td><St s={w.online ? (w.paused ? 'stopped' : 'running') : 'failed'}>{w.online ? (w.paused ? '暂停' : '在线') : '离线'}</St></td>
              <td className="num">{w.active}/{w.slots}</td>
              <td className="num">{f2(w.price)}</td>
              <td><InlinePrice id={w.id} cur={w.price} onDone={applyInline} /></td>
              <td><Btn ghost tiny onClick={() => pauseNode(w.id, !w.paused)}>{w.paused ? '恢复' : '暂停'}</Btn></td>
            </tr>
          )) : <tr><td colSpan={6} className="empty">没有平台自营节点</td></tr>}</tbody></table></div>
      </Card>
    </div>
  )
}
function InlinePrice({ id, cur, onDone }) {
  const [v, setV] = useState(String(cur))
  useEffect(() => { setV(String(cur)) }, [cur])
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input type="number" min="0.05" max="1000" step="0.05" value={v} onChange={e => setV(e.target.value)} style={{ width: 90, height: 30 }} />
      <Btn ghost tiny onClick={() => onDone(id, v)}>应用</Btn>
    </div>
  )
}