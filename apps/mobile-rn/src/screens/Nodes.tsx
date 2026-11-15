import React, { useState } from 'react'
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { api } from '../api'
import { points } from '../api/format'
import { Badge, Btn, Card, SectionTitle } from '../ui'
import { C } from '../theme'

type Worker = {
  id: string
  name: string
  os: string
  arch: string
  cpus: number
  mem_mb: number
  slots: number
  price: number
  online: boolean
  paused: boolean
  mine: boolean
  encoders: string[]
  gpus: { name: string; mem_mb: number }[]
}

export default function Nodes({
  workers,
  contribution,
  onRefresh,
}: {
  workers: Worker[]
  contribution: any
  onRefresh: () => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')

  const mine = workers.filter((w) => w.mine)
  const earnedOf = (id: string) =>
    (contribution?.nodes || []).find((n: any) => n.id === id)?.earned ?? 0

  async function reload() {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  async function withBusy(id: string, fn: () => Promise<unknown>) {
    setBusyId(id)
    try {
      await fn()
      await onRefresh()
    } catch (e) {
      Alert.alert('操作失败', e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId('')
    }
  }

  async function savePrice(w: Worker) {
    const raw = priceDraft[w.id]
    const price = Number(raw)
    if (!raw || !Number.isFinite(price) || price <= 0) {
      Alert.alert('价格无效', '请输入大于 0 的单价（点 / 视频秒）')
      return
    }
    await withBusy(w.id, () => api.setNodePrice(w.id, price))
    setPriceDraft((m) => ({ ...m, [w.id]: '' }))
  }

  function confirmDelete(w: Worker) {
    Alert.alert('删除节点', `确定删除「${w.name || w.id}」？账本历史会保留。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => withBusy(w.id, () => api.deleteNode(w.id)) },
    ])
  }

  return (
    <ScrollView
      contentContainerStyle={s.wrap}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={C.primary} />}
    >
      <SectionTitle eyebrow="PROVIDER NODES" title="我的节点" />

      {mine.length === 0 ? (
        <Card>
          <Text style={s.empty}>还没有已认领的节点。</Text>
          <Text style={s.hint}>
            本机节点在「总览」里一键启动；其它机器用控制台生成的启动脚本接入，认领后会出现在这里。
          </Text>
        </Card>
      ) : null}

      {mine.map((w) => {
        const earned = earnedOf(w.id)
        return (
          <Card key={w.id}>
            <View style={s.head}>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{w.name || w.id}</Text>
                <Text style={s.meta}>
                  {w.os} · {w.arch} · {w.cpus} 核 / {Math.round(w.mem_mb / 1024)} GB
                </Text>
              </View>
              <Badge
                text={w.paused ? '已暂停' : w.online ? '在线' : '离线'}
                tone={w.paused ? 'warn' : w.online ? 'ok' : 'neutral'}
              />
            </View>

            <View style={s.grid}>
              <View style={s.cell}>
                <Text style={s.k}>单价</Text>
                <Text style={s.v}>{w.price.toFixed(2)} 点/秒</Text>
              </View>
              <View style={s.cell}>
                <Text style={s.k}>并发槽</Text>
                <Text style={s.v}>{w.slots}</Text>
              </View>
              <View style={s.cell}>
                <Text style={s.k}>累计收益</Text>
                <Text style={s.v}>{points(earned)}</Text>
              </View>
              <View style={s.cell}>
                <Text style={s.k}>编码器</Text>
                <Text style={s.v}>{w.encoders?.length ?? 0} 个</Text>
              </View>
            </View>

            <View style={s.priceRow}>
              <TextInput
                value={priceDraft[w.id] ?? ''}
                onChangeText={(t) => setPriceDraft((m) => ({ ...m, [w.id]: t }))}
                placeholder={w.price.toFixed(2)}
                placeholderTextColor={C.dim}
                keyboardType="decimal-pad"
                style={s.priceInput}
              />
              <Btn
                title="改价"
                kind="ghost"
                onPress={() => savePrice(w)}
                loading={busyId === w.id}
                style={{ flex: 1 }}
              />
            </View>

            <View style={s.actions}>
              <Btn
                title={w.paused ? '恢复接单' : '暂停接单'}
                kind="ghost"
                onPress={() => withBusy(w.id, () => api.pauseNode(w.id, !w.paused))}
                style={{ flex: 1 }}
              />
              <Btn title="删除" kind="danger" onPress={() => confirmDelete(w)} style={{ flex: 1 }} />
            </View>
          </Card>
        )
      })}

      {workers.length > mine.length ? (
        <Card>
          <Text style={s.cardTitle}>市场里的其它节点</Text>
          <Text style={s.hint}>
            共 {workers.length} 台可见，其中 {workers.filter((w) => w.online).length} 台在线。
            非本人节点只显示脱敏信息。
          </Text>
        </Card>
      ) : null}
    </ScrollView>
  )
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 40 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  name: { fontSize: 15, fontWeight: '600', color: C.text },
  meta: { fontSize: 11, color: C.dim, marginTop: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { minWidth: 88, flex: 1 },
  k: { fontSize: 11, color: C.muted },
  v: { fontSize: 14, fontWeight: '600', color: C.text, marginTop: 2 },
  priceRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  priceInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.lineStrong,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: C.text,
  },
  actions: { flexDirection: 'row', gap: 10 },
  empty: { fontSize: 14, color: C.muted },
  cardTitle: { fontSize: 15, fontWeight: '600', color: C.text },
  hint: { fontSize: 12, color: C.dim, lineHeight: 18 },
})
