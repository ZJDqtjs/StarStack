import React, { useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Card, Tag, St, Bar, Empty, I } from '../ui.jsx'
import { api, f2, relTime, KIND, ST } from '../api.js'

const QUICK = [
  ['image', '生图', 'ComfyUI 工作流出图', 'var(--c-image)', 'image'],
  ['video', '生视频', '镜头描述直达队列', 'var(--c-video)', 'video'],
  ['render', '渲染 / 转码', '切片并行 · 哈希校验', 'var(--c-render)', 'render'],
  ['build', '编排编译', '源码 zip → 产物回传', 'var(--c-build)', 'build'],
  ['api', '模型 API', 'OpenAI 兼容网关', 'var(--c-api)', 'api'],
  ['nodes', '接入机器', '闲置算力赚收益', 'var(--c-vm)', 'nodes'],
]
export default function Home() {
  const { me, workers, jobs, contrib } = useApp()
  const [ledger, setLedger] = useState([])
  useEffect(() => {
    let stop = false
    const load = () => api('/api/ledger').then(d => { if (!stop) setLedger((d.spend || []).slice(0, 5)) }).catch(() => {})
    load()
    const iv = setInterval(load, 10000)
    return () => { stop = true; clearInterval(iv) }
  }, [])
  const active = jobs.filter(j => ['queued', 'running', 'pending'].includes(j.status)).length
  const myOnline = workers.filter(w => w.mine && w.online).length
  const recent = jobs.slice(0, 4)

  return (
    <div>
      <div className="home-hero">
        <div>
          <h1>你好，{me ? me.name : ''}</h1>
          <p>这里是你的算力控制台：提交创作任务、买卖算力服务、管理接入的机器，一站式完成。</p>
        </div>
        <div className="hero-actions">
          <button className="hero-btn solid" onClick={() => nav('render')}>＋ 新建任务</button>
          <button className="hero-btn" onClick={() => nav('market')}>逛服务市场</button>
          <button className="hero-btn" onClick={() => nav('nodes')}>接入机器</button>
        </div>
      </div>
      <div className="home-stats">
        <div className="hstat"><div className="hstat-top"><span>账户余额</span><span className="hstat-ic"><I name="wallet" size={14} /></span></div><b>{f2(me ? me.credits : 0)}</b><small>算力点 · <a href="#/wallet">去充值</a></small></div>
        <div className="hstat"><div className="hstat-top"><span>进行中任务</span><span className="hstat-ic"><I name="render" size={14} /></span></div><b>{active}</b><small><a href="#/jobs">查看全部任务</a></small></div>
        <div className="hstat"><div className="hstat-top"><span>我的在线节点</span><span className="hstat-ic"><I name="nodes" size={14} /></span></div><b>{myOnline}</b><small><a href="#/nodes">管理节点</a></small></div>
        <div className="hstat"><div className="hstat-top"><span>累计贡献</span><span className="hstat-ic"><I name="trend" size={14} /></span></div><b>{contrib && contrib.seller ? f2(contrib.seller.total_earned) : '—'}</b><small>卖家贡献合计 · <a href="#/wallet">明细</a></small></div>
      </div>
      <Card kicker="Quick" title="快速开始">
        <div className="quick-grid">
          {QUICK.map(([v, t, d, color, icon]) => (
            <button key={v} className="quick" onClick={() => nav(v)}>
              <span className="q-ic" style={{ background: color }}><I name={icon} size={15} /></span>
              <b>{t}</b><span>{d}</span>
            </button>
          ))}
        </div>
      </Card>
      <div className="grid">
        <Card kicker="Recent" title="最近任务" side={<button className="ghost tiny" onClick={() => nav('jobs')}>全部 →</button>}>
          {recent.length ? recent.map(j => {
            const done = (j.segs || []).filter(s => s.status === 'done').length
            const pct = j.segs && j.segs.length ? done / j.segs.length * 100 : 0
            return (
              <div className="mini-job" key={j.id} style={{ cursor: 'pointer' }} onClick={() => nav('jobs')}>
                <div className="mj-main"><b>{j.name}</b><Bar pct={pct} /></div>
                <div className="mj-side"><St s={j.status}>{ST[j.status] || j.status}</St><span className="sub-line">{done}/{(j.segs || []).length}</span></div>
              </div>
            )
          }) : <Empty inline>还没有任务，去创作页提交第一个吧</Empty>}
        </Card>
        <Card kicker="Ledger" title="最近流水" side={<button className="ghost tiny" onClick={() => nav('wallet')}>全部 →</button>}>
          {ledger.length ? ledger.map((e, i) => (
            <div className="mini-job" key={i}>
              <div className="mj-main"><b>{e.note || KIND[e.kind] || e.kind}</b><span className="sub-line">{relTime(e.ts)}</span></div>
              <div className="mj-side"><span className={e.amount >= 0 ? 'pos' : 'neg'}>{e.amount >= 0 ? '+' : ''}{f2(e.amount)}</span><span className="sub-line">余 {f2(e.balance)}</span></div>
            </div>
          )) : <Empty inline>暂无流水</Empty>}
        </Card>
      </div>
    </div>
  )
}