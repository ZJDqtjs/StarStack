import React, { useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import { Card, Btn, Tag, Empty, Stat, Field } from '../ui.jsx'
import { api, post, f2, apiTS, KIND } from '../api.js'

export default function Wallet() {
  const { me, contrib, policy, toast } = useApp()
  const [spend, setSpend] = useState([])
  const [earn, setEarn] = useState([])
  const [amount, setAmount] = useState('100')
  useEffect(() => {
    let stop = false
    const load = () => api('/api/ledger').then(d => { if (!stop) { setSpend(d.spend || []); setEarn(d.earn || []) } }).catch(() => {})
    load(); const iv = setInterval(load, 5000)
    return () => { stop = true; clearInterval(iv) }
  }, [])
  const recharge = async () => {
    const a = +amount; if (!(a > 0)) return
    try { await post('/api/me/recharge', { amount: a }); toast('已充值 ' + f2(a) + ' 算力点', 'ok') } catch (e) { toast(String(e), 'bad', '充值失败') }
  }
  const b = (contrib && contrib.seller && contrib.seller.by_source) || {}
  return (
    <div>
      <div className="phead">
        <div className="phead-txt"><span className="eyebrow">Billing & Ledger</span><h1>钱包账单</h1><p>账户流水与按节点结算的收益明细；校验不通过的分片不结算，未使用的预扣会自动退还。</p></div>
        <div className="phead-actions"><span className="tb-pill">余额 <b>{f2(me ? me.credits : 0)}</b> 点</span></div>
      </div>
      <Card kicker="Contribution" title="贡献概览">
        <div className="hint" style={{ marginTop: 0 }}>卖家贡献（账户维度）= 账本中该账户全部收益流水之和；节点贡献（设备维度）= 单台机器已结算的任务与云主机算力。两者是同一本账的两个视角。</div>
        {contrib && contrib.seller ? (
          <div className="stats">
            <Stat v={f2(contrib.seller.total_earned)} l="卖家贡献合计" />
            <Stat v={f2(b.task)} l="任务算力（节点100%）" />
            <Stat v={f2(b.vm)} l="云主机（卖方90%）" />
            <Stat v={f2(b.model)} l="模型上游（无节点）" />
            <Stat v={f2(contrib.node_total_earned)} l="Σ 名下节点贡献" />
            <Stat v={f2(contrib.other_earned)} l="其它收益" />
          </div>
        ) : <Empty>正在读取贡献账目…</Empty>}
      </Card>
      <div className="grid">
        <Card kicker="Ledger" title="账户流水">
          {policy && policy.recharge && (
            <>
              <div className="sec">快速充值 <small>Top up</small></div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} />
                <Btn ghost onClick={recharge} style={{ height: 38, flex: '0 0 auto' }}>充值</Btn>
              </div>
            </>
          )}
          <div className="tablewrap"><table><thead><tr><th>时间</th><th>类型</th><th>变动</th><th>余额</th><th>说明</th></tr></thead>
            <tbody>{spend.length ? spend.map((e, i) => (
              <tr key={i}><td className="num">{apiTS(e.ts)}</td><td><span className={'kind ' + e.kind}>{KIND[e.kind] || e.kind}</span></td>
                <td className={e.amount >= 0 ? 'pos' : 'neg'}>{e.amount >= 0 ? '+' : ''}{f2(e.amount)}</td><td className="num">{f2(e.balance)}</td>
                <td>{e.note || ''}{e.job_id && <Tag>{e.job_id.slice(0, 10)}</Tag>}</td></tr>
            )) : <tr><td colSpan={5} className="empty">暂无记录</td></tr>}</tbody></table></div>
        </Card>
        <Card kicker="Earnings" title="节点贡献明细（最近记录）">
          <div className="tablewrap"><table><thead><tr><th>时间</th><th>节点</th><th>算力点</th><th>说明</th></tr></thead>
            <tbody>{earn.length ? earn.map((e, i) => (
              <tr key={i}><td className="num">{apiTS(e.ts)}</td><td className="num">{(e.node_id || '').slice(0, 14)}</td><td className="pos">+{f2(e.amount)}</td><td>{e.note || ''}</td></tr>
            )) : <tr><td colSpan={4} className="empty">暂无收益</td></tr>}</tbody></table></div>
          <div className="tip" style={{ margin: '16px 0 0' }}>任务收益只在「节点自报哈希 == broker 重算哈希」的分片上发放，避免虚假上报。</div>
        </Card>
      </div>
    </div>
  )
}