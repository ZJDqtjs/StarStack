import React, { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { f2, relTime } from '../api/format'
import { JOB_ST } from '../api/constants'
import { useApp } from '../ctx'
import { mem } from '../session'
import { EMPTY_STATUS, nodeEvents, nodeService, type NodeStatus } from '../native/nodeService'
import { Badge, Bar, Btn, Card, Empty, Icon, Page, PageHead, type IconName } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'

const PHASE_LABEL: Record<string, string> = {
  idle: '空闲',
  registering: '注册节点',
  polling: '等待派单',
  fetching: '下载源片',
  transcoding: '转码中',
  uploading: '回传产物',
  error: '异常',
}

const QUICK: { label: string; desc: string; icon: IconName; route: any; tone: string }[] = [
  { label: '提交任务', desc: '转码 / 渲染 / 编译', icon: 'upload', route: 'create', tone: 'cRender' },
  { label: '服务市场', desc: '买工作流与服务', icon: 'market', route: 'market', tone: 'cBuild' },
  { label: '算力池', desc: '在线节点与单价', icon: 'pool', route: 'pool', tone: 'cVm' },
  { label: '我的节点', desc: '接入闲置算力', icon: 'nodes', route: 'nodes', tone: 'cApi' },
  { label: '买卖会话', desc: '联系卖家 / 买家', icon: 'messages', route: 'messages', tone: 'cVideo' },
  { label: '钱包账单', desc: '流水与收益', icon: 'wallet', route: 'wallet', tone: 'cImage' },
]

export default function Overview() {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const [st, setSt] = useState<NodeStatus>(EMPTY_STATUS)
  const [ledger, setLedger] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const sub = nodeEvents?.addListener('onNodeStatus', (next: NodeStatus) => setSt(next))
    nodeService.status().then(setSt).catch(() => {})
    return () => sub?.remove()
  }, [])

  const loadLedger = useCallback(() => {
    api
      .ledger()
      .then((d) => setLedger((Array.isArray(d) ? d : d?.spend || []).slice(0, 4)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadLedger()
    const t = setInterval(loadLedger, 10_000)
    return () => clearInterval(t)
  }, [loadLedger])

  const reload = useCallback(async () => {
    setRefreshing(true)
    try {
      const [next] = await Promise.all([nodeService.status(), app.refresh(), api.contribution().catch(() => null)])
      setSt(next)
      loadLedger()
    } catch {
      // 离线时保留上次状态
    } finally {
      setRefreshing(false)
    }
  }, [app, loadLedger])

  async function toggleNode() {
    setBusy(true)
    try {
      if (st.running) {
        await nodeService.stop()
        app.toast('已停止贡献算力', 'ok')
      } else {
        const mint = await api.launchNode({ price: 0.8, slots: 1, name: 'android-node', os: 'android', arch: 'arm64' })
        if (!mint?.code || !mint?.node_id) throw new Error('平台没有返回启动码，检查该账户是否允许接入节点')
        await nodeService.start(mem.base, String(mint.code), String(mint.node_id), 1, 0.8)
        Alert.alert('节点已启动', '前台服务会常驻通知栏。建议插电 + Wi-Fi 时运行，系统在低电量或高温时会降频。')
      }
      await app.refresh()
    } catch (e) {
      Alert.alert('节点操作失败', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const activeJobs = app.jobs.filter((j) => ['pending', 'queued', 'leased', 'running', 'fetching', 'uploading'].includes(j.status))
  const myNodes = app.workers.filter((w) => w.mine)
  const onlineNodes = myNodes.filter((w) => w.online)
  const earn = Number(app.contrib?.seller?.total_earned || 0)
  const recent = app.jobs.slice(0, 3)

  return (
    <Page refreshing={refreshing} onRefresh={reload} bottom={24}>
      <PageHead eyebrow="Overview" title={`你好，${app.me?.name || '星友'}`} desc="提交创作任务、买卖算力服务、管理接入的机器，都在这一屏。" />

      <View style={s.hero}>
        <View style={s.heroTop}>
          <View>
            <Text style={s.heroLabel}>账户余额 · 算力点</Text>
            <Text style={s.heroValue}>{f2(app.me?.credits)}</Text>
          </View>
          <View style={s.heroBadge}>
            <Icon name="star" size={13} color={c.accentInk} />
            <Text style={s.heroBadgeText}>Starstack</Text>
          </View>
        </View>
        <View style={s.heroStats}>
          <View style={s.heroCell}>
            <Text style={s.heroCellV}>{activeJobs.length}</Text>
            <Text style={s.heroCellL}>进行中任务</Text>
          </View>
          <View style={s.heroDivider} />
          <View style={s.heroCell}>
            <Text style={s.heroCellV}>{onlineNodes.length}</Text>
            <Text style={s.heroCellL}>在线节点</Text>
          </View>
          <View style={s.heroDivider} />
          <View style={s.heroCell}>
            <Text style={s.heroCellV}>{f2(earn)}</Text>
            <Text style={s.heroCellL}>累计贡献</Text>
          </View>
        </View>
        <View style={s.heroActions}>
          <Pressable style={({ pressed }) => [s.heroBtn, s.heroBtnSolid, pressed && { opacity: 0.85 }]} onPress={() => app.nav('create')}>
            <Icon name="plus" size={13} color={c.accent} />
            <Text style={[s.heroBtnText, { color: c.accent }]}>新建任务</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [s.heroBtn, pressed && { opacity: 0.8 }]} onPress={() => app.nav('wallet')}>
            <Text style={[s.heroBtnText, { color: c.accentInk }]}>钱包与账单</Text>
            <Icon name="chevR" size={13} color={c.accentInk} />
          </Pressable>
        </View>
      </View>

      <View style={s.quickGrid}>
        {QUICK.map((q) => (
          <Pressable
            key={q.label}
            onPress={() => app.nav(q.route)}
            style={({ pressed }) => [s.quick, pressed && { opacity: 0.7 }]}
          >
            <View style={[s.quickIcon, { backgroundColor: (c as any)[q.tone] + '1f' }]}>
              <Icon name={q.icon} size={16} color={(c as any)[q.tone]} />
            </View>
            <Text style={s.quickLabel}>{q.label}</Text>
            <Text style={s.quickDesc} numberOfLines={1}>
              {q.desc}
            </Text>
          </Pressable>
        ))}
      </View>

      <Card>
        <View style={s.cardHead}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>本机算力节点</Text>
            <Text style={s.cardSub}>{nodeService.available ? 'Kotlin 前台服务 · 退到后台不中断' : '当前环境没有原生节点模块'}</Text>
          </View>
          <Badge
            text={st.running ? PHASE_LABEL[st.phase] || st.phase : '未运行'}
            tone={st.running ? (st.phase === 'error' ? 'bad' : 'ok') : 'neutral'}
          />
        </View>

        {nodeService.available ? (
          <>
            <View style={s.nodeStats}>
              <View style={s.nodeCell}>
                <Text style={s.nodeK}>本机已服务</Text>
                <Text style={s.nodeV}>{st.served} 片</Text>
              </View>
              <View style={s.nodeCell}>
                <Text style={s.nodeK}>本机收益</Text>
                <Text style={s.nodeV}>{f2(st.earned)} 点</Text>
              </View>
              <View style={s.nodeCell}>
                <Text style={s.nodeK}>编码器</Text>
                <Text style={s.nodeV} numberOfLines={1}>
                  {st.encoder || '待探测'}
                </Text>
              </View>
            </View>
            {st.running ? (
              <View style={{ gap: 6 }}>
                <Bar pct={st.pct} />
                <View style={s.nodeFoot}>
                  <Text style={s.nodeFootText}>分片 {st.segId || '—'}</Text>
                  <Text style={s.nodeFootText}>{Math.round(st.pct)}%</Text>
                </View>
              </View>
            ) : null}
            {st.lastError ? <Text style={s.err}>{st.lastError}</Text> : null}
            <Btn
              title={st.running ? '停止贡献算力' : '一键开始贡献算力'}
              icon={st.running ? 'stop' : 'play'}
              kind={st.running ? 'danger' : 'primary'}
              onPress={toggleNode}
              loading={busy}
              block
            />
            <Text style={s.tiny}>
              收益按「哈希校验通过的分片」结算，未服务不扣点；建议插电 + Wi-Fi，避免发热降频。
            </Text>
          </>
        ) : (
          <Text style={s.err}>
            Expo Go 不含自定义原生代码，节点开关不可用。请用 `npx expo run:android` 打 development build 或安装 APK。
          </Text>
        )}
      </Card>

      <Card>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>最近任务</Text>
          <Pressable onPress={() => app.nav('jobs')} style={({ pressed }) => [s.link, pressed && { opacity: 0.6 }]}>
            <Text style={s.linkText}>全部</Text>
            <Icon name="chevR" size={12} color={c.accent} />
          </Pressable>
        </View>
        {recent.length ? (
          recent.map((j) => {
            const segs = Array.isArray(j.segs) ? j.segs : []
            const done = segs.filter((x: any) => x.status === 'done').length
            const pct = j.status === 'done' ? 100 : segs.length ? (done / segs.length) * 100 : 0
            return (
              <Pressable key={j.id} onPress={() => app.nav('job', { id: j.id })} style={({ pressed }) => [s.jobRow, pressed && { opacity: 0.7 }]}>
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={s.jobName} numberOfLines={1}>
                    {j.name || j.id}
                  </Text>
                  <Bar pct={pct} />
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <Text style={s.jobSt}>{JOB_ST[j.status] || j.status}</Text>
                  <Text style={s.jobSeg}>
                    {done}/{segs.length || '—'}
                  </Text>
                </View>
              </Pressable>
            )
          })
        ) : (
          <Empty text="还没有任务。去「创作」传一个视频或源码包试试。" icon="upload" />
        )}
      </Card>

      <Card>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>最近流水</Text>
          <Pressable onPress={() => app.nav('wallet')} style={({ pressed }) => [s.link, pressed && { opacity: 0.6 }]}>
            <Text style={s.linkText}>明细</Text>
            <Icon name="chevR" size={12} color={c.accent} />
          </Pressable>
        </View>
        {ledger.length ? (
          ledger.map((e, i) => {
            const pos = Number(e.amount || 0) >= 0
            return (
              <View key={String(e.id ?? i)} style={s.ledgerRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.ledgerName} numberOfLines={1}>
                    {e.note || e.kind}
                  </Text>
                  <Text style={s.ledgerTime}>{relTime(e.ts)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.amount, { color: pos ? c.ok : c.ink }]}>
                    {pos ? '+' : ''}
                    {f2(e.amount)}
                  </Text>
                  <Text style={s.ledgerTime}>余 {f2(e.balance)}</Text>
                </View>
              </View>
            )
          })
        ) : (
          <Empty text="暂无流水" icon="wallet" />
        )}
      </Card>

      <Card pad={false} style={{ padding: 14 }}>
        <View style={s.tipRow}>
          <Icon name="link" size={14} color={c.accent} />
          <Text style={s.tipText}>
            移动端是「买方保底 + 卖方常驻」：大文件与 ComfyUI 工作流请在网页端提交，手机负责盯进度、收产物和赚算力。
          </Text>
        </View>
      </Card>
    </Page>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    hero: { backgroundColor: c.accent, borderRadius: 14, padding: 16, gap: 14 },
    heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    heroLabel: { fontSize: 11, color: c.accentInk, opacity: 0.78, letterSpacing: 0.4 },
    heroValue: { fontSize: 32, fontWeight: '700', color: c.accentInk, letterSpacing: -0.8, marginTop: 2 },
    heroBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: c.accentInk + '1f',
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    heroBadgeText: { fontSize: 10, color: c.accentInk, fontWeight: '600' },
    heroStats: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.accentInk + '1a', borderRadius: 10, paddingVertical: 9 },
    heroCell: { flex: 1, alignItems: 'center', gap: 1 },
    heroCellV: { fontSize: 15, fontWeight: '700', color: c.accentInk },
    heroCellL: { fontSize: 9.5, color: c.accentInk, opacity: 0.72 },
    heroDivider: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: c.accentInk, opacity: 0.28 },
    heroActions: { flexDirection: 'row', gap: 8 },
    heroBtn: {
      flex: 1,
      height: 36,
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      borderWidth: 1,
      borderColor: c.accentInk + '73',
    },
    heroBtnSolid: { backgroundColor: c.accentInk, borderColor: c.accentInk },
    heroBtnText: { fontSize: 12.5, fontWeight: '600' },
    quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    quick: {
      width: '31%',
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hair,
      borderRadius: 12,
      padding: 11,
      gap: 3,
    },
    quickIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    quickLabel: { fontSize: 12.5, fontWeight: '600', color: c.ink },
    quickDesc: { fontSize: 9.5, color: c.faint },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cardTitle: { fontSize: 14.5, fontWeight: '600', color: c.ink },
    cardSub: { fontSize: 10.5, color: c.faint, marginTop: 2 },
    nodeStats: { flexDirection: 'row', gap: 8 },
    nodeCell: { flex: 1, gap: 2 },
    nodeK: { fontSize: 10.5, color: c.mute },
    nodeV: { fontSize: 13, fontWeight: '600', color: c.ink },
    nodeFoot: { flexDirection: 'row', justifyContent: 'space-between' },
    nodeFootText: { fontSize: 10.5, color: c.faint },
    err: { fontSize: 11.5, color: c.bad, lineHeight: 17 },
    tiny: { fontSize: 10.5, color: c.faint, lineHeight: 16 },
    link: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    linkText: { fontSize: 11.5, color: c.accent, fontWeight: '500' },
    jobRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
    jobName: { fontSize: 12.5, fontWeight: '500', color: c.ink },
    jobSt: { fontSize: 10.5, color: c.mute },
    jobSeg: { fontSize: 10, color: c.faint },
    ledgerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
    ledgerName: { fontSize: 12.5, color: c.ink },
    ledgerTime: { fontSize: 10, color: c.faint, marginTop: 2 },
    amount: { fontSize: 13, fontWeight: '600' },
    tipRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    tipText: { flex: 1, fontSize: 11, color: c.mute, lineHeight: 17 },
  })
