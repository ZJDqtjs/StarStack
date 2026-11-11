import React, { useEffect, useState } from 'react'
import { openExternal } from '../api'
import { useApp } from '../ctx'
import { Btn, Card, CopyBlock, Empty, Field, Loader, Sheet, Stats, Tag } from '../ui'
import { CommSheet } from './CommLog'
import { f1, f2, memGB } from '../../../shared/index.js'

const ua = (navigator.userAgent || '').toLowerCase()
const guessOS = () => (ua.includes('windows') ? 'windows' : ua.includes('mac') ? 'darwin' : 'linux')
const guessArch = () => (/arm|aarch64/.test(ua) ? 'arm64' : 'amd64')

// The WPF shell (WebView2) exposes a message channel and runs the worker on this
// machine; the plain web build has neither, so it keeps the download flow.
const desktopHost: any = typeof window !== 'undefined' ? (window as any).chrome?.webview : null
const isDesktop = !!desktopHost

export default function Nodes() {
  const { api, workers, policy, showToast } = useApp()
  const [f, setF] = useState({ name: '', price: '0.80', slots: '2', os: guessOS(), arch: guessArch() })
  const [msg, setMsg] = useState('')
  const [scriptUrl, setScriptUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<any[] | null>(null)
  const [code, setCode] = useState('')
  const [editing, setEditing] = useState<any>(null)
  const [price, setPrice] = useState('')
  const [logNode, setLogNode] = useState<any>(null)
  const [deleting, setDeleting] = useState<any>(null)
  const [dup, setDup] = useState<Record<string, boolean>>({})
  const [hostState, setHostState] = useState<any>(null)
  const [hostLog, setHostLog] = useState<string[]>([])
  const set = (k: string, v: any) => setF((prev) => ({ ...prev, [k]: v }))

  const mine = (workers || []).filter((w: any) => w.mine)

  useEffect(() => {
    let alive = true
    api
      .contribution()
      .then((d: any) => {
        if (!alive) return
        const m: Record<string, boolean> = {}
        for (const n of d?.nodes || []) if (n.duplicate) m[n.id] = true
        setDup(m)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [api, mine.length])

  useEffect(() => {
    if (!desktopHost) return
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data
      if (!d || typeof d !== 'object') return
      if (d.kind === 'node.state') {
        setHostState(d)
        if (Array.isArray(d.tail) && d.tail.length) setHostLog(d.tail.slice(-60))
      } else if (d.kind === 'node.log') {
        setHostLog((prev) => [...prev.slice(-59), String(d.line)])
      }
    }
    desktopHost.addEventListener('message', onMessage)
    desktopHost.postMessage({ kind: 'node.state' })
    return () => desktopHost.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (!policy?.pending) return
    api
      .pending()
      .then((d: any) => setPending(d.pending || []))
      .catch(() => setPending([]))
  }, [api, policy])

  const launch = async () => {
    const body = { name: f.name.trim() || '我的节点', price: Number(f.price), slots: Number(f.slots), os: f.os, arch: f.arch }
    if (!(body.price >= 0.05)) return showToast('单价至少 0.05 点/视频秒', 'bad')
    if (!(body.slots >= 1)) return showToast('并发槽至少 1 个', 'bad')
    setBusy(true)
    setMsg('正在生成启动码…')
    try {
      const d = await api.launchNode(body)
      openExternal(api.launchScriptUrl(d.bundle || d.script))
      setScriptUrl(api.launchScriptUrl(d.script))
      const mins = Math.max(1, Math.round(d.expires_in_sec / 60))
      setMsg(`节点包已开始下载（${d.node_id}，${mins} 分钟内有效）。解压后直接双击 starstack-node.exe 即可加入，配置在包里，不需要 bat；关掉窗口即停止。${d.ready ? '' : ' 注意：Broker 上还没有对应平台的 Agent 程序。'}`)
      showToast('启动脚本已生成')
    } catch (e: any) {
      setMsg('生成失败：' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const runLocal = async () => {
    const body = { name: f.name.trim() || '桌面节点', price: Number(f.price), slots: Number(f.slots), os: guessOS(), arch: guessArch() }
    if (!(body.price >= 0.05)) return showToast('单价至少 0.05 点/视频秒', 'bad')
    if (!(body.slots >= 1)) return showToast('并发槽至少 1 个', 'bad')
    setBusy(true)
    setMsg('正在生成启动码…')
    try {
      // The ticket binds the node to this account; the shell launches the worker
      // that already ships with the app, so nothing is downloaded this time.
      const d = await api.launchNode(body)
      desktopHost.postMessage({
        kind: 'node.run',
        payload: {
          server: api.baseUrl(),
          nodeId: d.node_id,
          name: body.name,
          price: body.price,
          slots: body.slots,
          launch: d.code,
        },
      })
      setMsg(`已请求在本机启动节点 ${d.node_id}：关掉窗口或点「停止」即停止接活。`)
      showToast('本机节点启动中')
    } catch (e: any) {
      setMsg('启动失败：' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const claim = async () => {
    const c = code.trim().toUpperCase()
    if (!c) return
    try {
      const r = await api.pair(c)
      setCode('')
      showToast('已认领节点 ' + r.node_id)
    } catch (e: any) {
      showToast('认领失败：' + (e.message || e), 'bad')
    }
  }

  const savePrice = async () => {
    const n = Number(price)
    if (!(n > 0)) return showToast('请输入大于 0 的单价', 'bad')
    try {
      await api.setNodePrice(editing.id, n)
      setEditing(null)
      showToast('已更新单价')
    } catch (e: any) {
      showToast('改价失败：' + (e.message || e), 'bad')
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    try {
      await api.deleteNode(deleting.id)
      showToast('节点已删除')
      setDeleting(null)
    } catch (e: any) {
      showToast('删除失败：' + (e.message || e), 'bad')
    }
  }

  return (
    <div className="stack">
      <div className="viewhead">
        <h1>我的节点</h1>
        <p>
          {isDesktop
            ? '选好配置直接在本机运行，也可以下载节点包给另一台机器。'
            : '把闲置机器接进来赚算力点：下载节点包，解压后直接双击 exe；启动脚本作为备选。'}
        </p>
        <p className="hint">
          一台电脑只对应一个节点：重复下载或重启节点包会复用原来的节点，收益与信誉连续累计，不会再生成第二个。
          贡献只统计校验通过的任务分片和已结算的云主机租用，在线挂机不计贡献。
        </p>
      </div>

      <Card kicker="Provider" title="一键提供算力">
        <Field label="机器名称">
          <input className="in" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="例如 宿舍的台式机" />
        </Field>
        <div className="row">
          <Field label="单价（点/视频秒）">
            <input className="in" type="number" min="0.05" step="0.05" value={f.price} onChange={(e) => set('price', e.target.value)} />
          </Field>
          <Field label="并发槽">
            <input className="in" type="number" min="1" value={f.slots} onChange={(e) => set('slots', e.target.value)} />
          </Field>
        </div>
        <div className="row">
          <Field label="那台机器的系统">
            <select className="in" value={f.os} onChange={(e) => set('os', e.target.value)}>
              <option value="windows">Windows</option>
              <option value="linux">Linux</option>
              <option value="darwin">macOS</option>
            </select>
          </Field>
          <Field label="芯片">
            <select className="in" value={f.arch} onChange={(e) => set('arch', e.target.value)}>
              <option value="amd64">x86_64</option>
              <option value="arm64">arm64</option>
            </select>
          </Field>
        </div>
        <div className="btnrow">
          {isDesktop ? (
            <>
              <Btn block onClick={runLocal} disabled={busy || !!hostState?.running || !!hostState?.starting}>
                {busy ? <span className="spin" /> : null}
                {hostState?.running
                  ? `本机节点运行中 · ${hostState.nodeId}`
                  : hostState?.starting
                    ? '正在准备本机节点…'
                    : '在本机运行（不用再下载）'}
              </Btn>
              <Btn variant="ghost" tiny onClick={launch} disabled={busy}>
                下载节点包（给另一台机器）
              </Btn>
            </>
          ) : (
            <Btn block onClick={launch} disabled={busy}>
              {busy ? <span className="spin" /> : null} 下载节点包（exe + 配置）
            </Btn>
          )}
        </div>
        {msg && <div className="hint" style={{ marginTop: 8 }}>{msg}</div>}
        {isDesktop && (
          <div style={{ marginTop: 10 }}>
            <div className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Tag tone={hostState?.running ? 'ok' : hostState?.starting ? 'warn' : ''}>
                {hostState?.running ? '本机节点运行中' : hostState?.starting ? '准备中' : '本机节点未运行'}
              </Tag>
              {hostState?.running ? (
                <>
                  <span className="mono">PID {hostState.pid} · 启动编号 {hostState.nodeId}</span>
                  <Btn variant="ghost" tiny onClick={() => desktopHost.postMessage({ kind: 'node.stop' })}>
                    停止
                  </Btn>
                </>
              ) : hostState?.starting ? (
                <>
                  <span>首次运行会从平台取一次节点程序，之后直接复用。</span>
                  <Btn variant="ghost" tiny onClick={() => desktopHost.postMessage({ kind: 'node.stop' })}>
                    取消
                  </Btn>
                </>
              ) : (
                <span>用当前配置在本机加入算力池；关掉应用会一并停止。</span>
              )}
            </div>
            {hostLog.length > 0 && <pre className="code">{hostLog.slice(-8).join('\n')}</pre>}
          </div>
        )}
        {scriptUrl && (
          <div className="btnrow">
            <Btn variant="ghost" tiny onClick={() => openExternal(scriptUrl)}>
              启动脚本（备选）
            </Btn>
          </div>
        )}
        <div className="hint" style={{ marginTop: 10 }}>
          {isDesktop
            ? '本机运行会先检查 ffmpeg/blender 等运行时，再以你的账户身份加入算力池；下载按钮留给另一台机器。'
            : '脚本一次有效、30 分钟内可用；Agent 会先检查 ffmpeg/blender 等运行时，再以你的账户身份加入算力池。'}
          在同一台电脑上重复启动只会回到原来那个节点，不会新开一个。
        </div>
      </Card>

      <Card kicker="Manual" title="手动运行 Agent">
        <CopyBlock
          text={`starstack-worker --server ${api.baseUrl()} \\\n  --name ${f.name || '我的旧台式机'} --price ${f.price}${policy?.public ? ' \\\n  --token <运维分配的接入令牌>' : ''}`}
        />
        <Field label="配对码" hint="Agent 启动后会打印一次性配对码，输入即可把机器挂到你的账户下。">
          <div className="row">
            <input className="in" value={code} onChange={(e) => setCode(e.target.value)} placeholder="例如 A1B2C3" />
            <Btn variant="ghost" onClick={claim}>
              认领
            </Btn>
          </div>
        </Field>
      </Card>

      {policy?.pending && (
        <Card kicker="Pending" title="待认领的 Agent">
          {!pending ? (
            <Loader />
          ) : pending.length === 0 ? (
            <Empty>没有待认领的机器</Empty>
          ) : (
            <div className="list">
              {pending.map((x: any) => (
                <div className="listrow" key={x.id}>
                  <div className="grow">
                    <div className="name">{x.name || x.id}</div>
                    <div className="meta">
                      {x.os} · {x.cpus} 核 · {f2(x.price)} 点/秒
                    </div>
                    <div className="tags">
                      <Tag tone={x.online ? 'ok' : 'bad'}>{x.online ? '在线' : '离线'}</Tag>
                      <Tag>{x.code}</Tag>
                    </div>
                  </div>
                  <Btn variant="ghost" tiny onClick={() => api.pair(x.code).then(() => showToast('已认领 ' + x.id)).catch((e: any) => showToast('认领失败：' + e.message, 'bad'))}>
                    认领
                  </Btn>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card kicker="Mine" title={`我的机器（${mine.length}）`}>
        {mine.length === 0 ? (
          <Empty>还没有属于你的节点</Empty>
        ) : (
          mine.map((w: any) => (
            <div key={w.id} style={{ paddingTop: 10 }}>
              <h3 style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {w.name || w.id}
                <Tag tone={w.online ? 'ok' : 'bad'}>{w.online ? '在线' : '离线'}</Tag>
                {w.paused && <Tag tone="warn">已暂停</Tag>}
                {dup[w.id] && <Tag tone="warn">同设备重复节点，建议删除</Tag>}
                {!w.device_id && <Tag tone="warn">旧版节点（无设备指纹）</Tag>}
              </h3>
              <Stats
                items={[
                  { v: f2(w.earned), k: '节点贡献（点）', hl: true },
                  { v: f2(w.earned_task || 0), k: '其中：任务算力' },
                  { v: f2(w.earned_vm || 0), k: '其中：云主机' },
                  { v: f1(w.billed_task_sec || 0) + 's', k: '已结算任务时长' },
                  { v: f1(w.billed_vm_sec || 0) + 's', k: '已结算租用时长' },
                  { v: `${w.active}/${w.slots}`, k: '占用槽位' },
                  { v: f2(w.price), k: '当前单价' },
                  { v: `${w.ok}/${w.ok + w.bad}`, k: '成功/总数' },
                ]}
              />
              <div className="hint" style={{ marginTop: 8 }}>
                任务时长是视频/墙钟秒，租用时长是运行秒，两者分开统计；
                {Number(w.earned || 0) - Number(w.earned_task || 0) - Number(w.earned_vm || 0) > 0.01
                  ? ` 其中 ${f2(Number(w.earned || 0) - Number(w.earned_task || 0) - Number(w.earned_vm || 0))} 点为升级前的历史收益。`
                  : ''}
              </div>
              <div className="hint" style={{ marginTop: 8 }}>
                {w.hostname || ''} · {w.os} · {w.cpus} 核 · {memGB(w.mem_mb)} · 空闲磁盘 {w.disk_free_mb ? memGB(w.disk_free_mb) : '未知'}
              </div>
              <div className="btnrow">
                <Btn variant="ghost" tiny onClick={() => setLogNode(w)}>
                  通讯日志
                </Btn>
                <Btn variant="ghost" tiny onClick={() => { setEditing(w); setPrice(String(w.price)) }}>
                  调整单价
                </Btn>
                <Btn
                  variant="ghost"
                  tiny
                  onClick={() =>
                    api
                      .pauseNode(w.id, !w.paused)
                      .then(() => showToast(w.paused ? '已恢复派活' : '已暂停派活'))
                      .catch((e: any) => showToast('操作失败：' + e.message, 'bad'))
                  }
                >
                  {w.paused ? '恢复派活' : '暂停派活'}
                </Btn>
                <Btn variant="ghost" tiny onClick={() => setDeleting(w)}>
                  删除节点
                </Btn>
              </div>
              <div className="hint mono" style={{ marginTop: 8 }}>
                编号 {w.id} · 设备 {w.device_id || '（旧版节点未采集）'}
              </div>
            </div>
          ))
        )}
      </Card>

      <CommSheet open={!!logNode} title={'通讯日志 · ' + (logNode?.name || '')} loader={() => api.nodeLogs(logNode.id)} onClose={() => setLogNode(null)} />

      <Sheet open={!!editing} title="调整单价" onClose={() => setEditing(null)}>
        <div className="hint">{editing?.name || editing?.id} 当前 {f2(editing?.price)} 点/视频秒</div>
        <Field label="新单价（算力点 / 视频秒）">
          <input className="in" type="number" min="0.05" step="0.05" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <div className="btnrow">
          <Btn block onClick={savePrice}>
            保存
          </Btn>
        </div>
      </Sheet>

      <Sheet open={!!deleting} title="删除节点" onClose={() => setDeleting(null)}>
        <div className="hint">
          将把「{deleting?.name || deleting?.id}」从你的节点列表移除。已结算的收益流水、任务分片和通讯记录会保留用于对账，不会退回余额。
        </div>
        {deleting?.online && (
          <div className="hint" style={{ marginTop: 8 }}>
            这台机器目前在线：删除后不再接活，请记得关闭机上的节点程序；想重新加入请重新下载节点包。
          </div>
        )}
        <div className="btnrow" style={{ marginTop: 12 }}>
          <Btn variant="ghost" onClick={() => setDeleting(null)}>
            取消
          </Btn>
          <Btn onClick={doDelete}>确认删除</Btn>
        </div>
      </Sheet>
    </div>
  )
}
