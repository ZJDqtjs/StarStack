import React, { useCallback, useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { f2, relTime } from '../api/format'
import { useApp } from '../ctx'
import { Badge, Btn, Card, Chip, Empty, Field, Icon, KV, Page, PageHead, Sheet } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'

const ctxLabel = (n: number) => (!n ? '32K' : n >= 1048576 ? `${(n / 1048576).toFixed(1)}M` : n >= 1024 ? `${Math.round(n / 1024)}K` : String(n))

type Msg = { role: 'user' | 'assistant'; content: string }

export default function ApiView() {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const [models, setModels] = useState<any[]>([])
  const [model, setModel] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [keys, setKeys] = useState<any[]>([])
  const [keyOpen, setKeyOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [quota, setQuota] = useState('0')
  const [creating, setCreating] = useState(false)

  const loadCatalog = useCallback(async () => {
    try {
      const d = await api.catalog()
      const list = Array.isArray(d?.models) ? d.models : []
      setModels(list)
      if (!model && list.length) setModel(list.find((m: any) => m.official)?.id || list[0].id)
    } catch {
      // 静默
    }
  }, [model])

  const loadKeys = useCallback(async () => {
    try {
      const d = await api.keys()
      setKeys(Array.isArray(d?.keys) ? d.keys : [])
    } catch {
      // 静默
    }
  }, [])

  useEffect(() => {
    loadCatalog()
    loadKeys()
  }, [loadCatalog, loadKeys])

  const send = async () => {
    const text = input.trim()
    if (!text) return
    if (!model) {
      app.toast('还没有可用模型，请让平台登记上游', 'warn')
      return
    }
    const next: Msg[] = [...msgs, { role: 'user', content: text }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    try {
      const r: any = await api.tryChat(model, next)
      const reply = r?.choices?.[0]?.message?.content || r?.content || '（模型没有返回内容）'
      setMsgs([...next, { role: 'assistant', content: String(reply) }])
    } catch (e) {
      app.toast('试聊失败：' + errText(e), 'bad')
      setMsgs(msgs)
    } finally {
      setBusy(false)
    }
  }

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

  const current = models.find((m) => m.id === model)

  return (
    <Page gap={10}>
      <PageHead
        eyebrow="Model Gateway"
        title="模型 API"
        desc="OpenAI 兼容网关：目录按上游聚合最低价，试聊按 token 结算，密钥只显示一次。"
        action={<Btn title="新建密钥" size="sm" icon="key" onPress={() => setKeyOpen(true)} />}
      />

      <Card>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>可用模型</Text>
          <Badge text={`${models.length} 个`} tone="info" />
        </View>
        {models.length ? (
          <>
            <View style={s.chips}>
              {models.slice(0, 12).map((m) => (
                <Chip key={m.id} label={m.id} on={model === m.id} onPress={() => setModel(m.id)} />
              ))}
            </View>
            {current ? (
              <View style={s.modelInfo}>
                <KV k="最低价" v={`${f2(current.price_per_1k)} 点 / 1K token`} />
                <KV k="上下文" v={ctxLabel(current.max_context)} />
                <KV k="上游数量" v={`${current.providers} 家`} />
                <KV k="官方供给" v={current.official ? '是' : '否'} />
              </View>
            ) : null}
          </>
        ) : (
          <Empty text="当前没有可用模型，请先在网页端登记上游" icon="api" />
        )}
      </Card>

      <Card>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>试聊</Text>
          <Text style={s.meta}>{model || '未选择模型'}</Text>
        </View>
        {msgs.length ? (
          msgs.map((m, i) => (
            <View key={i} style={[s.msg, m.role === 'user' ? s.msgMe : s.msgBot]}>
              <Text style={[s.msgWho, m.role === 'user' && { color: c.accentInk, opacity: 0.7 }]}>{m.role === 'user' ? '我' : model}</Text>
              <Text style={[s.msgText, m.role === 'user' && { color: c.accentInk }]}>{m.content}</Text>
            </View>
          ))
        ) : (
          <Empty text="问一句试试，例如「用一句话解释算力分片」" icon="messages" />
        )}
        {busy ? <Text style={s.thinking}>模型思考中…</Text> : null}
        <Field label="输入" value={input} onChangeText={setInput} multiline placeholder="问问模型能力、写段脚本或校对文案…" />
        <View style={s.row}>
          <Btn title="发送" icon="send" onPress={send} loading={busy} style={{ flex: 1 }} />
          <Btn title="清空" kind="ghost" icon="x" onPress={() => setMsgs([])} style={{ flex: 1 }} />
        </View>
        <Text style={s.hint}>试聊有频率与每日额度限制，超限会直接报错，不会静默扣点。</Text>
      </Card>

      <Card>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>我的密钥</Text>
          <Text style={s.meta}>{keys.length} 个</Text>
        </View>
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
                </View>
                <Btn title="撤销" kind="ghost" size="xs" onPress={() => revoke(k)} />
              </View>
            )
          })
        ) : (
          <Empty text="还没有密钥，建一个用于 OpenAI 兼容调用" icon="key" />
        )}
        <Text style={s.hint}>调用地址：{`${api.baseUrl()}/v1/chat/completions`}，请求头 Authorization: Bearer &lt;key&gt;。</Text>
      </Card>

      <Sheet open={keyOpen} onClose={() => setKeyOpen(false)} title="新建 API 密钥">
        <Field label="名称" value={keyName} onChangeText={setKeyName} placeholder="例如 移动端脚本" maxLength={40} />
        <Field label="日限额（点，0 表示不限）" value={quota} onChangeText={setQuota} keyboardType="decimal-pad" />
        <Btn title="创建" icon="plus" onPress={createKey} loading={creating} block />
        <Text style={s.hint}>明文密钥只在创建成功时弹一次，服务端只存哈希。</Text>
      </Sheet>
    </Page>
  )
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { fontSize: 14, fontWeight: '600', color: c.ink },
    meta: { fontSize: 10, color: c.faint },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    modelInfo: { gap: 2, backgroundColor: c.inset, borderRadius: 10, padding: 11 },
    msg: { borderRadius: 12, padding: 10, gap: 3, maxWidth: '92%' },
    msgMe: { alignSelf: 'flex-end', backgroundColor: c.accent },
    msgBot: { alignSelf: 'flex-start', backgroundColor: c.soft },
    msgWho: { fontSize: 9, color: c.faint, fontWeight: '600' },
    msgText: { fontSize: 12.5, lineHeight: 19, color: c.ink },
    thinking: { fontSize: 11, color: c.accent },
    row: { flexDirection: 'row', gap: 8 },
    hint: { fontSize: 10.5, color: c.faint, lineHeight: 16 },
    keyRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hair },
    keyIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
    keyName: { fontSize: 12, fontWeight: '600', color: c.ink },
    keyMeta: { fontSize: 9.5, color: c.faint, marginTop: 1 },
  })
