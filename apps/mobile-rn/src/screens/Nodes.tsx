import React, { useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native'
import { api } from '../api'
import { f2, points } from '../api/format'
import { useApp } from '../ctx'
import { Badge, Btn, Card, Empty, Field, Page, PageHead, Sheet } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'

type Worker = {
  id: string
  name: string
  os: string
  arch: string
  cpus: number
  mem_mb: number
  slots: number
  active?: number
  price: number
  online: boolean
  paused: boolean
  mine: boolean
  encoders: string[]
  gpus: { name: string; mem_mb: number }[]
  ipv6?: string[]
  earned?: number
}

export default function Nodes() {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const [refreshing, setRefreshing] = useState(false)
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')
  const [pairOpen, setPairOpen] = useState(false)
  const [code, setCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [pending, setPending] = useState<any[]>([])
  const [pendingErr, setPendingErr] = useState('')

  const mine = app.workers.filter((w) => w.mine)
  const others = app.workers.filter((w) => !w.mine && w.online)
  const earnedOf = (id: string) => (app.contrib?.nodes || []).find((n: any) => n.id === id)?.earned ?? 0

  const reload = async () => {
    setRefreshing(true)
    try {
      await app.refresh()
    } finally {
      setRefreshing(false)
    }
  }

  async function withBusy(id: string, fn: () => Promise<unknown>) {
    setBusyId(id)
    try {
      await fn()
      await app.refresh()
    } catch (e) {
      Alert.alert('操作失败', errText(e))
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
    app.toast('单价已更新', 'ok')
  }

  function confirmDelete(w: Worker) {
    Alert.alert('删除节点', `确定删除「${w.name || w.id}」？账本历史会保留。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => withBusy(w.id, () => api.deleteNode(w.id)) },
    ])
  }

  const openPair = async () => {
    setPairOpen(true)
    setPendingErr('')
    try {
      const d = await api.pending()
      setPending(Array.isArray(d?.pending) ? d.pending : [])
    } catch (e) {
      setPending([])
      setPendingErr('这个 Broker 不公开待认领列表，直接填配对码即可。')
    }
  }

  const pair = async (raw?: string) => {
    const v = (raw ?? code).trim()
    if (!v) {
      app.toast('先填启动码', 'warn')
      return
    }
    setPairing(true)
    try {
      await api.pair(v)
      setCode('')
      setPairOpen(false)
      setPending([])
      await app.refresh()
      app.toast('节点已认领', 'ok')
    } catch (e) {
      app.toast('认领失败：' + errText(e), 'bad')
    } finally {
      setPairing(false)
    }
  }

  return (
    <Page refreshing={refreshing} onRefresh={reload} gap={10}>
      <PageHead
        eyebrow="Provider Nodes"
        title="我的节点"
        desc="把闲置机器接入算力池，按实测用量获得收益。本机常驻节点在「总览」里一键启动。"
        action={
          <Btn title="认领" kind="ghost" size="sm" icon="link" onPress={openPair} />
        }
      />

      <View style={s.summary}>
        <View style={s.sumCell}>
          <Text style={s.sumV}>{mine.length}</Text>
          <Text style={s.sumL}>已认领</Text>
        </View>
        <View style={s.divider} />
        <View style={s.sumCell}>
          <Text style={s.sumV}>{mine.filter((w) => w.online).length}</Text>
          <Text style={s.sumL}>在线</Text>
        </View>
        <View style={s.divider} />
        <View style={s.sumCell}>
          <Text style={s.sumV}>{points(mine.reduce((a, w) => a + Number(earnedOf(w.id)), 0))}</Text>
          <Text style={s.sumL}>节点累计收益</Text>
        </View>
      </View>

      {mine.length === 0 ? (
        <Card>
          <Empty text="还没有已认领的节点" icon="nodes" />
          <Text style={s.hint}>
            本机节点在「总览 → 本机算力节点」一键启动；其它机器在网页控制台生成启动脚本后运行，再用启动码认领。
          </Text>
          <View style={s.row}>
            <Btn title="去总览启动" kind="ghost" icon="play" onPress={() => app.nav('overview')} style={{ flex: 1 }} />
            <Btn title="输入启动码" icon="link" onPress={openPair} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : (
        mine.map((w) => (
          <Card key={w.id} style={{ gap: 10 }}>
            <View style={s.head}>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={s.name}>{w.name || w.id}</Text>
                  {w.paused ? <Badge text="已暂停" tone="warn" /> : null}
                </View>
                <Text style={s.meta}>
                  {w.os} · {w.arch} · {w.cpus} 核 / {Math.round(w.mem_mb / 1024)} GB
                  {w.gpus?.length ? ` · ${w.gpus[0].name}` : ''}
                </Text>
              </View>
              <Badge text={w.paused ? '已暂停' : w.online ? '在线' : '离线'} tone={w.paused ? 'warn' : w.online ? 'ok' : 'neutral'} />
            </View>

            <View style={s.grid}>
              <View style={s.cell}>
                <Text style={s.k}>单价</Text>
                <Text style={s.v}>{f2(w.price)} 点/秒</Text>
              </View>
              <View style={s.cell}>
                <Text style={s.k}>并发槽</Text>
                <Text style={s.v}>
                  {w.active ?? 0}/{w.slots}
                </Text>
              </View>
              <View style={s.cell}>
                <Text style={s.k}>节点收益</Text>
                <Text style={s.v}>{points(earnedOf(w.id))}</Text>
              </View>
            </View>

            <View style={s.priceRow}>
              <TextInput
                value={priceDraft[w.id] ?? ''}
                onChangeText={(t) => setPriceDraft((m) => ({ ...m, [w.id]: t }))}
                placeholder={`${f2(w.price)}`}
                placeholderTextColor={c.faint}
                keyboardType="decimal-pad"
                style={s.priceInput}
              />
              <Btn title="改价" kind="ghost" size="sm" onPress={() => savePrice(w)} loading={busyId === w.id} />
            </View>

            <View style={s.row}>
              <Btn
                title={w.paused ? '恢复接单' : '暂停接单'}
                kind="ghost"
                size="sm"
                onPress={() => withBusy(w.id, () => api.pauseNode(w.id, !w.paused))}
                style={{ flex: 1 }}
              />
              <Btn title="删除" kind="danger" size="sm" onPress={() => confirmDelete(w)} style={{ flex: 1 }} />
            </View>

            {w.encoders?.length ? (
              <Text style={s.enc} numberOfLines={2}>
                编码器：{w.encoders.slice(0, 5).join(' / ')}
              </Text>
            ) : null}
            {w.ipv6?.length ? <Text style={s.enc}>IPv6：{w.ipv6[0]}</Text> : null}
          </Card>
        ))
      )}

      <Card>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>市场里的其它节点</Text>
            <Text style={s.meta}>共 {app.workers.length} 台可见，其中 {app.workers.filter((w) => w.online).length} 台在线。非本人节点只显示脱敏信息。</Text>
          </View>
          <Badge text={`${others.length} 在线`} tone="info" />
        </View>
        <Btn title="查看算力池" kind="ghost" icon="pool" onPress={() => app.nav('pool')} block />
      </Card>

      <Sheet open={pairOpen} onClose={() => setPairOpen(false)} title="认领节点">
        <Text style={s.hint}>
          在网页控制台「我的节点 → 接入机器」生成启动脚本，脚本会打印一个配对码；把配对码填到这里，这台机器就挂到你的账户下。
        </Text>
        {pending.length ? (
          <>
            <Text style={s.label}>待认领的机器</Text>
            {pending.map((x) => (
              <View key={x.code} style={s.pendingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{x.name || x.id}</Text>
                  <Text style={s.meta}>
                    {x.os} · {x.cpus} 核 · {f2(x.price)} 点/秒 · {x.online ? '在线' : '离线'}
                  </Text>
                </View>
                <Btn title="认领" kind="ghost" size="xs" onPress={() => pair(x.code)} loading={pairing} />
              </View>
            ))}
          </>
        ) : pendingErr ? (
          <Text style={s.hint}>{pendingErr}</Text>
        ) : null}
        <Field label="配对码" value={code} onChangeText={setCode} placeholder="脚本里打印的配对码" autoCapitalize="characters" />
        <Btn title="认领这台机器" icon="check" onPress={() => pair()} loading={pairing} block />
      </Sheet>
    </Page>
  )
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    summary: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hair, paddingVertical: 12 },
    sumCell: { flex: 1, alignItems: 'center', gap: 2 },
    sumV: { fontSize: 16, fontWeight: '700', color: c.ink },
    sumL: { fontSize: 9.5, color: c.faint },
    divider: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: c.hair2 },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    name: { fontSize: 13.5, fontWeight: '600', color: c.ink },
    meta: { fontSize: 10.5, color: c.faint, lineHeight: 15, marginTop: 2 },
    grid: { flexDirection: 'row', gap: 10, backgroundColor: c.inset, borderRadius: 10, padding: 10 },
    cell: { flex: 1, gap: 1 },
    k: { fontSize: 9.5, color: c.mute },
    v: { fontSize: 12, fontWeight: '600', color: c.ink },
    priceRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    priceInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.hair2,
      borderRadius: 8,
      paddingHorizontal: 11,
      paddingVertical: 9,
      fontSize: 13,
      color: c.ink,
      backgroundColor: c.surface,
    },
    row: { flexDirection: 'row', gap: 8 },
    enc: { fontSize: 10, color: c.faint, lineHeight: 15 },
    label: { fontSize: 11.5, color: c.mute, fontWeight: '500' },
    pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hair },
    hint: { fontSize: 11.5, color: c.mute, lineHeight: 18 },
  })
