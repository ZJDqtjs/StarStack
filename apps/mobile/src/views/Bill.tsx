import React, { useEffect, useState } from 'react'
import { useApp } from '../ctx'
import { Btn, Card, Empty, Loader, Stats } from '../ui'
import { f2, ts } from '../../../shared/index.js'
import { LEDGER_KIND } from '../../../shared/constants.js'

export default function Bill() {
  const { api, me, policy, showToast } = useApp()
  const [d, setD] = useState<any>(null)
  const [c, setC] = useState<any>(null)
  const [amount, setAmount] = useState('100')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const [bill, contrib] = await Promise.all([api.ledger(), api.contribution()])
      setD(bill)
      setC(contrib)
    } catch (e: any) {
      showToast('读取账单失败：' + (e.message || e), 'bad')
      setD({ spend: [], earn: [] })
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const recharge = async () => {
    const n = Number(amount)
    if (!(n > 0)) return showToast('请输入大于 0 的点数', 'bad')
    setBusy(true)
    try {
      await api.recharge(n)
      showToast('已充值 ' + f2(n) + ' 点')
      await load()
    } catch (e: any) {
      showToast('充值失败：' + (e.message || e), 'bad')
    } finally {
      setBusy(false)
    }
  }

  const spend = d?.spend || []
  const earn = d?.earn || []
  const outgoing = spend.filter((e: any) => Number(e.amount) < 0).reduce((a: number, e: any) => a + Math.abs(Number(e.amount)), 0)
  // The ledger endpoint is a page of recent rows, so summing it under-reports.
  // Contribution totals come from the full Earn history instead.
  const income = c ? Number(c.seller?.total_earned || 0) : earn.reduce((a: number, e: any) => a + Number(e.amount || 0), 0)
  const src = c?.seller?.by_source || {}

  return (
    <div className="stack">
      <div className="viewhead">
        <h1>账单</h1>
        <p>账户流水与按节点结算的收益明细；校验不通过的分片不结算。</p>
      </div>

      <Card kicker="Contribution" title="贡献概览">
        <div className="hint">卖家贡献（账户）= 名下所有节点的贡献 + 无节点收益；节点贡献（设备）只算这台机器已结算的算力。两者是同一本账的两个视角。</div>
        <Stats
          items={[
            { v: f2(income), k: '卖家贡献合计', hl: true },
            { v: f2(src.task || 0), k: '任务算力' },
            { v: f2(src.vm || 0), k: '云主机（卖方 90%）' },
            { v: f2(src.model || 0), k: '模型上游（无节点）' },
            { v: f2(c?.node_total_earned || 0), k: 'Σ 当前名下节点贡献' },
            { v: f2(c?.other_earned || 0), k: '其它收益' },
          ]}
        />
        <div className="hint" style={{ marginTop: 8 }}>
          「其它收益」= 卖家贡献 − Σ 当前名下节点贡献，包含模型上游收益、已删除节点的历史收益和升级前的旧账。
          只有哈希校验通过的任务分片与已结算的云主机租用计入贡献，在线挂机不计。
        </div>
      </Card>

      <Card kicker="Summary" title="账户概览">
        <Stats
          items={[
            { v: f2(me.credits), k: '当前余额', hl: true },
            { v: f2(outgoing), k: '累计支出' },
            { v: f2(income), k: '累计收益' },
          ]}
        />
        {policy && policy.recharge && (
          <>
            <div className="row" style={{ marginTop: 12 }}>
              <input className="in" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="充值算力点" />
              <Btn variant="ghost" onClick={recharge} disabled={busy}>
                充值
              </Btn>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>本部署开启了自助充值；公网演练档会关闭该入口。</div>
          </>
        )}
      </Card>

      <Card kicker="Ledger" title="账户流水">
        {!d ? (
          <Loader />
        ) : spend.length === 0 ? (
          <Empty>暂无记录</Empty>
        ) : (
          <div className="list">
            {spend.map((e: any, i: number) => (
              <div className="listrow" key={i}>
                <div className="grow">
                  <div className="name">
                    {LEDGER_KIND[e.kind] || e.kind} {e.job_id ? <span className="tag">{String(e.job_id).slice(0, 8)}</span> : null}
                  </div>
                  <div className="meta">
                    {ts(e.ts)}
                    {e.note ? ' · ' + e.note : ''}
                  </div>
                </div>
                <div className={'amount ' + (Number(e.amount) >= 0 ? 'pos' : 'neg')}>
                  {Number(e.amount) >= 0 ? '+' : ''}
                  {f2(e.amount)}
                  <div className="meta" style={{ textAlign: 'right' }}>余 {f2(e.balance)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card kicker="Earnings" title="节点贡献明细（最近记录）">
        {!d ? (
          <Loader />
        ) : earn.length === 0 ? (
          <Empty>暂无收益</Empty>
        ) : (
          <div className="list">
            {earn.map((e: any, i: number) => (
              <div className="listrow" key={i}>
                <div className="grow">
                  <div className="name mono">{String(e.node_id || '').slice(0, 14) || '节点'}</div>
                  <div className="meta">
                    {ts(e.ts)}
                    {e.note ? ' · ' + e.note : ''}
                  </div>
                </div>
                <div className="amount pos">+{f2(e.amount)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="hint" style={{ marginTop: 8 }}>
          这里只列最近的收益流水，总额请看上方「贡献概览」。任务收益只在「节点自报哈希 == broker 重算哈希」的分片上发放；云主机收益按租用时长结算、平台留 10%。
        </div>
      </Card>
    </div>
  )
}
