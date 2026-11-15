import React, { useCallback, useEffect, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { f1, points, ts } from '../api/format'
import { LEDGER_KIND } from '../api/constants'
import { Card, SectionTitle, Stat } from '../ui'
import { C } from '../theme'

export default function Bill({ me }: { me: any }) {
  const [rows, setRows] = useState<any[]>([])
  const [contrib, setContrib] = useState<any>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [bill, c] = await Promise.all([api.ledger(), api.contribution()])
      const list = Array.isArray(bill) ? bill : bill?.entries || []
      setRows(list)
      setContrib(c)
    } catch {
      // 离线时保留上一次结果
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const seller = contrib?.seller

  return (
    <ScrollView
      contentContainerStyle={s.wrap}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      <SectionTitle eyebrow="BILLING" title="账单与收益" />

      <Card>
        <View style={s.row}>
          <Stat label="账户余额" value={points(me?.credits)} />
          <Stat
            label="卖家贡献"
            value={points(seller?.total_earned)}
            sub={seller ? `任务 ${points(seller.by_source?.task)}` : undefined}
          />
        </View>
        <View style={s.divider} />
        <View style={s.row}>
          <Stat label="设备收益" value={points(contrib?.node_total_earned)} sub="仅已结算分片" />
          <Stat label="流水条数" value={String(rows.length)} sub="最近 200 条" />
        </View>
        <Text style={s.hint}>充值与提现请到网页端「钱包账单」；手机端只做查看与对账。</Text>
      </Card>

      <Card>
        <Text style={s.cardTitle}>流水</Text>
        {rows.length === 0 ? (
          <Text style={s.hint}>还没有流水。提交任务或贡献算力后这里会有记录。</Text>
        ) : (
          rows.slice(0, 60).map((e, i) => {
            const amt = Number(e.amount || 0)
            return (
              <View key={String(e.id ?? i)} style={s.item}>
                <View style={{ flex: 1 }}>
                  <Text style={s.itemTitle}>
                    {LEDGER_KIND[e.kind] || e.kind}
                    {e.job_id ? ` · ${String(e.job_id).slice(0, 10)}` : ''}
                    {e.node_id ? ` · ${e.node_id}` : ''}
                  </Text>
                  <Text style={s.itemSub}>
                    {ts(e.ts)}
                    {e.note || e.message ? ` · ${e.note || e.message}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.amt, { color: amt >= 0 ? C.success : C.muted }]}>
                    {amt >= 0 ? '+' : ''}
                    {f1(amt)}
                  </Text>
                  {e.balance !== undefined ? <Text style={s.bal}>余 {f1(Number(e.balance))}</Text> : null}
                </View>
              </View>
            )
          })
        )}
      </Card>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  row: { flexDirection: 'row', gap: 12 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 4 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 4 },
  hint: { fontSize: 11, color: C.dim, lineHeight: 16 },
  item: { flexDirection: 'row', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  itemTitle: { fontSize: 13, color: C.text, fontWeight: '500' },
  itemSub: { fontSize: 11, color: C.dim, marginTop: 2 },
  amt: { fontSize: 14, fontWeight: '600' },
  bal: { fontSize: 10, color: C.dim, marginTop: 2 },
})
