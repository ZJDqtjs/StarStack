import React, { useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Card, Btn, Tag, Empty, Stat, Field } from '../ui.jsx'
import { api, post, href, f1, f2 } from '../api.js'

export default function Nodes() {
  const { workers, policy, contrib, toast, confirm, prompt } = useApp()
  const [l, setL] = useState({ name: '', price: '0.80', slots: 2, os: 'windows', arch: 'amd64' })
  const [lMsg, setLMsg] = useState('')
  const [code, setCode] = useState('')
  const [pairMsg, setPairMsg] = useState('')
  const [pending, setPending] = useState([])
  useEffect(() => {
    const ua = (navigator.userAgent || '').toLowerCase()
    setL(x => ({ ...x, os: ua.includes('windows') ? 'windows' : ua.includes('mac') ? 'darwin' : 'linux', arch: /arm|aarch64/.test(ua) ? 'arm64' : 'amd64' }))
  }, [])
  useEffect(() => {
    if (policy && !policy.pending) return
    let stop = false
    const load = () => api('/api/pending').then(d => { if (!stop) setPending(d.pending || []) }).catch(() => {})
    load(); const iv = setInterval(load, 5000)
    return () => { stop = true; clearInterval(iv) }
  }, [policy])
  const mine = workers.filter(w => w.mine)
  const dup = {}
  ;((contrib || {}).nodes || []).forEach(n => { if (n.duplicate) dup[n.id] = true })

  const launch = async () => {
    if (!(+l.price >= 0.05)) { setLMsg('单价至少 0.05 算力点 / 视频秒'); return }
    if (!(+l.slots >= 1)) { setLMsg('并发槽至少 1 个'); return }
    setLMsg('正在生成启动码…')
    try {
      const d = await post('/api/nodes/launch', { name: l.name.trim(), price: +l.price, slots: +l.slots, os: l.os, arch: l.arch })
      const a = document.createElement('a'); a.href = href(d.bundle || d.script); a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove()
      setLMsg('节点包正在下载（' + d.node_id + '，' + Math.max(1, Math.round(d.expires_in_sec / 60)) + ' 分钟内有效）。解压后双击 starstack-node.exe 即可加入。')
      toast('节点包已生成，拷到目标机器运行即可', 'ok')
    } catch (e) { setLMsg('生成失败：' + e) }
  }
  const pair = async () => {
    const c = code.trim().toUpperCase(); if (!c) return
    try { const r = await post('/api/pair', { code: c }); setPairMsg('已认领节点 ' + r.node_id); setCode(''); toast('已认领节点', 'ok') } catch (e) { setPairMsg('认领失败：' + e) }
  }
  const claim = async c => { try { const r = await post('/api/pair', { code: c }); setPairMsg('已认领节点 ' + r.node_id); toast('已认领节点', 'ok') } catch (e) { setPairMsg('认领失败：' + e) } }
  const reprice = async (id, cur) => {
    const v = await prompt('这台机器要的单价（算力点 / 视频秒）', cur, '调整单价'); if (v === null) return
    const price = +v; if (!(price > 0)) { toast('请输入大于 0 的单价', 'warn'); return }
    try { await api('/api/nodes/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price }) }); toast('单价已更新', 'ok') } catch (e) { toast(String(e), 'bad') }
  }
  const pause = async (id, paused) => { try { await api('/api/nodes/' + encodeURIComponent(id) + '/pause', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }) }); toast(paused ? '已暂停派活' : '已恢复派活', 'ok') } catch (e) { toast(String(e), 'bad') } }
  const del = async id => {
    const w = workers.find(x => x.id === id)
    if (!await confirm('删除节点「' + (w ? (w.name || w.id) : id) + '」？\n\n这台机器会从「我的机器」里移除；已结算的收益流水保留用于对账。\n如果节点程序还在运行，请把它关掉。', '删除节点')) return
    try { await api('/api/nodes/' + encodeURIComponent(id), { method: 'DELETE' }); toast('节点已删除', 'ok') } catch (e) { toast(String(e), 'bad') }
  }

  return (
    <div>
      <div className="phead">
        <div className="phead-txt"><span className="eyebrow">Provider Nodes</span><h1>我的节点</h1><p>把闲置机器接进来赚算力点：下载节点包，解压后直接双击 exe 即可。一台电脑只对应一个节点，收益与信誉连续累计。</p></div>
        <div className="phead-actions"><Btn ghost onClick={() => nav('wallet')}>查看收益 →</Btn></div>
      </div>
      <div className="split">
        <Card kicker="Provider" title="一键提供算力">
          <Field label="机器名称"><input value={l.name} onChange={e => setL({ ...l, name: e.target.value })} placeholder="例如 宿舍的台式机" /></Field>
          <div className="row">
            <Field label="单价（算力点 / 视频秒）"><input type="number" min="0.05" max="1000" step="0.05" value={l.price} onChange={e => setL({ ...l, price: e.target.value })} /></Field>
            <Field label="并发槽"><input type="number" min="1" value={l.slots} onChange={e => setL({ ...l, slots: e.target.value })} /></Field>
          </div>
          <div className="row">
            <Field label="那台机器的系统"><select value={l.os} onChange={e => setL({ ...l, os: e.target.value })}><option value="windows">Windows</option><option value="linux">Linux</option><option value="darwin">macOS</option></select></Field>
            <Field label="芯片"><select value={l.arch} onChange={e => setL({ ...l, arch: e.target.value })}><option value="amd64">x86_64 / Intel·AMD</option><option value="arm64">arm64 / 苹果 M 系</option></select></Field>
          </div>
          <div className="formfoot"><Btn onClick={launch} disabled={policy && !policy['launch_' + l.os]}>下载节点包（exe + 配置）</Btn></div>
          <div className="hint">{lMsg}</div>
          {policy && !policy['launch_' + l.os] && <div className="hint warn">这台 Broker 还没有对应平台的节点程序，一键启动暂不可用；可用下面的手动方式。</div>}
          <details style={{ marginTop: 18 }}>
            <summary className="hint" style={{ cursor: 'pointer' }}>高级用法：手动运行 Provider Agent</summary>
            <pre>{'starstack-worker --server ' + (location.origin) + ' \\\n  --name 我的旧台式机 --price 0.8' + (policy && policy.public ? ' \\\n  --token <运维分配的接入令牌>' : '')}</pre>
            <Field label="配对码">
              <div style={{ display: 'flex', gap: 8 }}><input value={code} onChange={e => setCode(e.target.value)} placeholder="例如 A1B2C3" style={{ textTransform: 'uppercase' }} /><Btn ghost onClick={pair} style={{ height: 38, flex: '0 0 auto' }}>认领</Btn></div>
            </Field>
            <div className="hint">{pairMsg}</div>
          </details>
          {(!policy || policy.pending) && (
            <div>
              <div className="hint" style={{ marginTop: 18 }}>本机已上报、等待认领的 Agent：</div>
              {pending.length ? pending.map(x => (
                <div className="check" key={x.id} style={{ justifyContent: 'space-between', gap: 10, alignItems: 'center', marginTop: 8 }}>
                  <span>{x.name || x.id} · {x.os} · {x.cpus} 核 · {f2(x.price)} 点/秒 <Tag tone={x.online ? 'on' : 'off'}>{x.online ? '在线' : '离线'}</Tag> <Tag>{x.code}</Tag></span>
                  <Btn ghost tiny onClick={() => claim(x.code)}>认领</Btn>
                </div>
              )) : <Empty inline>没有待认领的机器</Empty>}
            </div>
          )}
        </Card>
        <Card kicker="Mine" title="我的机器">
          {mine.length ? mine.map(w => {
            const legacy = Math.max(0, Number(w.earned || 0) - Number(w.earned_task || 0) - Number(w.earned_vm || 0))
            return (
              <div className="card" key={w.id} style={{ marginBottom: 10, padding: '16px 18px' }}>
                <h2 style={{ marginBottom: 10 }}>{w.name || w.id} <Tag tone={w.online ? 'on' : 'off'}>{w.online ? '在线' : '离线'}</Tag>
                  {w.paused && <Tag>已暂停</Tag>}{dup[w.id] && <Tag tone="warn">同设备重复节点</Tag>}{!w.device_id && <Tag tone="warn">旧版节点</Tag>}</h2>
                <div className="stats" style={{ marginTop: 0 }}>
                  <Stat v={f2(w.earned || 0)} l="节点贡献（点）" />
                  <Stat v={f2(w.earned_task || 0)} l="其中：任务算力" />
                  <Stat v={f2(w.earned_vm || 0)} l="其中：云主机" />
                  <Stat v={w.active + '/' + w.slots} l="占用槽位" />
                  <Stat v={f2(w.price)} l="当前单价" />
                  <Stat v={w.ok + '/' + (w.ok + w.bad)} l="成功/总数" />
                </div>
                <div className="hint">编号 <span className="num">{w.id}</span> · {w.os} · {w.cpus} 核 · {w.mem_mb ? Math.round(w.mem_mb / 1024) + 'GB' : ''}{legacy > 0.01 ? ' · 含 ' + f2(legacy) + ' 点历史收益' : ''}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <Btn ghost tiny onClick={() => reprice(w.id, w.price)}>调整单价</Btn>
                  <Btn ghost tiny onClick={() => pause(w.id, !w.paused)}>{w.paused ? '恢复派活' : '暂停派活'}</Btn>
                  <Btn ghost tiny danger onClick={() => del(w.id)}>删除节点</Btn>
                </div>
              </div>
            )
          }) : <Empty>还没有属于你的节点。填好左侧参数，下载节点包开始提供算力。</Empty>}
        </Card>
      </div>
    </div>
  )
}