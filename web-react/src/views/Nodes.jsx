import React, { useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Card, Btn, Tag, Empty, Stat, Field, Modal } from '../ui.jsx'
import { api, post, href, f2, workerTS, apiTS, durCN } from '../api.js'

const COMM_EVENT = { 'job.created': '任务创建', 'job.done': '任务完成', 'job.failed': '任务失败', 'job.cancelled': '任务取消', 'seg.dispatched': '派发给节点', 'seg.fetching': '节点取源', 'seg.running': '节点开始执行', 'seg.uploading': '节点回传', 'seg.done': '分片完成', 'seg.failed': '分片失败', 'seg.settled': '结算', 'offer.auto_share': '共享自动交付' }
const COMM_ACTOR = { buyer: '买方', seller: '卖方', server: '平台' }
function commDetail(e) {
  try {
    const d = JSON.parse(e.detail || '{}'), p = []
    if (d.kind) p.push('类型 ' + d.kind)
    if (d.index !== undefined) p.push('#' + d.index)
    if (d.dur !== undefined) p.push('时长 ' + f2(d.dur))
    if (d.price !== undefined) p.push('单价 ' + f2(d.price) + ' 点')
    if (d.wall !== undefined) p.push('耗时 ' + durCN(d.wall))
    if (d.match !== undefined) p.push(d.match ? '哈希一致' : '哈希不一致')
    if (d.cost !== undefined) p.push('结算 ' + f2(d.cost) + ' 点')
    if (d.err) p.push(String(d.err).slice(0, 160))
    return p.join(' · ')
  } catch (x) { return e.detail || '' }
}

// 设备系统标签：windows_x64 / linux_arm64 / darwin_x64 …
// os 在 state 里是 "windows/amd64" 这样的组合值，arch 单独给，两者都兜底。
const sysTag = w => {
  const raw = String(w?.os || '').toLowerCase()
  const [osPart, archPart] = raw.split('/')
  const os = (osPart || '').trim()
  let arch = String(w?.arch || archPart || '').toLowerCase().trim()
  if (arch === 'amd64' || arch === 'x86_64' || arch === 'x64') arch = 'x64'
  else if (arch === 'arm64' || arch === 'aarch64') arch = 'arm64'
  return [os, arch].filter(Boolean).join('_') || '未知系统'
}

export default function Nodes() {
  const { workers, policy, contrib, toast, confirm, prompt } = useApp()
  const [l, setL] = useState({ name: '', price: '0.80', slots: 2, os: 'windows', arch: 'amd64', build: false, comfyui: false })
  const [lMsg, setLMsg] = useState('')
  const [code, setCode] = useState('')
  const [pairMsg, setPairMsg] = useState('')
  const [pending, setPending] = useState([])
  const [logs, setLogs] = useState(null)
  const [logsTitle, setLogsTitle] = useState('')
  const [logsErr, setLogsErr] = useState('')
  const openLogs = async (id, label) => {
    setLogsTitle('节点通讯日志 · ' + (label || id))
    setLogs([]); setLogsErr('')
    try {
      const d = await api('/api/nodes/' + encodeURIComponent(id) + '/logs')
      setLogs(d.logs || [])
    } catch (e) { setLogsErr(String(e)) }
  }
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

  // 桌面端的 WebView2 宿主：只有在 exe 里才存在。它能直接在本机拉起 worker，
  // 不需要下载节点包；网页端没有这个对象，相关 UI 也就不渲染。
  const host = (typeof window !== 'undefined' && window.chrome && window.chrome.webview) || null
  const [hostState, setHostState] = useState(null)
  const [hostLog, setHostLog] = useState([])
  useEffect(() => {
    if (!host) return
    const onMsg = ev => {
      const d = ev.data
      if (!d || typeof d !== 'object') return
      if (d.kind === 'node.state') {
        setHostState(d)
        if (Array.isArray(d.tail) && d.tail.length) setHostLog(d.tail.slice(-40))
      } else if (d.kind === 'node.log') {
        setHostLog(prev => [...prev.slice(-39), String(d.line)])
      }
    }
    host.addEventListener('message', onMsg)
    host.postMessage({ kind: 'node.state' })
    return () => host.removeEventListener('message', onMsg)
  }, [host])

  const runLocal = async () => {
    if (!(+l.price >= 0.05)) { setLMsg('单价至少 0.05 算力点 / 视频秒'); return }
    if (!(+l.slots >= 1)) { setLMsg('并发槽至少 1 个'); return }
    const name = l.name.trim() || '桌面节点'
    setLMsg('正在生成启动码…')
    try {
      // 与下载节点包同一个接口：先拿到绑定了账号的启动码，再交给主进程拉起 worker。
      const d = await post('/api/nodes/launch', { name, price: +l.price, slots: +l.slots, os: l.os, arch: l.arch, allow_build: !!l.build, comfyui: !!l.comfyui })
      // server 留空：页面看到的是本地反代地址，真实 Broker 由主进程补齐。
      host.postMessage({
        kind: 'node.run',
        payload: { server: '', nodeId: d.node_id, name, price: +l.price, slots: +l.slots, launch: d.code, allowBuild: !!d.build, comfyui: !!d.comfyui }
      })
      setLMsg('已请求在本机启动节点 ' + d.node_id + '：关掉窗口或点「停止」即停止接活。' + (d.build ? '（含编译任务）' : '') + (d.comfyui ? '（含 ComfyUI 任务）' : ''))
    } catch (e) { setLMsg('启动失败：' + e) }
  }

  const launch = async () => {
    if (!(+l.price >= 0.05)) { setLMsg('单价至少 0.05 算力点 / 视频秒'); return }
    if (!(+l.slots >= 1)) { setLMsg('并发槽至少 1 个'); return }
    setLMsg('正在生成启动码…')
    try {
      const d = await post('/api/nodes/launch', { name: l.name.trim(), price: +l.price, slots: +l.slots, os: l.os, arch: l.arch, allow_build: !!l.build, comfyui: !!l.comfyui })
      const a = document.createElement('a'); a.href = href(d.bundle || d.script); a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove()
      setLMsg('节点包正在下载（' + d.node_id + '，' + Math.max(1, Math.round(d.expires_in_sec / 60)) + ' 分钟内有效）。解压后双击 starstack-node.exe 即可加入。' + (d.build ? '本机会接编译任务。' : '') + (d.comfyui ? '本机会接 ComfyUI 任务。' : ''))
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
  const offlineMine = mine.filter(w => !w.online)
  const pruneOffline = async () => {
    if (!offlineMine.length) return
    if (!await confirm('清理这 ' + offlineMine.length + ' 台离线节点？\n\n它们会从「我的机器」里移除，已结算的收益流水保留用于对账。\n还有任务在跑的机器会被跳过；想重新接入请重新下载节点包。', '清理离线节点')) return
    let ok = 0, fail = 0
    for (const w of offlineMine) {
      try { await api('/api/nodes/' + encodeURIComponent(w.id), { method: 'DELETE' }); ok++ } catch (e) { fail++ }
    }
    toast('已清理 ' + ok + ' 台离线节点' + (fail ? '，' + fail + ' 台仍有任务在跑，稍后再试' : ''), fail ? 'warn' : 'ok')
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
          {policy && policy.allow_build && (
            <label className="check">
              <input type="checkbox" checked={!!l.build} onChange={e => setL({ ...l, build: e.target.checked })} />
              <span><b>接受编译任务</b><br />这台机器会执行买家上传的编译命令——以你的用户身份、在你的磁盘上跑。不同意就不勾，只接转码 / 渲染。</span>
            </label>
          )}
          <label className="check" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={!!l.comfyui} onChange={e => setL({ ...l, comfyui: e.target.checked })} style={{ width: 'auto' }} />
            允许执行 ComfyUI 任务
          </label>
          <div className="hint">
            勾选后这台机器会以 <span className="num">--allow-comfy</span> 启动：平台派发的 prompt 图交给它本机的
            ComfyUI（默认 <span className="num">127.0.0.1:8188</span>）执行，按次结算。启动节点前请先打开 ComfyUI。
          </div>
          <div className="formfoot"><Btn onClick={launch} disabled={policy && !policy['launch_' + l.os]}>下载节点包（exe + 配置）</Btn></div>
          <div className="hint">{lMsg}</div>
          {host && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
              <div className="hint" style={{ marginTop: 0 }}>
                本机节点：{hostState && hostState.running ? '运行中' : hostState && hostState.starting ? '启动中…' : '未运行'}
                {hostState && hostState.nodeId ? ' · ' + hostState.nodeId : ''}
                {hostState && hostState.pid ? ' · PID ' + hostState.pid : ''}
                　桌面端可在本机直接开节点，不用下载节点包。
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <Btn onClick={runLocal} disabled={hostState && (hostState.running || hostState.starting)}>在本机直接运行</Btn>
                <Btn ghost disabled={!hostState || !hostState.running} onClick={() => host.postMessage({ kind: 'node.stop' })}>停止本机节点</Btn>
              </div>
              {hostLog.length > 0 && (
                <pre style={{ marginTop: 10, maxHeight: 130, overflow: 'auto', fontSize: 12 }}>{hostLog.join('\n')}</pre>
              )}
            </div>
          )}
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
        <Card kicker="Mine" title="我的机器" side={offlineMine.length ? <Btn ghost tiny onClick={pruneOffline}>清理离线节点（{offlineMine.length}）</Btn> : null}>
          {mine.length ? mine.map(w => {
            const legacy = Math.max(0, Number(w.earned || 0) - Number(w.earned_task || 0) - Number(w.earned_vm || 0))
            return (
              <div className="card" key={w.id} style={{ marginBottom: 10, padding: '16px 18px' }}>
                <h2 style={{ marginBottom: 10 }}>{w.name || w.id} <Tag tone={w.online ? 'on' : 'off'}>{w.online ? '在线' : '离线'}</Tag>
                  <Tag>{sysTag(w)}</Tag>
                  {w.last_seen ? <Tag>{workerTS(w)}</Tag> : null}
                  {w.paused && <Tag>已暂停</Tag>}{dup[w.id] && <Tag tone="warn">同设备重复节点</Tag>}{!w.device_id && <Tag tone="warn">未采集设备指纹</Tag>}
                  {(w.runtimes || []).some(r => r.name === 'comfyui') && <Tag tone="on">可执行 ComfyUI</Tag>}</h2>
                <div className="stats" style={{ marginTop: 0 }}>
                  <Stat v={f2(w.earned || 0)} l="节点贡献（点）" />
                  <Stat v={f2(w.earned_task || 0)} l="其中：任务算力" />
                  <Stat v={f2(w.earned_vm || 0)} l="其中：云主机" />
                  <Stat v={w.active + '/' + w.slots} l="占用槽位" />
                  <Stat v={f2(w.price)} l="当前单价" />
                  <Stat v={w.ok + '/' + (w.ok + w.bad)} l="成功/总数" />
                </div>
                <div className="hint">编号 <span className="num">{w.id}</span> · {w.os} · {w.cpus} 核 · {w.mem_mb ? Math.round(w.mem_mb / 1024) + 'GB' : ''}{legacy > 0.01 ? ' · 含 ' + f2(legacy) + ' 点历史收益' : ''}</div>
                {w.comfy_models && (
                  <div className="hint" style={{ marginTop: 4 }}>
                    ComfyUI 模型：{w.comfy_models.reachable
                      ? <>Checkpoint <b>{(w.comfy_models.checkpoints || []).length}</b> 个 · LoRA <b>{(w.comfy_models.loras || []).length}</b> 个
                        {(w.comfy_models.checkpoints || []).length > 0 && <>（{(w.comfy_models.checkpoints || []).slice(0, 3).join('、')}{(w.comfy_models.checkpoints || []).length > 3 ? ' 等' : ''}）</>}
                      </>
                      : <Tag tone="off">本机 ComfyUI 未连通</Tag>}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <Btn ghost tiny onClick={() => reprice(w.id, w.price)}>调整单价</Btn>
                  <Btn ghost tiny onClick={() => pause(w.id, !w.paused)}>{w.paused ? '恢复派活' : '暂停派活'}</Btn>
                  <Btn ghost tiny onClick={() => openLogs(w.id, w.name || w.id)}>通讯日志</Btn>
                  <Btn ghost tiny danger onClick={() => del(w.id)}>删除节点</Btn>
                </div>
              </div>
            )
          }) : <Empty>还没有属于你的节点。填好左侧参数，下载节点包开始提供算力。</Empty>}
        </Card>
      </div>
      <Modal open={logs !== null} onClose={() => { setLogs(null); setLogsErr('') }} title={logsTitle} size="lg">
        {logsErr ? <div className="err">读取失败：{logsErr}</div> : logs && logs.length ? (
          <div className="list">{logs.map((e, i) => (
            <div className="listrow" key={i}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <b>{COMM_EVENT[e.event] || e.event}</b>
                <Tag tone={e.actor === 'buyer' ? 'mine' : e.actor === 'seller' ? 'gpu' : ''}>{COMM_ACTOR[e.actor] || e.actor}</Tag>
                {e.job_id && <Tag>任务 {String(e.job_id).slice(0, 10)}</Tag>}
              </div>
              <div className="hint" style={{ marginTop: 4 }}>{apiTS(e.ts)}</div>
              {commDetail(e) && <div className="hint" style={{ marginTop: 2 }}>{commDetail(e)}</div>}
            </div>
          ))}</div>
        ) : <Empty>暂无通讯记录（节点接活后会自动记入每次派发、校验与结算）</Empty>}
      </Modal>
    </div>
  )
}