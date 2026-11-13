import React, { useEffect, useState } from 'react'
import { useApp } from '../../store.jsx'
import { nav } from '../../App.jsx'
import { Card, Kpi, Tag, St, Empty, Btn } from '../../ui.jsx'
import { HBar, Spark, Donut, PALETTE } from '../../charts.jsx'
import { api, f1, f2 } from '../../api.js'

export default function AdminOverview() {
  const { workers, jobs, contrib, me } = useApp()
  const [usage, setUsage] = useState(null)
  const [ups, setUps] = useState([])
  const [catalog, setCatalog] = useState([])
  const [ledger, setLedger] = useState([])
  const [comfy, setComfy] = useState(null)
  useEffect(() => {
    let stop = false
    const load = async () => {
      const [u, up, c, l, cf] = await Promise.all([
        api('/api/models/usage?days=7').catch(() => null),
        api('/api/models/upstreams').catch(() => ({ upstreams: [] })),
        api('/api/models/catalog').catch(() => ({ models: [] })),
        api('/api/ledger').catch(() => ({ earn: [] })),
        api('/api/comfy/status').catch(() => null),
      ])
      if (stop) return
      setUsage(u); setUps(up.upstreams || []); setCatalog(c.models || []); setLedger(l.earn || []); setComfy(cf)
    }
    load(); const iv = setInterval(load, 10000)
    return () => { stop = true; clearInterval(iv) }
  }, [])

  const online = workers.filter(w => w.online)
  const paused = workers.filter(w => w.paused)
  const offline = workers.filter(w => !w.online)
  const totalSlots = workers.reduce((a, w) => a + (w.slots || 0), 0)
  const busy = workers.reduce((a, w) => a + (w.active || 0), 0)
  const free = Math.max(0, totalSlots - busy)
  const throughput = online.reduce((a, w) => a + (w.speed || 0), 0)
  const activeJobs = jobs.filter(j => ['queued', 'running', 'pending'].includes(j.status))
  const enabledUps = ups.filter(u => u.enabled)
  const officialUps = ups.filter(u => u.official)
  const totalCost = usage ? (usage.by_upstream || []).reduce((a, x) => a + (x.cost || 0), 0) : 0
  const totalReq = usage ? (usage.by_upstream || []).reduce((a, x) => a + (x.requests || 0), 0) : 0

  const loadBars = workers.slice().sort((a, b) => (b.active / (b.slots || 1)) - (a.active / (a.slots || 1))).slice(0, 6)
    .map((w, i) => ({ label: w.name || w.id, value: Math.round((w.active / (w.slots || 1)) * 100), color: PALETTE[i % PALETTE.length] }))
  const reqBars = usage ? (usage.by_upstream || []).slice().sort((a, b) => b.requests - a.requests).slice(0, 6)
    .map((x, i) => ({ label: x.name || x.id, value: x.requests, color: PALETTE[i % PALETTE.length] })) : []
  const earnTrend = ledger.slice(0, 12).reverse().map(e => e.amount)

  return (
    <div>
      <div className="admin-hero">
        <div>
          <span className="admin-badge">PLATFORM OPS · 平台自营账户</span>
          <h1 style={{ marginTop: 10 }}>管理总览</h1>
          <p>平台级算力、API 池与部署状态一屏掌握。节点监控、API 池部署上线与算力调拨见左侧管理导航。</p>
        </div>
        <div className="hero-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="hero-btn" style={{ height: 34, padding: '0 15px', borderRadius: 8, border: '1px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.14)', color: '#fff', font: '600 12px var(--sans)', cursor: 'pointer' }} onClick={() => nav('admin-nodes')}>节点监控</button>
          <button className="hero-btn" style={{ height: 34, padding: '0 15px', borderRadius: 8, border: '1px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.14)', color: '#fff', font: '600 12px var(--sans)', cursor: 'pointer' }} onClick={() => nav('admin-pool')}>API 池部署</button>
          <button className="hero-btn" style={{ height: 34, padding: '0 15px', borderRadius: 8, background: '#fff', color: '#b45309', border: 0, font: '600 12px var(--sans)', cursor: 'pointer' }} onClick={() => nav('admin-alloc')}>算力调拨</button>
        </div>
      </div>
      <div className="home-stats">
        <div className="hstat"><div className="hstat-top"><span>在线 / 总节点</span></div><b>{online.length} / {workers.length}</b><small>暂停 {paused.length} · 离线 {offline.length}</small></div>
        <div className="hstat"><div className="hstat-top"><span>空闲 / 总槽位</span></div><b>{free} / {totalSlots}</b><small>占用 {busy}</small></div>
        <div className="hstat"><div className="hstat-top"><span>实测吞吐合计</span></div><b>{f1(throughput)}×</b><small>在线节点速度之和</small></div>
        <div className="hstat"><div className="hstat-top"><span>进行中任务</span></div><b>{activeJobs.length}</b><small>排队/运行/待调度</small></div>
        <div className="hstat"><div className="hstat-top"><span>API 池（路由中/总）</span></div><b>{enabledUps.length} / {ups.length}</b><small>官方 {officialUps.length} · 模型 {catalog.length}</small></div>
        <div className="hstat"><div className="hstat-top"><span>近 7 天网关扣点</span></div><b>{f2(totalCost)}</b><small>调用 {totalReq} 次</small></div>
      </div>
      <div className="grid">
        <Card kicker="Load" title="节点负载 Top（占用率 %）">
          <HBar data={loadBars} unit="%" />
        </Card>
        <Card kicker="Status" title="节点状态分布">
          <Donut data={[
            { label: '在线', value: online.filter(w => !w.paused).length, color: '#10b981' },
            { label: '暂停', value: paused.length, color: '#f59e0b' },
            { label: '离线', value: offline.length, color: '#ef4444' },
          ]} />
        </Card>
      </div>
      <div className="grid">
        <Card kicker="Gateway" title="上游调用量 Top（近 7 天）">
          <HBar data={reqBars} />
        </Card>
        <Card kicker="Revenue" title="节点收益趋势（最近流水）">
          <Spark points={earnTrend} color="#10b981" height={90} />
          <div className="hint">卖家贡献合计 {contrib && contrib.seller ? f2(contrib.seller.total_earned) : '—'} 点</div>
        </Card>
      </div>
      <Card kicker="Deploy" title="后端部署状态">
        <div className="quick-grid">
          <div className="quick" style={{ cursor: 'default' }}>
            <span className="q-ic" style={{ background: comfy && comfy.reachable ? '#10b981' : '#ef4444' }}><Ico name="image" /></span>
            <b>ComfyUI 执行面</b>
            <span>{comfy ? (comfy.reachable ? '已连接 · 可提交队列' : '未连接 · 离线编辑模式') : '未配置 / 离线'}</span>
          </div>
          <div className="quick" style={{ cursor: 'default' }}>
            <span className="q-ic" style={{ background: '#0ea5e9' }}><Ico name="api" /></span>
            <b>模型网关</b>
            <span>{catalog.length} 个模型 · {enabledUps.length} 条路由中</span>
          </div>
          <div className="quick" style={{ cursor: 'default' }}>
            <span className="q-ic" style={{ background: '#8b5cf6' }}><Ico name="pool" /></span>
            <b>API 池（官方供给）</b>
            <span>{officialUps.length} 条官方上游 ·  seeding 于启动时</span>
          </div>
          <button className="quick" onClick={() => nav('admin-pool')}>
            <span className="q-ic" style={{ background: '#f59e0b' }}><Ico name="settings" /></span>
            <b>部署 / 上线管理</b>
            <span>登记上游、启停路由、探测 →</span>
          </button>
        </div>
      </Card>
    </div>
  )
}
function Ico({ name }) {
  const P = { image: 'M3 4h18v16H3zM8.5 9.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M21 16l-5-5-6 7', api: 'M4 7l4 5-4 5M12 19h8', pool: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M3.6 9h16.8M3.6 15h16.8', settings: 'M4 8h10M18 8h2M4 16h2M10 16h10M16 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 16m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0' }
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={P[name] || P.pool} /></svg>
}