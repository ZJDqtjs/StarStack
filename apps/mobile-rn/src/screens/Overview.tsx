import React, { useCallback, useEffect, useState } from 'react'
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { points } from '../api/format'
import { mem } from '../session'
import { EMPTY_STATUS, nodeEvents, nodeService, type NodeStatus } from '../native/nodeService'
import { Badge, Btn, Card, KV, SectionTitle, Stat } from '../ui'
import { C } from '../theme'

const PHASE_LABEL: Record<string, string> = {
  idle: '空闲',
  registering: '注册节点',
  polling: '等待派单',
  fetching: '下载源片',
  transcoding: '转码中',
  uploading: '回传产物',
  error: '异常',
}

export default function Overview({ me, refreshMe }: { me: any; refreshMe: () => void }) {
  const [st, setSt] = useState<NodeStatus>(EMPTY_STATUS)
  const [contrib, setContrib] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const sub = nodeEvents?.addListener('onNodeStatus', (next: NodeStatus) => setSt(next))
    nodeService.status().then(setSt).catch(() => {})
    api.contribution().then(setContrib).catch(() => {})
    return () => sub?.remove()
  }, [])

  const reload = useCallback(async () => {
    setRefreshing(true)
    try {
      const [next, c] = await Promise.all([nodeService.status(), api.contribution()])
      setSt(next)
      setContrib(c)
      refreshMe()
    } catch {
      // 离线时保留上次状态
    } finally {
      setRefreshing(false)
    }
  }, [refreshMe])

  async function toggleNode() {
    setBusy(true)
    try {
      if (st.running) {
        await nodeService.stop()
      } else {
        const mint = await api.launchNode({
          price: 0.8,
          slots: 1,
          name: 'android-node',
          os: 'android',
          arch: 'arm64',
        })
        if (!mint?.code || !mint?.node_id) throw new Error('平台没有返回启动码，检查该账户是否允许接入节点')
        await nodeService.start(mem.base, String(mint.code), String(mint.node_id), 1, 0.8)
        Alert.alert(
          '节点已启动',
          '前台服务会常驻通知栏。建议插电 + Wi-Fi 时运行，系统在低电量或高温时会降频。'
        )
      }
    } catch (e) {
      Alert.alert('节点操作失败', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const seller = contrib?.seller
  const running = st.running

  return (
    <ScrollView
      contentContainerStyle={s.wrap}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={C.primary} />}
    >
      <SectionTitle eyebrow="OVERVIEW" title="总览" />

      <Card>
        <View style={s.row}>
          <Stat label="账户余额" value={points(me?.credits)} />
          <Stat label="我的节点" value={String(me?.nodes ?? 0)} />
        </View>
        <View style={s.divider} />
        <View style={s.row}>
          <Stat
            label="卖家贡献"
            value={points(seller?.total_earned)}
            sub={seller ? `任务 ${points(seller.by_source?.task)}` : undefined}
          />
          <Stat label="设备收益" value={points(contrib?.node_total_earned)} sub="仅已结算分片" />
        </View>
      </Card>

      <Card>
        <View style={s.head}>
          <Text style={s.cardTitle}>本机算力节点</Text>
          <Badge
            text={running ? PHASE_LABEL[st.phase] ?? st.phase : '未运行'}
            tone={running ? (st.phase === 'error' ? 'bad' : 'ok') : 'neutral'}
          />
        </View>

        {!nodeService.available ? (
          <Text style={s.warn}>
            当前运行环境没有原生节点模块（Expo Go 不含自定义原生代码）。
            请用 `npx expo run:android` 打 development build 或安装 APK。
          </Text>
        ) : (
          <>
            <KV k="节点 ID" v={st.nodeId || '—'} />
            <KV k="当前分片" v={st.segId || '—'} />
            <KV k="编码器" v={st.encoder || '待探测'} />
            <KV k="本机已服务" v={`${st.served} 片`} />
            <KV k="本机收益" v={points(st.earned)} />
            <View style={s.pctTrack}>
              <View style={[s.pctFill, { width: `${Math.max(0, Math.min(100, st.pct))}%` }]} />
            </View>
            {st.lastError ? <Text style={s.err}>{st.lastError}</Text> : null}
            <Btn
              title={running ? '停止贡献算力' : '开始贡献算力'}
              kind={running ? 'danger' : 'primary'}
              onPress={toggleNode}
              loading={busy}
            />
          </>
        )}
        <Text style={s.hint}>
          常驻任务由 Kotlin 前台 Service 执行，App 退到后台不会中断；系统需要常驻通知。
          建议仅在插电与 Wi-Fi 下开启，避免耗电与热降频。
        </Text>
      </Card>

      <Card>
        <Text style={s.cardTitle}>本期规则</Text>
        <KV k="当前档位" v={me ? '已登录' : '—'} />
        <KV k="贡献口径" v="只有哈希校验通过的分片才结算" />
        <KV k="结算方式" v="按实际墙钟分钟，差额退还" />
      </Card>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 40 },
  row: { flexDirection: 'row', gap: 16 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 4 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: C.text },
  hint: { fontSize: 11, color: C.dim, lineHeight: 17 },
  warn: { fontSize: 12, color: C.amber, lineHeight: 18 },
  err: { fontSize: 11, color: C.danger, lineHeight: 16 },
  pctTrack: { height: 6, borderRadius: 3, backgroundColor: '#eef2f9', overflow: 'hidden' },
  pctFill: { height: 6, borderRadius: 3, backgroundColor: C.primary },
})
