import React, { useCallback, useEffect, useState } from 'react'
import { useApp } from '../../store.jsx'
import { Card, Btn, Tag, Empty, Stat, Field } from '../../ui.jsx'
import { HBar } from '../../charts.jsx'
import { api, post, f2, apiTS, ctxLabel, capNames } from '../../api.js'

const CAPS = ['tools', 'json_object', 'json_schema', 'regex', 'vision', 'reasoning', 'deterministic', 'prefix_cache']
export default function AdminPool() {
  const { toast, confirm } = useApp()
  const [ups, setUps] = useState([])
  const [catalog, setCatalog] = useState([])
  const [usage, setUsage] = useState(null)
  const [comfy, setComfy] = useState(null)
  const [f, setF] = useState({ name: '', base_url: '', api_key: '', models: '', price: '0.5', price_out: '0', price_cached: '0', max_context: '32768', caps: [] })
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [u, c, g, cf] = await Promise.all([
      api('/api/models/upstreams').catch(() => ({ upstreams: [] })),
      api('/api/models/catalog').catch(() => ({ models: [] })),
      api('/api/models/usage?days=7').catch(() => null),
      api('/api/comfy/status').catch(() => null),
    ])
    setUps(u.upstreams || []); setCatalog(c.models || []); setUsage(g); setComfy(cf)
  }, [])
  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv) }, [load])

  const toggle = async (id, enabled) => {
    const prev = ups
    setUps(v => v.map(u => u.id === id ? { ...u, enabled } : u))
    try { await api('/api/models/upstreams/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }); toast(enabled ? '上游已启用（进入路由）' : '上游已停用（退出路由）', 'ok') }
    catch (e) { setUps(prev); toast(String(e), 'bad', '操作失败，已回滚') }
  }
  const del = async id => {
    if (!await confirm('删除后该上游立即退出路由并移除登记，确定？', '删除上游')) return
    try { await api('/api/models/upstreams/' + encodeURIComponent(id), { method: 'DELETE' }); load(); toast('上游已删除', 'ok') } catch (e) { toast(String(e), 'bad') }
  }
  const probe = async () => {
    setMsg('正在请求上游 /v1/models…')
    try { const d = await post('/api/models/upstreams/probe', { base_url: f.base_url.trim(), api_key: f.api_key }); setMsg(`探测成功（${d.latency_ms} ms）：${(d.models || []).join('、')}`); if (!f.models.trim()) setF(x => ({ ...x, models: (d.models || []).slice(0, 8).join(', ') })) }
    catch (e) { setMsg('探测失败：' + e) }
  }
  const deploy = async () => {
    const body = { name: f.name.trim(), base_url: f.base_url.trim(), api_key: f.api_key, models: f.models.trim(), price: +f.price, price_out: +f.price_out || 0, price_cached: +f.price_cached || 0, max_context: +f.max_context || 32768, caps: f.caps.join(',') }
    if (!body.base_url) { setMsg('请填写 Base URL'); return }
    if (!body.models) { setMsg('请填写至少一个模型名'); return }
    if (!(body.price > 0)) { setMsg('输入单价必须大于 0'); return }
    setMsg('正在登记上线…')
    try { await post('/api/models/upstreams', body); setMsg('已上线，模型进入可用目录'); setF({ name: '', base_url: '', api_key: '', models: '', price: '0.5', price_out: '0', price_cached: '0', max_context: '32768', caps: [] }); load(); toast('上游已部署上线', 'ok') }
    catch (e) { setMsg('上线失败：' + e) }
  }
  const official = ups.filter(u => u.official)
  const reqBars = usage ? (usage.by_upstream || []).slice().sort((a, b) => b.requests - a.requests).slice(0, 6).map(x => ({ label: x.name || x.id, value: x.requests })) : []

  return (
    <div>
      <div className="phead">
        <div className="phead-txt"><span className="eyebrow">API Pool · Deploy</span><h1>API 池部署上线</h1><p>管理模型上游（API 池）：登记上线、启停路由、探测健康、删除下线；官方供给由平台账户持有，启动时自动 seeding。</p></div>
      </div>
      <div className="home-stats">
        <div className="hstat"><div className="hstat-top"><span>上游总数</span></div><b>{ups.length}</b><small>路由中 {ups.filter(u => u.enabled).length}</small></div>
        <div className="hstat"><div className="hstat-top"><span>官方供给</span></div><b>{official.length}</b><small>平台自营上游</small></div>
        <div className="hstat"><div className="hstat-top"><span>可用模型</span></div><b>{catalog.length}</b><small>目录条目</small></div>
        <div className="hstat"><div className="hstat-top"><span>ComfyUI</span></div><b>{comfy ? (comfy.reachable ? '在线' : '离线') : '…'}</b><small>执行面状态</small></div>
      </div>
      <div className="grid">
        <Card kicker="Upstreams" title="API 池（上游路由）">
          {ups.length ? ups.map(u => {
            const h = u.health || {}
            return (
              <div className="card" key={u.id} style={{ marginBottom: 10, padding: '16px 18px' }}>
                <h2 style={{ marginBottom: 8 }}>{u.name} {u.official && <Tag tone="mine">官方</Tag>} {u.enabled ? (h.cooling_sec ? <Tag tone="off">冷却 {h.cooling_sec}s</Tag> : <Tag tone="on">路由中</Tag>) : <Tag tone="off">已停用</Tag>}</h2>
                <div className="hint" style={{ marginTop: 0 }}>{u.base_url} · {(u.models || []).join(' / ')}</div>
                <div className="stats">
                  <Stat v={f2(u.price)} l="输入/千token" />
                  <Stat v={f2(u.price_out || u.price)} l="输出/千token" />
                  <Stat v={ctxLabel(u.max_context)} l="上下文" />
                  <Stat v={h.last_ok ? apiTS(h.last_ok).slice(-8) : '—'} l="最近成功" />
                </div>
                {h.last_error && <div className="hint warn">最近错误：{h.last_error}</div>}
                <div className="ctrl-actions" style={{ marginTop: 12 }}>
                  <Btn sm ghost onClick={() => toggle(u.id, !u.enabled)}>{u.enabled ? '停用路由' : '启用路由'}</Btn>
                  <Btn sm ghost danger onClick={() => del(u.id)}>删除下线</Btn>
                </div>
              </div>
            )
          }) : <Empty>还没有上游。用右侧表单部署上线第一条。</Empty>}
        </Card>
        <div>
          <Card kicker="Deploy" title="部署上线新上游">
            <Field label="上游名称"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="例如 官方 4090 · Qwen3-30B" /></Field>
            <Field label="Base URL"><input value={f.base_url} onChange={e => setF({ ...f, base_url: e.target.value })} placeholder="http://host:8080 或 https://…/v1" /></Field>
            <div className="row">
              <Field label="上游 API Key（可选）"><input type="password" value={f.api_key} onChange={e => setF({ ...f, api_key: e.target.value })} /></Field>
              <Field label="输入单价（点/千token）"><input type="number" min="0.0001" step="0.1" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></Field>
            </div>
            <div className="row">
              <Field label="输出单价（0=同输入）"><input type="number" min="0" step="0.1" value={f.price_out} onChange={e => setF({ ...f, price_out: e.target.value })} /></Field>
              <Field label="缓存单价（0=同输入）"><input type="number" min="0" step="0.1" value={f.price_cached} onChange={e => setF({ ...f, price_cached: e.target.value })} /></Field>
            </div>
            <div className="row">
              <Field label="最大上下文"><input type="number" min="1024" step="1024" value={f.max_context} onChange={e => setF({ ...f, max_context: e.target.value })} /></Field>
              <Field label="声明能力">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: 9, fontSize: 12 }}>
                  {CAPS.map(c => <label key={c} style={{ margin: 0, display: 'flex', gap: 5, alignItems: 'center', fontWeight: 400 }}><input type="checkbox" checked={f.caps.includes(c)} onChange={e => setF({ ...f, caps: e.target.checked ? [...f.caps, c] : f.caps.filter(x => x !== c) })} />{capNames[c]}</label>)}
                </div>
              </Field>
            </div>
            <Field label="模型名（逗号分隔）">
              <div style={{ display: 'flex', gap: 8 }}><input value={f.models} onChange={e => setF({ ...f, models: e.target.value })} placeholder="qwen3-30b-a3b, …" /><Btn ghost onClick={probe} style={{ height: 38, flex: '0 0 auto' }}>探测</Btn></div>
            </Field>
            <div className="hint">{msg}</div>
            <div className="formfoot" style={{ marginTop: 14 }}><Btn onClick={deploy}>部署上线</Btn></div>
          </Card>
          <Card kicker="Usage" title="上游调用量（近 7 天）"><HBar data={reqBars} /></Card>
        </div>
      </div>
      <Card kicker="Catalog" title="可用模型目录">
        <div className="tablewrap"><table><thead><tr><th>模型</th><th>上游数</th><th>最低输入单价</th><th>上下文</th><th>能力</th><th>官方</th></tr></thead>
          <tbody>{catalog.length ? catalog.map(m => <tr key={m.id}><td className="num">{m.id}</td><td>{m.providers}</td><td className="num">{f2(m.price_per_1k)}</td><td className="num">{ctxLabel(m.max_context)}</td><td>{(m.capabilities || []).filter(c => c !== 'chat').map(c => <Tag key={c}>{capNames[c] || c}</Tag>)}</td><td>{m.official ? <Tag tone="mine">官方</Tag> : '—'}</td></tr>) : <tr><td colSpan={6} className="empty">暂无模型</td></tr>}</tbody></table></div>
      </Card>
      {usage && (
        <Card kicker="Reconcile" title="用量对账（近 7 天，平台账户）">
          <div className="tablewrap"><table><thead><tr><th>上游</th><th>调用</th><th>失败</th><th>成本（点）</th><th>输入</th><th>输出</th></tr></thead>
            <tbody>{(usage.by_upstream || []).map((x, i) => <tr key={i}><td>{x.name || x.id}</td><td className="num">{x.requests}</td><td className="num">{x.failed}</td><td className="num">{f2(x.cost)}</td><td className="num">{x.prompt}</td><td className="num">{x.completion}</td></tr>)}</tbody></table></div>
        </Card>
      )}
    </div>
  )
}