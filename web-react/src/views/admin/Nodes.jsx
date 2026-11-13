import React, { useMemo, useState } from 'react'
import { useApp } from '../../store.jsx'
import { Card, Btn, Tag, St, Empty, SearchBox, Chip, Stat, Bar, Field } from '../../ui.jsx'
import { api, f1, f2 } from '../../api.js'

export default function AdminNodes() {
  const { workers, toast, confirm, prompt, isAdminApp } = useApp()
  const canControl = w => w.mine || !!isAdminApp
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('load')
  const [sel, setSel] = useState([])
  const [drawer, setDrawer] = useState(null)
  const [price, setPrice] = useState('')

  const platformNodes = workers.filter(w => w.mine)
  const list = useMemo(() => {
    let l = workers.slice()
    if (filter === 'online') l = l.filter(w => w.online && !w.paused)
    if (filter === 'paused') l = l.filter(w => w.paused)
    if (filter === 'offline') l = l.filter(w => !w.online)
    if (filter === 'platform') l = l.filter(w => w.mine)
    if (filter === 'third') l = l.filter(w => !w.mine)
    if (q.trim()) l = l.filter(w => [w.name, w.id, w.os].some(x => String(x || '').toLowerCase().includes(q.trim().toLowerCase())))
    l.sort((a, b) => sort === 'price' ? a.price - b.price : sort === 'name' ? String(a.name).localeCompare(String(b.name)) : (b.active / (b.slots || 1)) - (a.active / (a.slots || 1)))
    return l
  }, [workers, q, filter, sort])

  const toggleSel = id => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const bulkPause = async paused => {
    const ids = sel.filter(id => workers.find(w => w.id === id && canControl(w)))
    if (!ids.length) { toast('所选均为第三方节点，平台无权暂停', 'warn'); return }
    for (const id of ids) { try { await api('/api/nodes/' + encodeURIComponent(id) + '/pause', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }) }) } catch (e) {} }
    toast(paused ? '已暂停所选平台节点' : '已恢复所选平台节点', 'ok'); setSel([])
  }
  const setNodePrice = async (id, p) => {
    const v = +p; if (!(v >= 0.05 && v <= 1000)) { toast('单价需在 0.05 ~ 1000 之间', 'warn'); return }
    try { await api('/api/nodes/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price: v }) }); toast('单价已更新', 'ok') } catch (e) { toast(String(e), 'bad') }
  }
  const pauseNode = async (id, paused) => { try { await api('/api/nodes/' + encodeURIComponent(id) + '/pause', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }) }); toast(paused ? '已暂停派活' : '已恢复派活', 'ok') } catch (e) { toast(String(e), 'bad') } }
  const delNode = async id => {
    if (!await confirm('删除该平台节点？已结算收益流水保留用于对账。', '删除节点')) return
    try { await api('/api/nodes/' + encodeURIComponent(id), { method: 'DELETE' }); toast('节点已删除', 'ok'); setDrawer(null) } catch (e) { toast(String(e), 'bad') }
  }
  const openDrawer = w => { setDrawer(w); setPrice(String(w.price)) }
  const dw = drawer ? workers.find(w => w.id === drawer.id) || drawer : null

  return (
    <div>
      <div className="phead">
        <div className="phead-txt"><span className="eyebrow">Node Monitor</span><h1>节点监控</h1><p>全量算力节点的工作情况：负载、吞吐、信誉、价格与归属。平台自营节点可直接调拨；第三方节点只读。</p></div>
      </div>
      <div className="mk-toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="搜索节点名 / ID / 系统…" />
        <div className="chips">
          {[['all', '全部'], ['online', '在线'], ['paused', '暂停'], ['offline', '离线'], ['platform', '平台自营'], ['third', '第三方']].map(([k, l]) => <Chip key={k} on={filter === k} onClick={() => setFilter(k)}>{l}</Chip>)}
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)} style={{ height: 34, width: 'auto', marginLeft: 'auto' }} aria-label="排序">
          <option value="load">按负载</option><option value="price">按单价</option><option value="name">按名称</option>
        </select>
      </div>
      {sel.length > 0 && (
        <div className="bulkbar">
          已选 <b>{sel.length}</b> 台
          <Btn sm ghost onClick={() => bulkPause(true)}>暂停所选</Btn>
          <Btn sm ghost onClick={() => bulkPause(false)}>恢复所选</Btn>
          <Btn sm ghost onClick={() => setSel([])}>取消选择</Btn>
        </div>
      )}
      <Card kicker="Nodes" title={`全部节点（${list.length}）`}>
        <div className="tablewrap"><table><thead><tr>
          <th style={{ width: 28 }}></th><th>节点</th><th>状态</th><th>负载</th><th>吞吐</th><th>信誉</th><th>单价</th><th>归属</th><th></th>
        </tr></thead><tbody>
          {list.length ? list.map(w => {
            const loadPct = Math.round((w.active / (w.slots || 1)) * 100)
            const rel = w.ok + w.bad > 0 ? Math.round(100 * w.ok / (w.ok + w.bad)) + '%' : '—'
            return (
              <tr key={w.id} className="tap" onClick={() => openDrawer(w)}>
                <td onClick={e => e.stopPropagation()}>{canControl(w) && <input type="checkbox" checked={sel.includes(w.id)} onChange={() => toggleSel(w.id)} aria-label="选择" />}</td>
                <td><b>{w.name || w.id}</b><span className="sub-line">{w.os} · {w.cpus} 核 · {(w.gpus || []).map(g => g.name).join('/') || '无独显'}</span></td>
                <td><St s={w.online ? (w.paused ? 'stopped' : 'running') : 'failed'}>{w.online ? (w.paused ? '暂停' : '在线') : '离线'}</St>{w.parked_sec ? <Tag tone="off">停派 {w.parked_sec}s</Tag> : null}</td>
                <td style={{ minWidth: 110 }}><Bar pct={loadPct} /><span className="sub-line">{w.active}/{w.slots} · {loadPct}%</span></td>
                <td className="num">{w.speed > 0 ? f2(w.speed) + '×' : '—'}</td>
                <td>{rel}<span className="sub-line">✓{w.ok} ✗{w.bad}</span></td>
                <td className="num">{f2(w.price)}</td>
                <td>{w.mine ? <Tag tone="mine">平台自营</Tag> : <Tag>第三方</Tag>}</td>
                <td onClick={e => e.stopPropagation()}>{canControl(w) && <Btn ghost tiny onClick={() => pauseNode(w.id, !w.paused)}>{w.paused ? '恢复' : '暂停'}</Btn>}</td>
              </tr>
            )
          }) : <tr><td colSpan={9} className="empty">没有匹配的节点</td></tr>}
        </tbody></table></div>
      </Card>

      <div className={'drawer-mask' + (dw ? ' on' : '')} onClick={() => setDrawer(null)} />
      <div className={'drawer' + (dw ? ' on' : '')}>
        {dw && (
          <>
            <div className="drawer-head"><h2>{dw.name || dw.id}</h2><Tag tone={dw.mine ? 'mine' : ''}>{dw.mine ? '平台自营' : '第三方'}</Tag><button className="modal-x" onClick={() => setDrawer(null)}>✕</button></div>
            <div className="drawer-body">
              <div className="stats" style={{ marginTop: 0 }}>
                <Stat v={dw.active + '/' + dw.slots} l="占用槽位" />
                <Stat v={dw.speed > 0 ? f2(dw.speed) + '×' : '—'} l="实测吞吐" />
                <Stat v={f2(dw.price)} l="点/秒" />
                <Stat v={(dw.ok + dw.bad) > 0 ? Math.round(100 * dw.ok / (dw.ok + dw.bad)) + '%' : '—'} l="成功率" />
              </div>
              <div className="hint">编号 <span className="num">{dw.id}</span> · {dw.os} · {dw.cpus} 核 · {dw.mem_mb ? Math.round(dw.mem_mb / 1024) + 'GB' : ''}</div>
              <div className="hint">GPU：{(dw.gpus || []).map(g => g.name + ' ' + g.mem_mb + 'MB').join('、') || '无独显'}</div>
              <div className="hint">运行时：{(dw.runtimes || []).map(r => r.name).join('、') || '—'} · 编码：{(dw.encoders || []).join('、') || '—'}</div>
              {canControl(dw) ? (
                <>
                  <div className="divider" />
                  <div className="sec">调拨控制 <small>platform only</small></div>
                  <Field label={`单价（点/视频秒，当前 ${f2(dw.price)}）`}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="number" min="0.05" max="1000" step="0.05" value={price} onChange={e => setPrice(e.target.value)} />
                      <Btn sm onClick={() => setNodePrice(dw.id, price)} style={{ flex: '0 0 auto' }}>应用</Btn>
                    </div>
                  </Field>
                  <div className="ctrl-actions" style={{ marginTop: 14 }}>
                    <Btn sm ghost onClick={() => pauseNode(dw.id, !dw.paused)}>{dw.paused ? '恢复派活' : '暂停派活'}</Btn>
                    <Btn sm ghost danger onClick={() => delNode(dw.id)}>删除节点</Btn>
                  </div>
                  {dw.earned !== undefined && <div className="hint">累计贡献 {f2(dw.earned)} 点（任务 {f2(dw.earned_task || 0)} / 云主机 {f2(dw.earned_vm || 0)}）</div>}
                </>
              ) : (
                <div className="tip" style={{ marginTop: 16 }}>第三方节点归用户所有，平台仅可查看工作情况，不可强制调拨（后端 owner 门控）。</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}