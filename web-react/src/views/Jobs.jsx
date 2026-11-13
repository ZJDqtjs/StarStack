import React, { useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Card, Btn, Tag, St, Empty, Modal, Stat, Bar } from '../ui.jsx'
import { api, href, f1, f2, apiTS, ST } from '../api.js'

const INFLIGHT = ['fetching', 'leased', 'running', 'uploading']
const COMM_EVENT = { 'job.created': '任务创建', 'job.done': '任务完成', 'job.failed': '任务失败', 'job.cancelled': '任务取消', 'seg.dispatched': '派发给节点', 'seg.fetching': '节点取源', 'seg.running': '节点开始执行', 'seg.uploading': '节点回传', 'seg.done': '分片完成', 'seg.failed': '分片失败', 'seg.settled': '结算', 'offer.auto_share': '共享自动交付' }
const COMM_ACTOR = { buyer: '买方', seller: '卖方', server: '平台' }
function commDetail(e) {
  try {
    const d = JSON.parse(e.detail || '{}'), p = []
    if (d.kind) p.push('类型 ' + d.kind)
    if (d.hold !== undefined) p.push('预扣 ' + f2(d.hold) + ' 点')
    if (d.index !== undefined) p.push('#' + d.index)
    if (d.wall !== undefined) p.push('耗时 ' + f1(d.wall) + ' 秒')
    if (d.match !== undefined) p.push(d.match ? '哈希一致' : '哈希不一致')
    if (d.cost !== undefined) p.push('结算 ' + f2(d.cost) + ' 点')
    if (d.refunded !== undefined) p.push('退还 ' + f2(d.refunded) + ' 点')
    if (d.err) p.push(String(d.err).slice(0, 160))
    return p.join(' · ')
  } catch (x) { return e.detail || '' }
}
export default function Jobs() {
  const { jobs, toast, confirm } = useApp()
  const [logs, setLogs] = useState(null)
  const [logsTitle, setLogsTitle] = useState('')
  const openLogs = async id => {
    setLogsTitle('通讯日志 · ' + id); setLogs([])
    try { const d = await api('/api/jobs/' + encodeURIComponent(id) + '/logs'); setLogs(d.logs || []) } catch (e) { setLogs(null) }
  }
  const cancel = async id => {
    if (!await confirm('取消任务？未使用的预扣会立即退还。', '取消任务')) return
    try { await api('/api/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST' }); toast('任务已取消，预扣将退还', 'ok') } catch (e) { toast(String(e), 'bad') }
  }
  return (
    <div>
      <div className="phead">
        <div className="phead-txt"><span className="eyebrow">My Jobs</span><h1>我的任务</h1><p>每个分片的派发去向、进度、哈希校验与结算都在这里；跨 Broker 重启恢复的任务不计量加速比。</p></div>
        <div className="phead-actions"><Btn sm onClick={() => nav('render')}>＋ 新建任务</Btn></div>
      </div>
      <div className="tip">任务状态每秒自动刷新。完成的任务可直接下载产物；失败分片不结算，未使用的预扣会自动退还。</div>
      {jobs.length ? jobs.map(j => {
        const done = j.segs.filter(s => s.status === 'done').length
        const pct = j.segs.length ? done / j.segs.length * 100 : 0
        const speedup = (!j.resumed && j.wall > 0) ? j.sum_wall / j.wall : 0
        const verified = j.segs.filter(s => s.match).length
        return (
          <div className="job" key={j.id}>
            <h3><span className="jname">{j.name}</span> <St s={j.status}>{j.kind === 'build' && j.status === 'running' ? '编译中' : (ST[j.status] || j.status)}</St>
              <Tag>预扣 {f2(j.credits_hold || 0)} 点</Tag>
              {j.resumed && <Tag tone="gpu">跨重启恢复</Tag>}
              <Btn ghost tiny onClick={() => openLogs(j.id)}>通讯日志</Btn>
              {(j.status === 'queued' || j.status === 'running') && <Btn ghost tiny onClick={() => cancel(j.id)}>取消任务</Btn>}
              {j.status === 'done' && <Btn ghost tiny onClick={() => { location.href = href('/download/' + j.id) }}>下载产物</Btn>}
              {j.baseline && j.baseline.status === 'done' && <Btn ghost tiny onClick={() => { location.href = href('/download/' + j.id + '?which=baseline') }}>下载基线</Btn>}
            </h3>
            <div className="note">{j.note}</div>
            <div className="prog"><Bar pct={pct} /><span className="sub-line">{done}/{j.segs.length}</span></div>
            <div className="pieces">
              {j.segs.map(s => {
                const cls = s.status === 'done' ? 'done' : s.status === 'failed' ? 'failed' : INFLIGHT.includes(s.status) ? 'running' : 'pending'
                const h = Math.max(2, Math.min(100, s.status === 'done' ? 100 : s.pct))
                return <div key={s.index} className={'pc ' + cls} title={'#' + s.index + ' · ' + (s.worker || '—') + ' · 成本 ' + f2(s.cost || 0) + ' 点'}>
                  <div className="fill" style={{ height: h + '%' }} /><div className="lbl">#{s.index}<br />{(s.worker || '—').slice(0, 10)}</div></div>
              })}
            </div>
            <div className="stats">
              <Stat v={f1(j.wall || 0) + 's'} l="分布式墙钟" />
              <Stat v={speedup > 0 ? f2(speedup) + 'x' : '—'} l="分片并行比" />
              <Stat v={done + '/' + j.segs.length} l="分片完成" />
              <Stat v={verified + '/' + j.segs.length} l="哈希校验一致" />
              <Stat v={f2(j.credits_spent || 0)} l="实结算点数" />
              {j.released && j.credits_hold > j.credits_spent && <Stat v={'+' + f2(j.credits_hold - j.credits_spent)} l="预扣退还" />}
              {j.baseline && j.baseline.status === 'done' && <Stat hl v={(!j.resumed && j.baseline.wall > 0 && j.wall > 0) ? f2(j.baseline.wall / j.wall) + 'x' : '—'} l="真实加速比" />}
            </div>
            {j.err && <div className="err">错误：{j.err}</div>}
          </div>
        )
      }) : <Empty>还没有任务，去创作页提交第一个吧</Empty>}
      <Modal open={logs !== null} onClose={() => setLogs(null)} title={logsTitle} size="lg">
        {logs && logs.length ? (
          <div className="list">{logs.map((e, i) => (
            <div className="listrow" key={i}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <b>{COMM_EVENT[e.event] || e.event}</b>
                <Tag tone={e.actor === 'buyer' ? 'mine' : e.actor === 'seller' ? 'gpu' : ''}>{COMM_ACTOR[e.actor] || e.actor}</Tag>
                {e.node_id && <Tag>{e.node_id}</Tag>}
              </div>
              <div className="hint" style={{ marginTop: 4 }}>{apiTS(e.ts)}</div>
              {commDetail(e) && <div className="hint" style={{ marginTop: 2 }}>{commDetail(e)}</div>}
            </div>
          ))}</div>
        ) : <Empty>暂无通讯记录</Empty>}
      </Modal>
    </div>
  )
}