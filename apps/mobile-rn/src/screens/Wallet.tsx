import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { f2, relTime, ts } from '../api/format'
import { LEDGER_KIND } from '../api/constants'
import { useApp } from '../ctx'
import { Badge, Btn, Card, Chip, Empty, Field, Icon, KV, Page, PageHead } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'

type Filter = 'all' | 'spend' | 'earn'

const TOPUPS = [10, 50, 100, 500]

export default function Wallet() {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const [entries, setEntries] = useState<any[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [amount, setAmount] = useState('100')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api.ledger()
      const list = Array.isArray(d) ? d : [...(d?.spend || []), ...(d?.earn || [])]
      setEntries(list)
    } catch {
      // 保留旧数据
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  const reload = async () => {
    setRefreshing(true)
    try {
      await Promise.all([load(), app.refresh()])
    } finally {
      setRefreshing(false)
    }
  }

  const recharge = async () => {
    const a = Number(amount)
    if (!(a > 0)) {
      app.toast('请输入大于 0 的充值点数', 'warn')
      return
    }
    setBusy(true)
    try {
      await api.recharge(a)
      app.toast(`已充值 ${f2(a)} 算力点`, 'ok')
      await reload()
    } catch (e) {
      app.toast('充值失败：' + (e instanceof Error ? e.message : String(e)), 'bad')
    } finally {
      setBusy(false)
    }
  }

  const rows = useMemo(() => {
    const sorted = [...entries].sort((a, b) => (b.ts || 0) - (a.ts || 0))
    if (filter === 'spend') return sorted.filter((e) => Number(e.amount || 0) < 0)
    if (filter === 'earn') return sorted.filter((e) => Number(e.amount || 0) > 0)
    return sorted
  }, [entries, filter])

  const seller = app.contrib?.seller
  const bySource = seller?.by_source || {}

  return (
    <Page refreshing={refreshing} onRefresh={reload} gap={10}>
      <PageHead eyebrow="Billing & Ledger" title="钱包账单" desc="账户流水与按节点结算的收益；未使用的预扣会自动退还。" />

      <Card>
        <View style={s.balanceRow}>
          <View>
            <Text style={s.balanceLabel}>账户余额 · 算力点</Text>
            <Text style={s.balance}>{f2(app.me?.credits)}</Text>
          </View>
          <View style={s.balanceBadge}>
            <Icon name="wallet" size={16} color={c.accent} />
          </View>
        </View>
        <View style={s.chips}>
          {TOPUPS.map((v) => (
            <Chip key={v} label={`${v} 点`} on={amount === String(v)} onPress={() => setAmount(String(v))} />
          ))}
        </View>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Field label="自定义充值（点）" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          </View>
          <Btn title="充值" icon="plus" onPress={recharge} loading={busy} />
        </View>
        <Text style={s.hint}>线上档位的充值与提现以服务端 policy 为准；失败会以提示回显，不会静默扣点。</Text>
      </Card>

      <Card>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>贡献概览</Text>
          <Badge text="账本口径" tone="info" />
        </View>
        <View style={s.statGrid}>
          <View style={s.statCell}>
            <Text style={s.statV}>{f2(seller?.total_earned)}</Text>
            <Text style={s.statL}>卖家贡献合计</Text>
          </View>
          <View style={s.statCell}>
            <Text style={s.statV}>{f2(bySource.task)}</Text>
            <Text style={s.statL}>任务算力</Text>
          </View>
          <View style={s.statCell}>
            <Text style={s.statV}>{f2(bySource.vm)}</Text>
            <Text style={s.statL}>云主机</Text>
          </View>
          <View style={s.statCell}>
            <Text style={s.statV}>{f2(bySource.model)}</Text>
            <Text style={s.statL}>模型上游</Text>
          </View>
          <View style={s.statCell}>
            <Text style={s.statV}>{f2(app.contrib?.node_total_earned)}</Text>
            <Text style={s.statL}>Σ 名下节点</Text>
          </View>
          <View style={s.statCell}>
            <Text style={s.statV}>{f2(app.contrib?.other_earned)}</Text>
            <Text style={s.statL}>其它收益</Text>
          </View>
        </View>
        <KV k="结算规则" v="哈希校验通过才结算，差额退还" />
      </Card>

      <Card>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>账户流水</Text>
          <Text style={s.meta}>{rows.length} 条</Text>
        </View>
        <View style={s.chips}>
          <Chip label="全部" on={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip label="支出" on={filter === 'spend'} onPress={() => setFilter('spend')} />
          <Chip label="收益" on={filter === 'earn'} onPress={() => setFilter('earn')} />
        </View>
        {rows.length ? (
          rows.slice(0, 80).map((e, i) => {
            const amt = Number(e.amount || 0)
            const pos = amt >= 0
            return (
              <View key={String(e.id ?? i)} style={s.entry}>
                <View style={[s.kindDot, { backgroundColor: pos ? c.ok : c.mute }]} />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={s.entryTitle} numberOfLines={1}>
                    {LEDGER_KIND[e.kind] || e.kind}
                    {e.job_id ? ` · ${String(e.job_id).slice(0, 8)}` : ''}
                    {e.node_id ? ` · ${String(e.node_id).slice(0, 8)}` : ''}
                  </Text>
                  <Text style={s.entrySub} numberOfLines={1}>
                    {e.note || ts(e.ts)} · {relTime(e.ts)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.amount, { color: pos ? c.ok : c.ink }]}>
                    {pos ? '+' : ''}
                    {f2(amt)}
                  </Text>
                  {e.balance !== undefined ? <Text style={s.bal}>余 {f2(e.balance)}</Text> : null}
                </View>
              </View>
            )
          })
        ) : (
          <Empty text="还没有流水。提交任务或贡献算力后这里会有记录。" icon="wallet" />
        )}
      </Card>
    </Page>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    balanceLabel: { fontSize: 11, color: c.mute },
    balance: { fontSize: 30, fontWeight: '700', color: c.ink, letterSpacing: -0.6, marginTop: 2 },
    balanceBadge: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    row: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
    hint: { fontSize: 10.5, color: c.faint, lineHeight: 16 },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { fontSize: 14, fontWeight: '600', color: c.ink },
    meta: { fontSize: 10, color: c.faint },
    statGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
    statCell: { width: '33.3%', gap: 1 },
    statV: { fontSize: 14, fontWeight: '700', color: c.ink },
    statL: { fontSize: 9.5, color: c.faint },
    entry: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingVertical: 9,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hair,
    },
    kindDot: { width: 6, height: 6, borderRadius: 3 },
    entryTitle: { fontSize: 12, color: c.ink, fontWeight: '500' },
    entrySub: { fontSize: 9.5, color: c.faint },
    amount: { fontSize: 13, fontWeight: '600' },
    bal: { fontSize: 9.5, color: c.faint },
  })
