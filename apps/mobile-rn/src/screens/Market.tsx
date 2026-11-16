import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { f2, hms, relTime } from '../api/format'
import { VM_ST } from '../api/constants'
import { useApp, type RouteParams } from '../ctx'
import { mem } from '../session'
import { Badge, Btn, Card, Chip, Empty, Field, KV, Page, PageHead, SearchBox, Segmented, Sheet } from '../ui'
import { CAT_LABEL, catColor, useStyles, useTheme, type Palette } from '../theme'

type Tab = 'offers' | 'vm' | 'pool'

export default function Market({ params }: { params?: RouteParams }) {
  const [tab, setTab] = useState<Tab>(params?.tab === 'pool' ? 'pool' : params?.tab === 'vm' ? 'vm' : 'offers')

  useEffect(() => {
    if (params?.tab === 'pool' || params?.tab === 'vm') setTab(params.tab)
  }, [params?.tab])

  return (
    <View style={{ flex: 1 }}>
      {tab === 'offers' ? (
        <Offers tab={tab} onTab={setTab} />
      ) : tab === 'vm' ? (
        <VM tab={tab} onTab={setTab} />
      ) : (
        <Pool tab={tab} onTab={setTab} />
      )}
    </View>
  )
}

// 三个子页共用同一个标题和分段控件，避免把 ScrollView 套进 ScrollView。
function MarketTop({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <>
      <PageHead
        eyebrow="Marketplace"
        title="服务市场"
        desc="卖家挂牌的算力服务、云主机与在线节点；自动共享的服务可直接用，其余先联系卖家。"
      />
      <Segmented
        items={[
          { key: 'offers' as Tab, label: '服务挂牌' },
          { key: 'vm' as Tab, label: '云主机' },
          { key: 'pool' as Tab, label: '算力池' },
        ]}
        value={tab}
        onChange={onTab}
      />
    </>
  )
}

/* ------------------------------- 服务挂牌 ------------------------------- */

function Offers({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const [offers, setOffers] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [open, setOpen] = useState<any>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api.offers()
      setOffers(Array.isArray(d?.offers) ? d.offers : [])
    } catch {
      // 静默失败，保留旧列表
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [load])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const list = useMemo(() => {
    const key = q.trim().toLowerCase()
    return offers
      .filter((o) => (cat === 'all' || o.category === cat) && (!key || [o.title, o.spec, o.seller, o.body].some((x) => String(x || '').toLowerCase().includes(key))))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
  }, [offers, cat, q])

  const useIt = async (o: any) => {
    try {
      const d = await api.useOffer(o.id)
      const off = d?.offer || o
      let tpl: Record<string, any> = {}
      try {
        const v = JSON.parse(off.scene || '{}')
        if (v && typeof v === 'object' && !Array.isArray(v)) tpl = v
      } catch {
        tpl = {}
      }
      setOpen(null)
      if (off.category === 'build') {
        app.setPrefill({ kind: 'build', tpl })
        app.nav('create', { kind: 'build' })
        app.toast('已获得共享授权，命令已预填', 'ok')
      } else if (off.category === 'render') {
        app.setPrefill({ kind: 'blender', tpl })
        app.nav('create', { kind: 'blender' })
        app.toast('已获得共享授权，帧范围已预填', 'ok')
      } else if (off.category === 'api') {
        app.nav('api')
        app.toast('该服务是模型 API，去「模型 API」页试聊', 'ok')
      } else {
        app.toast('生图 / 生视频需要网页端 ComfyUI 工作台', 'warn')
      }
    } catch (e) {
      app.toast(errText(e), 'bad')
    }
  }

  const contact = async (o: any) => {
    try {
      await api.contactOffer(o.id)
      setOpen(null)
      app.nav('messages')
      app.toast('会话已创建，去消息里聊', 'ok')
    } catch (e) {
      app.toast('发起会话失败：' + errText(e), 'bad')
    }
  }

  const remove = (o: any) => {
    Alert.alert('删除挂牌', `「${o.title}」会立即从市场消失，确定？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteOffer(o.id)
            setOpen(null)
            load()
            app.toast('挂牌已删除', 'ok')
          } catch (e) {
            app.toast(errText(e), 'bad')
          }
        },
      },
    ])
  }

  return (
    <>
      <Page refreshing={refreshing} onRefresh={onRefresh} gap={10} bottom={20}>
        <MarketTop tab={tab} onTab={onTab} />
        <SearchBox value={q} onChange={setQ} placeholder="搜索标题、配置或卖家…" />
        <View style={s.chipRow}>
          <Chip label="全部" on={cat === 'all'} onPress={() => setCat('all')} />
          {Object.keys(CAT_LABEL).map((k) => (
            <Chip key={k} label={CAT_LABEL[k]} color={catColor(c, k)} on={cat === k} onPress={() => setCat(k)} />
          ))}
        </View>
        {list.length === 0 ? (
          <Card>
            <Empty text={offers.length ? '没有匹配的服务，换个关键词或分类试试' : '这个版块还没有卖家发布'} icon="market" />
            <Btn title="我要出售" kind="ghost" icon="sell" onPress={() => app.nav('sell')} block />
          </Card>
        ) : (
          list.map((o) => (
            <Pressable key={o.id} onPress={() => setOpen(o)}>
              <Card style={{ gap: 9 }}>
                <View style={s.offerTop}>
                  <View style={[s.thumb, { backgroundColor: catColor(c, o.category) + '1f' }]}>
                    {o.has_image ? (
                      <Image source={{ uri: api.offerImage(o.id), headers: mem.token ? { Authorization: 'Bearer ' + mem.token } : {} }} style={s.thumbImg} />
                    ) : (
                      <Text style={[s.thumbText, { color: catColor(c, o.category) }]}>{String(o.title || '服').slice(0, 2)}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.offerTitle} numberOfLines={1}>
                      {o.title}
                    </Text>
                    <View style={s.offerMeta}>
                      <Badge text={CAT_LABEL[o.category] || o.category} tone="neutral" />
                      {o.auto_share ? <Badge text="自动共享" tone="ok" /> : null}
                      <Text style={s.metaText}>{o.seller}</Text>
                      <Text style={s.metaText}>· {relTime(o.created_at)}</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.price}>{f2(o.price)}</Text>
                    <Text style={s.unit}>{o.unit}</Text>
                  </View>
                </View>
                {o.spec ? (
                  <Text style={s.spec} numberOfLines={2}>
                    {o.spec}
                  </Text>
                ) : null}
              </Card>
            </Pressable>
          ))
        )}
      </Page>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.title}>
        {open ? (
          <>
            <View style={s.sheetMeta}>
              <Badge text={CAT_LABEL[open.category] || open.category} tone="neutral" />
              <Text style={s.metaText}>卖家 {open.seller}</Text>
              <Text style={s.metaText}>· {relTime(open.created_at)}</Text>
              {open.auto_share ? <Badge text="自动共享" tone="ok" /> : <Badge text="需联系卖家" tone="warn" />}
            </View>
            <View style={s.priceRow}>
              <Text style={s.sheetPrice}>{f2(open.price)}</Text>
              <Text style={s.unit}>{open.unit}</Text>
            </View>
            {open.spec ? <KV k="配置" v={open.spec} /> : null}
            {open.body ? <Text style={s.body}>{open.body}</Text> : <Text style={s.hint}>卖家未填写简介和联系方式。</Text>}
            {open.node_id ? <KV k="共享节点" v={String(open.node_id)} /> : null}
            <View style={s.row}>
              {open.mine ? (
                <>
                  <Btn title="查看咨询" kind="ghost" icon="messages" onPress={() => { setOpen(null); app.nav('messages') }} style={{ flex: 1 }} />
                  <Btn title="删除" kind="danger" icon="trash" onPress={() => remove(open)} style={{ flex: 1 }} />
                </>
              ) : (
                <>
                  {open.auto_share ? <Btn title="立即使用" icon="play" onPress={() => useIt(open)} style={{ flex: 1 }} /> : null}
                  <Btn title="联系卖家" kind={open.auto_share ? 'ghost' : 'primary'} icon="messages" onPress={() => contact(open)} style={{ flex: 1 }} />
                </>
              )}
            </View>
          </>
        ) : null}
      </Sheet>
    </>
  )
}

/* -------------------------------- 云主机 -------------------------------- */

function VM({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const [offers, setOffers] = useState<any[]>([])
  const [instances, setInstances] = useState<any[]>([])
  const [order, setOrder] = useState<any>(null)
  const [hostname, setHostname] = useState('')
  const [hours, setHours] = useState('1')
  const [sshKey, setSshKey] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [o, i] = await Promise.all([api.vmOffers(), api.vmInstances()])
      setOffers(Array.isArray(o?.offers) ? o.offers : [])
      setInstances(Array.isArray(i?.instances) ? i.instances : [])
    } catch {
      // 保留旧数据
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 6000)
    return () => clearInterval(t)
  }, [load])

  const rent = (o: any) => {
    setOrder(o)
    setHostname(o.name)
    setHours('1')
    setSshKey('')
    setResult('')
  }

  const submitOrder = async () => {
    if (!order) return
    setBusy(true)
    try {
      const r: any = await api.vmOrder({
        offer_id: order.id,
        name: hostname.trim() || order.name,
        hours: Number(hours) || 1,
        ssh_public_key: sshKey.trim(),
      })
      const ins = r.instance || {}
      setResult(
        [
          r.warning || '',
          `主机：${ins.name}（${ins.id}）`,
          `状态：${VM_ST[ins.status] || ins.status} · 预扣 ${f2(ins.hold)} 点`,
          `SSH 用户：${r.ssh_user || '-'}`,
          r.ssh_private_key ? `SSH 私钥（只显示一次）：\n${r.ssh_private_key}` : 'SSH：使用你填写的公钥登录',
          `root 口令：${r.root_password || '-'}`,
          `VNC 口令：${r.vnc_password || '-'}`,
        ]
          .filter(Boolean)
          .join('\n')
      )
      setOrder(null)
      load()
      app.toast('下单成功，凭据只显示一次', 'ok')
    } catch (e) {
      setResult('失败：' + errText(e))
    } finally {
      setBusy(false)
    }
  }

  const stop = (i: any) => {
    Alert.alert('停机', '剩余预扣按实际运行秒数结算后退回，确定停机？', [
      { text: '取消', style: 'cancel' },
      {
        text: '停机',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.vmStop(i.id)
            load()
            app.toast('已停机', 'ok')
          } catch (e) {
            app.toast(errText(e), 'bad')
          }
        },
      },
    ])
  }

  const extend = (i: any) => {
    Alert.alert('续费', `当前单价 ${f2(i.price_hour)} 点/小时，续 1 小时？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '续 1 小时',
        onPress: async () => {
          try {
            await api.vmExtend(i.id, 1)
            load()
            app.toast('续费成功', 'ok')
          } catch (e) {
            app.toast(errText(e), 'bad')
          }
        },
      },
    ])
  }

  return (
    <>
      <Page gap={10} bottom={20}>
        <MarketTop tab={tab} onTab={onTab} />
        <Card>
          <View style={s.cardHead}>
            <Text style={s.cardTitle}>可租用配置</Text>
            <Badge text={`${offers.filter((o) => o.available).length} 台可用`} tone="ok" />
          </View>
          {offers.filter((o) => !o.mine && o.enabled).length ? (
            offers
              .filter((o) => !o.mine && o.enabled)
              .map((o) => (
                <View key={o.id} style={s.vmRow}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.vmName}>{o.name}</Text>
                    <Text style={s.vmMeta}>
                      {o.cpus}C / {Math.round((o.mem_mb / 1024) * 10) / 10}G / {o.disk_gb}G · {o.os}
                    </Text>
                    <Text style={s.vmMeta}>
                      卖方节点 {o.node_name || o.node_id} · 最长 {o.max_hours} 小时
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={s.price}>{f2(o.price_hour)}</Text>
                    <Text style={s.unit}>点/小时</Text>
                    <Btn title="租用" kind="ghost" size="xs" disabled={!o.available} onPress={() => rent(o)} />
                  </View>
                </View>
              ))
          ) : (
            <Empty text="还没有可租用的云主机配置" icon="vm" />
          )}
        </Card>

        {result ? (
          <Card>
            <Text style={s.cardTitle}>下单结果</Text>
            <Text style={s.pre}>{result}</Text>
          </Card>
        ) : null}

        <Card>
          <View style={s.cardHead}>
            <Text style={s.cardTitle}>我的云主机</Text>
            <Text style={s.metaText}>{instances.length} 台</Text>
          </View>
          {instances.length ? (
            instances.map((i) => {
              const ep = i.endpoints || {}
              const act = ['queued', 'provisioning', 'running', 'unreachable'].includes(i.status)
              return (
                <View key={i.id} style={s.vmRow}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={s.vmName}>{i.name}</Text>
                      <Badge text={VM_ST[i.status] || i.status} tone={i.status === 'running' ? 'ok' : i.status === 'failed' ? 'bad' : 'warn'} />
                    </View>
                    <Text style={s.vmMeta}>
                      {i.cpus}C / {Math.round((i.mem_mb / 1024) * 10) / 10}G · {f2(i.price_hour)} 点/小时
                    </Text>
                    <Text style={s.vmMeta} numberOfLines={1}>
                      SSH {ep.ssh ? `${ep.ssh_user || i.ssh_user || 'root'}@${ep.ssh}` : '—'} · 剩余 {i.remaining_sec > 0 ? hms(i.remaining_sec) : '—'}
                    </Text>
                  </View>
                  <View style={{ gap: 6 }}>
                    {i.mine && act ? <Btn title="续费" kind="ghost" size="xs" onPress={() => extend(i)} /> : null}
                    {(i.mine || i.seller_mine) && !['stopped', 'failed'].includes(i.status) ? (
                      <Btn title="停机" kind="danger" size="xs" onPress={() => stop(i)} />
                    ) : null}
                  </View>
                </View>
              )
            })
          ) : (
            <Empty text="还没有租用记录" icon="vm" />
          )}
        </Card>

        <Card>
          <Text style={s.cardTitle}>怎么用云主机</Text>
          <Text style={s.hint}>卖方提供公网 IPv6，租用后拿到 SSH 地址与 root 口令；到期自动停机，剩余预扣按实际运行时间结算退回。</Text>
        </Card>
      </Page>

      <Sheet open={!!order} onClose={() => setOrder(null)} title={order ? `租用 · ${order.name}` : ''}>
        {order ? (
          <>
            <KV k="配置" v={`${order.cpus}C / ${Math.round((order.mem_mb / 1024) * 10) / 10}G / ${order.disk_gb}G`} />
            <KV k="单价" v={`${f2(order.price_hour)} 点/小时 · 最长 ${order.max_hours} 小时`} />
            <Field label="主机名称" value={hostname} onChangeText={setHostname} placeholder="例如 web-01" />
            <Field label="租期（小时）" value={hours} onChangeText={setHours} keyboardType="number-pad" />
            <Field
              label="SSH 公钥（可选）"
              value={sshKey}
              onChangeText={setSshKey}
              multiline
              placeholder="ssh-ed25519 AAAA... 留空则由平台生成，私钥只显示一次"
            />
            <Btn title="确认租用（可能预扣）" icon="check" onPress={submitOrder} loading={busy} block />
            <Text style={s.hint}>凭据只在成功后的弹层里显示一次，请立刻复制保存。</Text>
          </>
        ) : null}
      </Sheet>
    </>
  )
}

/* -------------------------------- 算力池 -------------------------------- */

function Pool({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const app = useApp()
  const s = useStyles(makeStyles)
  const [buckets, setBuckets] = useState<any[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api.market()
      setBuckets(Array.isArray(d?.buckets) ? d.buckets : Array.isArray(d?.encoders) ? d.encoders : [])
    } catch {
      // 静默
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [load])

  const onRefresh = async () => {
    setRefreshing(true)
    await Promise.all([load(), app.refresh()])
    setRefreshing(false)
  }

  const online = app.workers.filter((w) => w.online)
  const free = online.reduce((a, w) => a + Math.max(0, (w.slots || 0) - (w.active || 0)), 0)
  const minPrice = online.length ? Math.min(...online.map((w) => Number(w.price) || 0).filter((p) => p > 0)) : 0

  return (
    <Page refreshing={refreshing} onRefresh={onRefresh} gap={10} bottom={20}>
      <MarketTop tab={tab} onTab={onTab} />
      <View style={s.poolStats}>
        <View style={s.poolCell}>
          <Text style={s.poolV}>{online.length}</Text>
          <Text style={s.poolL}>在线节点</Text>
        </View>
        <View style={s.poolCell}>
          <Text style={s.poolV}>{free}</Text>
          <Text style={s.poolL}>空闲槽位</Text>
        </View>
        <View style={s.poolCell}>
          <Text style={s.poolV}>{minPrice ? f2(minPrice) : '—'}</Text>
          <Text style={s.poolL}>最低点/秒</Text>
        </View>
      </View>

      <Card>
        <Text style={s.cardTitle}>按编码器聚合</Text>
        {buckets.length ? (
          buckets.map((b, i) => (
            <View key={String(b.encoder || i)} style={s.bucketRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.vmName}>{b.encoder}</Text>
                <Text style={s.vmMeta}>
                  {b.nodes} 台 · 空闲 {b.free_slots} 槽 · 均速 {f2(b.avg_speed)}×
                  {b.best_gpu ? ` · ${b.best_gpu}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.price}>{f2(b.min_price)}</Text>
                <Text style={s.unit}>起 / 秒</Text>
              </View>
            </View>
          ))
        ) : (
          <Empty text="暂时没有在线节点" icon="pool" />
        )}
      </Card>

      <Card>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>在线节点</Text>
          <Text style={s.metaText}>脱敏展示</Text>
        </View>
        {online.length ? (
          online.slice(0, 12).map((w) => (
            <View key={w.id} style={s.nodeRow}>
              <View style={[s.dot, { backgroundColor: w.paused ? '#d97706' : '#0e9f6e' }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.vmName} numberOfLines={1}>
                  {w.mine ? w.name || w.id : `节点 ${String(w.id).slice(0, 6)}`}
                  {w.mine ? ' · 我的' : ''}
                </Text>
                <Text style={s.vmMeta}>
                  {w.os}/{w.arch} · {w.cpus} 核 · {Math.round((w.mem_mb || 0) / 1024)}G
                  {w.gpus?.length ? ` · ${w.gpus[0].name}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.nodePrice}>{f2(w.price)}</Text>
                <Text style={s.unit}>
                  空闲 {Math.max(0, (w.slots || 0) - (w.active || 0))}/{w.slots}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <Empty text="没有在线节点，去「我的节点」接入一台" icon="nodes" />
        )}
        <View style={s.row}>
          <Btn title="接入机器" kind="ghost" icon="plus" onPress={() => app.nav('nodes')} style={{ flex: 1 }} />
          <Btn title="我的节点" kind="ghost" icon="nodes" onPress={() => app.nav('nodes')} style={{ flex: 1 }} />
        </View>
      </Card>
    </Page>
  )
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    offerTop: { flexDirection: 'row', gap: 11, alignItems: 'center' },
    thumb: { width: 46, height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    thumbImg: { width: '100%', height: '100%' },
    thumbText: { fontSize: 13, fontWeight: '700' },
    offerTitle: { fontSize: 13.5, fontWeight: '600', color: c.ink },
    offerMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
    metaText: { fontSize: 10.5, color: c.faint },
    price: { fontSize: 15, fontWeight: '700', color: c.ink },
    unit: { fontSize: 9.5, color: c.faint },
    spec: { fontSize: 11.5, color: c.mute, lineHeight: 17 },
    sheetMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
    sheetPrice: { fontSize: 26, fontWeight: '700', color: c.ink },
    body: { fontSize: 12.5, color: c.body, lineHeight: 19 },
    hint: { fontSize: 11, color: c.faint, lineHeight: 17 },
    row: { flexDirection: 'row', gap: 8 },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { fontSize: 14, fontWeight: '600', color: c.ink },
    vmRow: { flexDirection: 'row', gap: 10, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hair, alignItems: 'center' },
    vmName: { fontSize: 12.5, fontWeight: '600', color: c.ink },
    vmMeta: { fontSize: 10.5, color: c.faint, lineHeight: 15 },
    pre: { fontSize: 11.5, color: c.body, lineHeight: 18, backgroundColor: c.inset, borderRadius: 8, padding: 10 },
    poolStats: { flexDirection: 'row', gap: 8 },
    poolCell: { flex: 1, backgroundColor: c.surface, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hair, padding: 12, gap: 2 },
    poolV: { fontSize: 20, fontWeight: '700', color: c.ink },
    poolL: { fontSize: 10.5, color: c.faint },
    bucketRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hair },
    nodeRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hair },
    dot: { width: 7, height: 7, borderRadius: 4 },
    nodePrice: { fontSize: 12.5, fontWeight: '600', color: c.ink },
  })
