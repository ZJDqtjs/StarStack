import React, { useCallback, useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Card, Tabs, Btn, Tag, St, Empty, Modal, SearchBox, Chip, Field, Avatar, Bar } from '../ui.jsx'
import { api, post, href, f2, relTime, apiTS, CAT_LABEL, VM_ST } from '../api.js'

const parseScene = s => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch (e) { return {} } }
const fmtSecs = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return [h, m, x].map(n => String(n).padStart(2, '0')).join(':') }

export function OfferCard({ o, manage, onOpen, onDel }) {
  return (
    <article className={'mk-card cat-' + o.category} onClick={() => onOpen(o)}>
      <div className="mk-cover">
        {manage && <div className="mk-del"><button onClick={e => { e.stopPropagation(); onDel(o.id) }}>删除</button></div>}
        {o.has_image ? <img loading="lazy" src={href('/api/offers/media/' + encodeURIComponent(o.id))} alt={o.title} /> : <div className="mk-ph">{o.title.slice(0, 10)}</div>}
        <span className="mk-cat"><i className="cdot" />{CAT_LABEL[o.category] || o.category}</span>
        {o.auto_share && <span className="mk-auto">自动共享</span>}
        <span className="mk-price">{f2(o.price)} {o.unit}</span>
      </div>
      <h3 className="mk-title">{o.title}</h3>
      <div className="mk-meta"><Avatar name={o.seller} size={20} /><span className="oname">{o.seller}</span><span>·</span><span title={apiTS(o.created_at)}>{relTime(o.created_at)}</span></div>
      {o.spec && <div className="mk-spec">{o.spec}</div>}
    </article>
  )
}

export default function Market({ tab }) {
  const { toast, confirm, prompt, setTarget, setPrefill, workers } = useApp()
  const [t, setT] = useState(tab === 'vm' ? 'vm' : 'offers')
  useEffect(() => { if (tab) setT(tab === 'vm' ? 'vm' : 'offers') }, [tab])
  const [offers, setOffers] = useState([])
  const saved = (() => { try { return JSON.parse(localStorage.getItem('ss-react-market') || '{}') } catch (e) { return {} } })()
  const [q, setQ] = useState(saved.q || '')
  const [cat, setCat] = useState(saved.cat || 'all')
  const [sort, setSort] = useState(saved.sort || 'new')
  useEffect(() => { try { localStorage.setItem('ss-react-market', JSON.stringify({ q, cat, sort })) } catch (e) {} }, [q, cat, sort])
  const [od, setOd] = useState(null)
  const [vmOffers, setVmOffers] = useState([])
  const [instances, setInstances] = useState([])
  const [order, setOrder] = useState(null)
  const [vo, setVo] = useState({ hostname: '', hours: 1, key: '' })
  const [voMsg, setVoMsg] = useState('')
  const [voResult, setVoResult] = useState('')

  const loadOffers = useCallback(async () => { try { const d = await api('/api/offers'); setOffers(d.offers || []) } catch (e) {} }, [])
  const loadVM = useCallback(async () => { try { const [o, i] = await Promise.all([api('/api/vm/offers'), api('/api/vm/instances')]); setVmOffers(o.offers || []); setInstances(i.instances || []) } catch (e) {} }, [])
  useEffect(() => { loadOffers(); const iv = setInterval(loadOffers, 5000); return () => clearInterval(iv) }, [loadOffers])
  useEffect(() => { if (t === 'vm') { loadVM(); const iv = setInterval(loadVM, 4000); return () => clearInterval(iv) } }, [t, loadVM])

  const filtered = offers.filter(o => (cat === 'all' || o.category === cat) && (!q.trim() || [o.title, o.spec, o.seller, o.body].some(x => String(x || '').toLowerCase().includes(q.trim().toLowerCase()))))
    .slice().sort((a, b) => sort === 'priceAsc' ? a.price - b.price : sort === 'priceDesc' ? b.price - a.price : b.created_at - a.created_at)
  const useOffer = async o => {
    try {
      const d = await api('/api/offers/' + encodeURIComponent(o.id) + '/use', { method: 'POST' })
      const off = d.offer || o
      const tpl = parseScene(off.scene)
      const view = CAT_LABEL[off.category] ? off.category : 'render'
      if (off.node_id) setTarget(off.node_id)
      setPrefill({ view, tpl, node_id: off.node_id })
      setOd(null); nav(view)
      toast('已获得共享使用授权，参数已预填', 'ok', '共享已生效')
    } catch (e) { toast(String(e), 'bad', '使用共享失败') }
  }
  const contact = async o => {
    try { const d = await post('/api/offers/' + encodeURIComponent(o.id) + '/conversation', {}); setOd(null); nav('messages'); } catch (e) { toast(String(e), 'bad', '发起会话失败') }
  }
  const delOffer = async id => {
    if (!await confirm('删除后这条挂牌会立即从市场消失，确定？', '删除挂牌')) return
    try { await api('/api/offers/' + encodeURIComponent(id), { method: 'DELETE' }); loadOffers(); toast('挂牌已删除', 'ok') } catch (e) { toast(String(e), 'bad') }
  }
  const rent = o => { setOrder(o); setVo({ hostname: o.name, hours: 1, key: '' }); setVoMsg(''); setVoResult('') }
  const submitOrder = async () => {
    if (!order) return
    setVoMsg('正在预扣并下发启动指令…')
    try {
      const r = await post('/api/vm/orders', { offer_id: order.id, name: vo.hostname.trim(), hours: +vo.hours || 1, ssh_public_key: vo.key.trim() })
      const ins = r.instance
      setVoResult([r.warning, `主机：${ins.name}（${ins.id}）`, `状态：${VM_ST[ins.status] || ins.status} · 预扣 ${f2(ins.hold)} 点`, `SSH 用户：${r.ssh_user}`, `SSH 公钥：${r.ssh_public_key}`, r.ssh_private_key ? 'SSH 私钥：\n' + r.ssh_private_key : 'SSH：使用你填写的公钥登录', `root 口令：${r.root_password}`, `VNC 口令：${r.vnc_password}`, '启动完成后在「我的云主机」查看地址。'].join('\n\n'))
      setVoMsg('下单成功，等待卖方机器启动虚拟机。'); setOrder(null); loadVM()
      toast('下单成功，凭据只显示一次', 'ok', '云主机')
    } catch (e) { setVoMsg('失败：' + e) }
  }
  const stopVm = async id => { if (!await confirm('确定停机？剩余预扣按实际运行秒数结算后退回。', '停机')) return; try { await post('/api/vm/instances/' + encodeURIComponent(id) + '/stop', {}); loadVM(); toast('已停机', 'ok') } catch (e) { toast(String(e), 'bad') } }
  const extendVm = async (id, price) => { const h = await prompt('续费小时数（当前单价 ' + f2(price) + ' 点/小时）', '1', '续费'); if (h === null) return; const hours = +h; if (!(hours > 0)) { toast('请输入大于 0 的小时数', 'warn'); return } try { await post('/api/vm/instances/' + encodeURIComponent(id) + '/extend', { hours }); loadVM(); toast('续费成功', 'ok') } catch (e) { toast(String(e), 'bad') } }

  return (
    <div>
      <div className="phead">
        <div className="phead-txt"><span className="eyebrow">Marketplace</span><h1>服务市场</h1><p>卖家挂牌的算力服务与云主机配置都在这里；自动共享的服务可以直接使用，其余先联系卖家。</p></div>
        <div className="phead-actions"><Btn ghost onClick={() => nav('messages')}>我的会话</Btn><Btn sm onClick={() => nav('sell')}>我要出售 →</Btn></div>
      </div>
      <Tabs items={[{ key: 'offers', label: '服务挂牌' }, { key: 'vm', label: '云主机' }]} active={t} onChange={setT} />
      {t === 'offers' && (
        <>
          <div className="mk-toolbar">
            <SearchBox value={q} onChange={setQ} placeholder="搜索标题、配置或卖家…" />
            <div className="chips">
              <Chip on={cat === 'all'} onClick={() => setCat('all')}>全部</Chip>
              {Object.keys(CAT_LABEL).map(c => <Chip key={c} cat={c} on={cat === c} onClick={() => setCat(c)}><i className="cdot" />{CAT_LABEL[c]}</Chip>)}
            </div>
            <select value={sort} onChange={e => setSort(e.target.value)} aria-label="排序" style={{ height: 34, width: 'auto', flex: '0 0 auto', marginLeft: 'auto' }}>
              <option value="new">最新发布</option><option value="priceAsc">价格升序</option><option value="priceDesc">价格降序</option>
            </select>
          </div>
          <div className="mk-grid">
            {filtered.length ? filtered.map(o => <OfferCard key={o.id} o={o} onOpen={setOd} onDel={delOffer} />) : <Empty>{offers.length ? '没有匹配的服务，换个关键词或分类试试' : '这个版块还没有卖家发布'}</Empty>}
          </div>
        </>
      )}
      {t === 'vm' && (
        <>
          <div className="tip">卖方发布虚拟机配置，买方下单后卖方机器自动用 QEMU 拉起系统镜像，按小时计费、随时停机结算。访问走卖方公网 IPv6。</div>
          <div className="split">
            <Card kicker="Rent" title="可租用的配置">
              {order && (
                <div className="quote">
                  <div>下单：<b>{order.name}</b> <span className="sub-line">{order.cpus}C / {Math.round(order.mem_mb / 1024 * 10) / 10}G / {order.disk_gb}G · {f2(order.price_hour)} 点/小时</span></div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <Field label="主机名称"><input value={vo.hostname} onChange={e => setVo({ ...vo, hostname: e.target.value })} /></Field>
                    <Field label="租期（小时）"><input type="number" min="1" max={order.max_hours} value={vo.hours} onChange={e => setVo({ ...vo, hours: e.target.value })} /></Field>
                  </div>
                  <Field label="SSH 公钥（留空则平台生成，私钥只显示一次）"><textarea rows={2} value={vo.key} onChange={e => setVo({ ...vo, key: e.target.value })} placeholder="ssh-ed25519 AAAA... 留空由平台生成" /></Field>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><Btn sm onClick={submitOrder}>确认租用</Btn><Btn ghost onClick={() => setOrder(null)} style={{ height: 31 }}>取消</Btn></div>
                  <div className="hint">{voMsg}</div>
                </div>
              )}
              {voResult && <pre style={{ whiteSpace: 'pre-wrap' }}>{voResult}</pre>}
              {vmOffers.filter(o => !o.mine && o.enabled).length ? vmOffers.filter(o => !o.mine && o.enabled).map(o => (
                <div className="job" key={o.id} style={{ marginBottom: 10 }}>
                  <h3>{o.name} {o.available ? <Tag tone="on">可租用</Tag> : <Tag tone="off">{o.online ? '已停用' : '节点离线'}</Tag>} <Tag>{o.cpus}C / {Math.round(o.mem_mb / 1024 * 10) / 10}G / {o.disk_gb}G</Tag> <Tag>{f2(o.price_hour)} 点/小时</Tag>
                    <Btn ghost tiny disabled={!o.available} onClick={() => rent(o)}>租用</Btn></h3>
                  <div className="note">{o.os} · {o.image_format} · 卖方节点 {o.node_name || o.node_id} · 最长 {o.max_hours} 小时</div>
                </div>
              )) : <Empty>还没有可租用的云主机配置</Empty>}
            </Card>
            <Card kicker="Mine" title="我的云主机">
              {instances.length ? instances.map(i => {
                const ep = i.endpoints || {}
                return (
                  <div className="job" key={i.id} style={{ marginBottom: 10 }}>
                    <h3>{i.name} <St s={i.status}>{VM_ST[i.status] || i.status}</St> <Tag>{i.cpus}C / {Math.round(i.mem_mb / 1024 * 10) / 10}G</Tag>
                      {i.mine && ['queued', 'provisioning', 'running', 'unreachable'].includes(i.status) && <Btn ghost tiny onClick={() => extendVm(i.id, i.price_hour)}>续费</Btn>}
                      {(i.mine || i.seller_mine) && !['stopped', 'failed'].includes(i.status) && <Btn ghost tiny onClick={() => stopVm(i.id)}>{i.mine ? '停机' : '强制停机'}</Btn>}</h3>
                    <div className="note">{i.node_name || i.node_id} · {f2(i.price_hour)} 点/小时 · 预扣 {f2(i.hold)} · 已用 {f2(i.spent)}</div>
                    {(i.status === 'provisioning' || i.status === 'queued') && <div className="prog"><Bar pct={i.progress || 0} /><span className="sub-line">{Math.round(i.progress || 0)}%</span></div>}
                    <div className="hint">SSH {ep.ssh ? <code>{(ep.ssh_user || i.ssh_user) + '@' + ep.ssh}</code> : '—'} · 剩余 <b>{i.remaining_sec > 0 ? fmtSecs(i.remaining_sec) : (i.status === 'running' ? '已到期' : '—')}</b></div>
                  </div>
                )
              }) : <Empty>还没有租用记录</Empty>}
            </Card>
          </div>
        </>
      )}
      <Modal open={!!od} onClose={() => setOd(null)} title={od ? od.title : ''} size="lg">
        {od && (
          <>
            <div className="hint" style={{ marginTop: 0 }}>{CAT_LABEL[od.category] || od.category} · {f2(od.price)} {od.unit} · 卖家 {od.seller} · {apiTS(od.created_at)}</div>
            {od.spec && <div className="postbody">{od.spec}</div>}
            {od.body ? <div className="postbody">{od.body}</div> : <div className="hint">卖家未填写简介和联系方式。</div>}
            <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {od.auto_share ? <><Tag tone="on">已开通自动共享</Tag><span className="hint" style={{ margin: 0 }}>买家可直接使用，无需先沟通。</span></> : <><Tag tone="off">未开通自动共享</Tag><span className="hint" style={{ margin: 0 }}>请先联系卖家协商。</span></>}
            </div>
            {od.node_id && <div className="hint num">共享节点 {od.node_id}</div>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
              {od.mine ? <Btn sm onClick={() => { setOd(null); nav('messages') }}>查看买家咨询</Btn> : (
                <>
                  {od.auto_share && <Btn sm onClick={() => useOffer(od)}>立即使用{od.node_id ? '节点 / 场景' : '场景任务'}</Btn>}
                  <Btn sm ghost onClick={() => contact(od)}>联系卖家</Btn>
                </>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}