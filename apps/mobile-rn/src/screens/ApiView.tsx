import React, { useCallback, useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { f2, relTime } from '../api/format'
import { useApp } from '../ctx'
import { Badge, Btn, Card, Chip, Empty, Field, Icon, KV, Page, PageHead, Segmented, Sheet } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'
import AgentChat from './AgentChat'

type Tab = 'try' | 'keys' | 'upstream' | 'usage'

const TABS: { key: Tab; label: string }[] = [
  { key: 'try', label: '试聊' },
  { key: 'keys', label: '密钥' },
  { key: 'upstream', label: '上游' },
  { key: 'usage', label: '用量' },
]

const CAPS = ['tools', 'json_object', 'json_schema', 'regex', 'vision', 'reasoning', 'deterministic', 'prefix_cache']
const CAP_NAMES: Record<string, string> = {
  tools: '工具调用',
  json_object: 'JSON 输出',
  json_schema: 'JSON Schema',
  regex: '正则约束',
  vision: '图像输入',
  reasoning: '推理',
  deterministic: '确定性',
  prefix_cache: '前缀缓存',
}
const ctxLabel = (n: number) =>
  !n ? '32K' : n >= 1048576 ? `${(n / 1048576).toFixed(1)}M` : n >= 1024 ? `${Math.round(n / 1024)}K` : String(n)

export default function ApiView() {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const [tab, setTab] = useState<Tab>('try')

  // 密钥
  const [keys, setKeys] = useState<any[]>([])
  const [keyOpen, setKeyOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [quota, setQuota] = useState('0')
  const [creating, setCreating] = useState(false)

  // 上游
  const [ups, setUps] = useState<any[]>([])
  const [up, setUp] = useState({
    name: '',
    base_url: '',
    api_key: '',
    price: '0.5',
    price_out: '0',
    price_cached: '0',
    max_context: '32768',
    models: '',
  })
  const [caps, setCaps] = useState<string[]>([])
  const [upMsg, setUpMsg] = useState('')
  const [probing, setProbing] = useState(false)
  const [adding, setAdding] = useState(false)

  // 用量
  const [usage, setUsage] = useState<any>(null)
  const [usageDenied, setUsageDenied] = useState(false)
  const [usageLoading, setUsageLoading] = useState(false)

  const loadKeys = useCallback(async () => {
    try {
      const d = await api.keys()
      setKeys(Array.isArray(d?.keys) ? d.keys : [])
    } catch {
      // 静默失败，保留旧列表
    }
  }, [])

  const loadUps = useCallback(async () => {
    try {
      const d = await api.upstreams()
      setUps(Array.isArray(d?.upstreams) ? d.upstreams : [])
    } catch {
      // 静默失败，保留旧列表
    }
  }, [])

  const loadUsage = useCallback(async () => {
    setUsageLoading(true)
    try {
      const d = await api.usage(7)
      setUsage(d)
      setUsageDenied(false)
    } catch {
      setUsage(null)
      setUsageDenied(true)
    } finally {
      setUsageLoading(false)
    }
  }, [])

  useEffect(() => {
    loadKeys()
    loadUps()
  }, [loadKeys, loadUps])

  useEffect(() => {
    if (tab === 'usage') loadUsage()
  }, [tab, loadUsage])

  const createKey = async () => {
    setCreating(true)
    try {
      const r: any = await api.createKey(keyName.trim() || '移动端密钥', Number(quota) || 0)
      setKeyOpen(false)
      setKeyName('')
      await loadKeys()
      Alert.alert('密钥只显示一次', String(r?.key || ''), [{ text: '我已保存' }])
    } catch (e) {
      app.toast('创建失败：' + errText(e), 'bad')
    } finally {
      setCreating(false)
    }
  }

  const revoke = (k: any) => {
    Alert.alert('撤销密钥', `「${k.name}」撤销后立即失效，确定？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '撤销',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteKey(k.id)
            loadKeys()
            app.toast('密钥已撤销', 'ok')
          } catch (e) {
            app.toast(errText(e), 'bad')
          }
        },
      },
    ])
  }

  const probe = async () => {
    if (!up.base_url.trim()) {
      setUpMsg('请先填写 Base URL')
      return
    }
    setProbing(true)
    setUpMsg('正在请求上游 /v1/models…')
    try {
      const d: any = await api.probeUpstream(up.base_url.trim(), up.api_key)
      setUpMsg(`探测成功（${d?.latency_ms ?? '—'} ms）：${(d?.models || []).join('、') || '未返回模型列表'}`)
      if (!up.models.trim() && d?.models?.length) {
        setUp((x) => ({ ...x, models: d.models.slice(0, 8).join(', ') }))
      }
    } catch (e) {
      setUpMsg('探测失败：' + errText(e))
    } finally {
      setProbing(false)
    }
  }

  const addUp = async () => {
    if (!up.base_url.trim()) {
      setUpMsg('请填写 Base URL')
      return
    }
    if (!up.models.trim()) {
      setUpMsg('请填写至少一个模型名')
      return
    }
    if (!(Number(up.price) > 0)) {
      setUpMsg('输入单价必须大于 0')
      return
    }
    setAdding(true)
    setUpMsg('正在登记…')
    try {
      await api.addUpstream({
        name: up.name.trim() || up.base_url.trim(),
        base_url: up.base_url.trim(),
        api_key: up.api_key,
        price: Number(up.price),
        price_out: Number(up.price_out) || 0,
        price_cached: Number(up.price_cached) || 0,
        max_context: Number(up.max_context) || 32768,
        models: up.models.trim(),
        caps: caps.join(','),
      })
      setUpMsg('已登记，模型已进入可用目录')
      setUp((x) => ({ ...x, name: '', base_url: '', api_key: '', models: '' }))
      setCaps([])
      await loadUps()
      app.toast('上游已登记', 'ok')
    } catch (e) {
      setUpMsg('登记失败：' + errText(e))
    } finally {
      setAdding(false)
    }
  }

  const toggleUp = async (u: any) => {
    try {
      await api.setUpstream(u.id, !u.enabled)
      loadUps()
      app.toast(u.enabled ? '已停用' : '已启用', 'ok')
    } catch (e) {
      app.toast(errText(e), 'bad')
    }
  }

  const delUp = (u: any) => {
    Alert.alert('删除上游', `删除「${u.name}」后它立即退出路由，确定？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delUpstream(u.id)
            loadUps()
            app.toast('上游已删除', 'ok')
          } catch (e) {
            app.toast(errText(e), 'bad')
          }
        },
      },
    ])
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={s.top}>
        <PageHead
          eyebrow="Model Gateway"
          title="模型 API"
          desc="OpenAI 兼容网关：星舷助手支持自然语言指令与历史对话，密钥只显示一次。"
        />
        <Segmented items={TABS} value={tab} onChange={(v) => setTab(v as Tab)} />
      </View>

      {tab === 'try' ? (
        <AgentChat />
      ) : tab === 'keys' ? (
        <Page>
          <Card>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>我的 API Key</Text>
              <Btn title="新建密钥" size="sm" icon="key" onPress={() => setKeyOpen(true)} />
            </View>
            <Text style={s.hint}>
              用 Authorization: Bearer sk-ss-… 调用 OpenAI 兼容接口；密钥只在创建时显示一次。
            </Text>
            {keys.length ? (
              keys.map((k) => {
                const limit = Number(k.daily_quota || 0)
                const spent = Number(k.spent_today || 0)
                return (
                  <View key={k.id} style={s.keyRow}>
                    <View style={s.keyIcon}>
                      <Icon name="key" size={14} color={c.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.keyName}>{k.name}</Text>
                      <Text style={s.keyMeta}>
                        {k.prefix} · 今日 {f2(spent)} / {limit ? f2(limit) : '不限'} 点 · {relTime(k.created_at)}
                      </Text>
                      {k.revoked ? <Badge text="已撤销" tone="neutral" /> : null}
                    </View>
                    {!k.revoked ? <Btn title="撤销" kind="ghost" size="xs" onPress={() => revoke(k)} /> : null}
                  </View>
                )
              })
            ) : (
              <Empty text="还没有密钥，建一个用于 OpenAI 兼容调用" icon="key" />
            )}
            <Text style={s.hint}>调用地址：{`${api.baseUrl()}/v1/chat/completions`}</Text>
          </Card>
        </Page>
      ) : tab === 'upstream' ? (
        <Page>
          <Card>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>接入模型上游</Text>
              <Badge text={`已登记 ${ups.length}`} tone="info" />
            </View>
            <Field label="上游名称" value={up.name} onChangeText={(v) => setUp({ ...up, name: v })} placeholder="例如 宿舍 4090 · Qwen3-30B" />
            <Field
              label="Base URL"
              value={up.base_url}
              onChangeText={(v) => setUp({ ...up, base_url: v })}
              placeholder="http://192.168.1.20:8080"
            />
            <Field
              label="上游 API Key（可选）"
              value={up.api_key}
              onChangeText={(v) => setUp({ ...up, api_key: v })}
              placeholder="sk-..."
              secureTextEntry
            />
            <View style={s.row2}>
              <View style={{ flex: 1 }}>
                <Field label="输入单价（点/千 token）" value={up.price} onChangeText={(v) => setUp({ ...up, price: v })} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="输出单价（0=同输入）" value={up.price_out} onChangeText={(v) => setUp({ ...up, price_out: v })} keyboardType="decimal-pad" />
              </View>
            </View>
            <View style={s.row2}>
              <View style={{ flex: 1 }}>
                <Field label="缓存单价（0=同输入）" value={up.price_cached} onChangeText={(v) => setUp({ ...up, price_cached: v })} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="最大上下文（tokens）" value={up.max_context} onChangeText={(v) => setUp({ ...up, max_context: v })} keyboardType="number-pad" />
              </View>
            </View>
            <Text style={s.label}>声明能力</Text>
            <View style={s.chips}>
              {CAPS.map((k) => (
                <Chip
                  key={k}
                  label={CAP_NAMES[k] || k}
                  on={caps.includes(k)}
                  onPress={() => setCaps((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))}
                />
              ))}
            </View>
            <Field
              label="提供的模型名（逗号分隔）"
              value={up.models}
              onChangeText={(v) => setUp({ ...up, models: v })}
              placeholder="qwen3-30b-a3b, qwen2.5-7b"
            />
            <View style={s.row}>
              <Btn title="探测" kind="ghost" size="sm" onPress={probe} loading={probing} style={{ flex: 1 }} />
              <Btn title="登记上游" size="sm" onPress={addUp} loading={adding} style={{ flex: 1 }} />
            </View>
            {upMsg ? <Text style={s.msg}>{upMsg}</Text> : null}
          </Card>

          <Card>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>我登记的上游</Text>
              <Btn title="刷新" kind="ghost" size="xs" onPress={loadUps} />
            </View>
            {ups.length ? (
              ups.map((u) => {
                const h = u.health || {}
                return (
                  <View key={u.id} style={s.upRow}>
                    <View style={s.cardHead}>
                      <Text style={s.upName} numberOfLines={1}>{u.name || u.base_url}</Text>
                      <View style={s.tags}>
                        {u.official ? <Badge text="官方" tone="accent" /> : null}
                        {u.enabled ? (
                          h.cooling_sec ? <Badge text={`冷却 ${h.cooling_sec}s`} tone="warn" /> : <Badge text="路由中" tone="ok" />
                        ) : (
                          <Badge text="已停用" tone="neutral" />
                        )}
                      </View>
                    </View>
                    <Text style={s.hint} numberOfLines={2}>
                      {u.base_url} · {(u.models || []).join(' / ') || '未声明模型'}
                    </Text>
                    <KV k="输入" v={`${f2(u.price)} 点/千token`} />
                    <KV k="输出" v={`${f2(u.price_out || u.price)} 点/千token`} />
                    <KV k="上下文" v={ctxLabel(u.max_context)} />
                    {h.last_error ? <Text style={[s.msg, { color: c.warn }]}>最近错误：{h.last_error}</Text> : null}
                    <View style={s.row}>
                      <Btn title={u.enabled ? '停用' : '启用'} kind="ghost" size="xs" onPress={() => toggleUp(u)} style={{ flex: 1 }} />
                      <Btn title="删除" kind="danger" size="xs" onPress={() => delUp(u)} style={{ flex: 1 }} />
                    </View>
                  </View>
                )
              })
            ) : (
              <Empty text="还没有登记上游，先填一个可访问的 OpenAI 兼容地址" icon="api" />
            )}
          </Card>
        </Page>
      ) : (
        <Page refreshing={usageLoading} onRefresh={loadUsage}>
          <Card>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>上游用量对账（近 7 天）</Text>
              <Btn title="刷新" kind="ghost" size="xs" onPress={loadUsage} />
            </View>
            {usageDenied ? (
              <Text style={s.hint}>用量对账仅平台自营账户可查看；普通账户请以账本流水为准。</Text>
            ) : usage ? (
              <>
                <Text style={s.label}>按上游</Text>
                {(usage.by_upstream || []).length ? (
                  (usage.by_upstream || []).map((x: any, i: number) => (
                    <KV
                      key={i}
                      k={x.name || x.id}
                      v={`调用 ${x.requests} · 失败 ${x.failed} · 成本 ${f2(x.cost)} 点 · 输入 ${x.prompt} · 输出 ${x.completion}`}
                    />
                  ))
                ) : (
                  <Empty text="还没有调用记录" icon="api" />
                )}
                <Text style={s.label}>按模型</Text>
                {(usage.by_model || []).length ? (
                  (usage.by_model || []).map((x: any, i: number) => (
                    <KV
                      key={i}
                      k={x.name || x.id}
                      v={`调用 ${x.requests} · 失败 ${x.failed} · 成本 ${f2(x.cost)} 点 · 输入 ${x.prompt} · 输出 ${x.completion}`}
                    />
                  ))
                ) : (
                  <Empty text="还没有模型调用记录" icon="api" />
                )}
              </>
            ) : (
              <Empty text={usageLoading ? '正在读取…' : '暂无可展示的用量'} icon="api" />
            )}
          </Card>
        </Page>
      )}

      <Sheet open={keyOpen} onClose={() => setKeyOpen(false)} title="新建 API 密钥">
        <Field label="名称" value={keyName} onChangeText={setKeyName} placeholder="例如 移动端脚本" maxLength={40} />
        <Field label="日限额（点，0 表示不限）" value={quota} onChangeText={setQuota} keyboardType="decimal-pad" />
        <Btn title="创建" icon="plus" onPress={createKey} loading={creating} block />
        <Text style={s.hint}>明文密钥只在创建成功时弹一次，服务端只存哈希。</Text>
      </Sheet>
    </View>
  )
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    top: { paddingHorizontal: 14, paddingTop: 10, gap: 10 },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    cardTitle: { fontSize: 14, fontWeight: '600', color: c.ink },
    hint: { fontSize: 10.5, color: c.faint, lineHeight: 16 },
    row: { flexDirection: 'row', gap: 8 },
    row2: { flexDirection: 'row', gap: 8 },
    keyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hair,
    },
    keyIcon: {
      width: 28,
      height: 28,
      borderRadius: 8,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyName: { fontSize: 12, fontWeight: '600', color: c.ink },
    keyMeta: { fontSize: 9.5, color: c.faint, marginTop: 1 },
    upRow: {
      gap: 7,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hair,
    },
    upName: { fontSize: 12.5, fontWeight: '600', color: c.ink, flex: 1 },
    tags: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
    label: { fontSize: 10.5, color: c.mute, fontWeight: '600' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    msg: { fontSize: 10.5, color: c.mute, lineHeight: 16 },
  })
