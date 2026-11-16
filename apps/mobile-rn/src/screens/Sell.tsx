import React, { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { api } from '../api'
import { f2, relTime } from '../api/format'
import { useApp } from '../ctx'
import { Badge, Btn, Card, Chip, Empty, Field, Icon, Page, PageHead, Segmented } from '../ui'
import { CAT_LABEL, catColor, useStyles, useTheme, type Palette } from '../theme'

const UNITS = ['点/次', '点/千 token', '点/视频秒', '点/小时', '点/帧']
type Tab = 'publish' | 'mine'

export default function Sell() {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const [tab, setTab] = useState<Tab>('mine')
  const [offers, setOffers] = useState<any[]>([])
  const [cat, setCat] = useState('render')
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('0.8')
  const [unit, setUnit] = useState('点/次')
  const [spec, setSpec] = useState('')
  const [body, setBody] = useState('')
  const [auto, setAuto] = useState(false)
  const [nodeId, setNodeId] = useState('')
  const [scene, setScene] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const myNodes = app.workers.filter((w) => w.mine)
  const mine = offers.filter((o) => o.mine)

  const load = useCallback(async () => {
    try {
      const d = await api.offers()
      setOffers(Array.isArray(d?.offers) ? d.offers : [])
    } catch {
      // 静默
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [load])

  const publish = async () => {
    if (!title.trim()) {
      app.toast('标题不能为空', 'warn')
      return
    }
    if (auto && !nodeId && !scene.trim()) {
      app.toast('开通自动共享需要绑定节点或填写场景任务', 'warn')
      return
    }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('category', cat)
      fd.append('title', title.trim())
      fd.append('body', body.trim())
      fd.append('spec', spec.trim())
      fd.append('price', price || '0')
      fd.append('unit', unit)
      if (auto) {
        fd.append('auto_share', '1')
        if (nodeId) fd.append('node_id', nodeId)
        if (scene.trim()) fd.append('scene', JSON.stringify({ scene: scene.trim() }))
      }
      await api.publishOffer(fd)
      setTitle('')
      setSpec('')
      setBody('')
      setScene('')
      setNodeId('')
      setAuto(false)
      await load()
      setTab('mine')
      app.toast('已发布，服务市场里能看到这条服务了', 'ok')
    } catch (e) {
      app.toast('发布失败：' + errText(e), 'bad')
    } finally {
      setBusy(false)
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
            await load()
            app.toast('挂牌已删除', 'ok')
          } catch (e) {
            app.toast(errText(e), 'bad')
          }
        },
      },
    ])
  }

  return (
    <Page
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true)
        await load()
        setRefreshing(false)
      }}
      gap={10}
    >
      <PageHead eyebrow="Seller Studio" title="我的发布" desc="发布服务挂牌、管理已上架的服务；开通自动共享后买家无需沟通即可直接使用。" />
      <Segmented
        items={[
          { key: 'mine' as Tab, label: `我的服务 ${mine.length}` },
          { key: 'publish' as Tab, label: '发布服务' },
        ]}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
      />

      {tab === 'publish' ? (
        <Card>
          <Text style={s.label}>服务类型</Text>
          <View style={s.chips}>
            {['render', 'build', 'api', 'image', 'video'].map((k) => (
              <Chip key={k} label={CAT_LABEL[k]} color={catColor(c, k)} on={cat === k} onPress={() => setCat(k)} />
            ))}
          </View>
          <Field label="标题" value={title} onChangeText={setTitle} placeholder="例如 4090 双卡 · Blender 渲染" maxLength={80} />
          <View style={s.two}>
            <View style={{ flex: 1 }}>
              <Field label="单价（算力点）" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
            </View>
            <View style={{ flex: 1.4 }}>
              <Text style={s.label}>计价单位</Text>
              <View style={s.chips}>
                {UNITS.map((u) => (
                  <Chip key={u} label={u.replace('点/', '')} on={unit === u} onPress={() => setUnit(u)} />
                ))}
              </View>
            </View>
          </View>
          <Field label="配置" value={spec} onChangeText={setSpec} placeholder="例如 双 RTX 4090 · 24G×2 · Cycles" maxLength={500} />
          <Field label="简介（可选）" value={body} onChangeText={setBody} multiline placeholder="交付时间、模型、售后与联系方式" maxLength={2000} />

          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>开通售出自动共享</Text>
              <Text style={s.hint}>买家无需沟通即可使用绑定的节点或场景任务</Text>
            </View>
            <Switch value={auto} onValueChange={setAuto} trackColor={{ true: c.accent, false: c.hair2 }} thumbColor="#fff" />
          </View>

          {auto ? (
            <>
              <Text style={s.label}>绑定我的节点（可空）</Text>
              <View style={s.chips}>
                <Chip label="不绑定" on={!nodeId} onPress={() => setNodeId('')} />
                {myNodes.map((w) => (
                  <Chip key={w.id} label={`${w.name || w.id}${w.online ? '' : ' · 离线'}`} on={nodeId === w.id} onPress={() => setNodeId(w.id)} />
                ))}
              </View>
              <Field label="场景 / 编译命令" value={scene} onChangeText={setScene} placeholder="例如 npm install && npm run build" maxLength={200} />
            </>
          ) : null}

          <Btn title="发布到市场" icon="upload" onPress={publish} loading={busy} block />
          <Text style={s.hint}>手机端暂不支持封面图；需要配图请在网页端发布后再编辑。</Text>
        </Card>
      ) : mine.length ? (
        mine.map((o) => (
          <Card key={o.id} style={{ gap: 8 }}>
            <View style={s.head}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={s.title} numberOfLines={1}>
                  {o.title}
                </Text>
                <View style={s.metaRow}>
                  <Badge text={CAT_LABEL[o.category] || o.category} tone="neutral" />
                  {o.auto_share ? <Badge text="自动共享" tone="ok" /> : <Badge text="需沟通" tone="warn" />}
                  <Text style={s.meta}>{relTime(o.created_at)}</Text>
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
            <View style={s.row}>
              <Btn title="查看会话" kind="ghost" size="sm" icon="messages" onPress={() => app.nav('messages')} style={{ flex: 1 }} />
              <Btn title="删除" kind="danger" size="sm" icon="trash" onPress={() => remove(o)} style={{ flex: 1 }} />
            </View>
          </Card>
        ))
      ) : (
        <Card>
          <Empty text="还没有发布过服务" icon="sell" />
          <Btn title="发布第一条" icon="plus" onPress={() => setTab('publish')} block />
        </Card>
      )}

      <Card>
        <View style={s.tipRow}>
          <Icon name="link" size={14} color={c.accent} />
          <Text style={s.tip}>
            自动共享的挂牌会把场景模板带进买家的下单流程；手机端只支持「场景 / 编译命令」，ComfyUI 工作流请在网页端绑定。
          </Text>
        </View>
      </Card>
    </Page>
  )
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    label: { fontSize: 11.5, color: c.mute, fontWeight: '500' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    two: { flexDirection: 'row', gap: 12 },
    hint: { fontSize: 10.5, color: c.faint, lineHeight: 16 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    title: { fontSize: 13.5, fontWeight: '600', color: c.ink },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    meta: { fontSize: 10, color: c.faint },
    price: { fontSize: 15, fontWeight: '700', color: c.ink },
    unit: { fontSize: 9.5, color: c.faint },
    spec: { fontSize: 11.5, color: c.mute, lineHeight: 17 },
    row: { flexDirection: 'row', gap: 8 },
    tipRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    tip: { flex: 1, fontSize: 10.5, color: c.mute, lineHeight: 16 },
  })
