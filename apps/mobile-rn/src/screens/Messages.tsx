import React, { useCallback, useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { api } from '../api'
import { relTime, ts } from '../api/format'
import { useApp, type RouteParams } from '../ctx'
import { Avatar, Badge, Btn, Card, Empty, Icon, Page, PageHead } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'

export default function Messages({ params }: { params?: RouteParams }) {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const [convs, setConvs] = useState<any[]>([])
  const [cid, setCid] = useState<string | null>(params?.id || null)
  const [offer, setOffer] = useState<any>(null)
  const [peer, setPeer] = useState('对方')
  const [msgs, setMsgs] = useState<any[]>([])
  const [body, setBody] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [sending, setSending] = useState(false)
  const listRef = useRef<any>(null)

  const loadConvs = useCallback(async () => {
    try {
      const d = await api.conversations()
      setConvs(Array.isArray(d?.conversations) ? d.conversations : [])
    } catch {
      // 静默
    }
  }, [])

  const openConv = useCallback(async (id: string) => {
    setCid(id)
    setMsgs([])
    try {
      const d = await api.conversation(id)
      setOffer(d?.offer || null)
      setPeer(d?.conversation?.peer || '对方')
      setMsgs(Array.isArray(d?.messages) ? d.messages : [])
    } catch (e) {
      app.toast('打开会话失败：' + errText(e), 'bad')
    }
  }, [app])

  const refreshThread = useCallback(async () => {
    if (!cid) return
    try {
      const d = await api.conversation(cid)
      setMsgs(Array.isArray(d?.messages) ? d.messages : [])
      if (d?.conversation?.peer) setPeer(d.conversation.peer)
      if (d?.offer) setOffer(d.offer)
    } catch {
      // 静默
    }
  }, [cid])

  useEffect(() => {
    loadConvs()
    const t = setInterval(loadConvs, 6000)
    return () => clearInterval(t)
  }, [loadConvs])

  useEffect(() => {
    if (!cid) return
    void refreshThread()
    const t = setInterval(() => {
      if (Platform.OS === 'web') return
      void refreshThread()
    }, 4000)
    return () => clearInterval(t)
  }, [cid, refreshThread])

  useEffect(() => {
    if (msgs.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60)
  }, [msgs])

  const send = async () => {
    if (!cid) return
    const text = body.trim()
    if (!text) {
      app.toast('写点内容再发送', 'warn')
      return
    }
    setSending(true)
    try {
      await api.sendMessage(cid, text)
      setBody('')
      await refreshThread()
      loadConvs()
    } catch (e) {
      app.toast('发送失败：' + errText(e), 'bad')
    } finally {
      setSending(false)
    }
  }

  const onRefresh = async () => {
    setRefreshing(true)
    await loadConvs()
    setRefreshing(false)
  }

  if (cid) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.thread}>
          <View style={s.threadHead}>
            <Pressable onPress={() => { setCid(null); setMsgs([]) }} style={({ pressed }) => [s.back, pressed && { opacity: 0.6 }]}>
              <Icon name="chevL" size={16} color={c.body} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={s.threadTitle} numberOfLines={1}>
                {offer?.title || '共享会话'}
              </Text>
              <Text style={s.threadSub}>与 {peer} 沟通</Text>
            </View>
            <Badge text="轮询中" tone="info" />
          </View>

          <ScrollView ref={listRef} contentContainerStyle={s.chatList}>
            {msgs.length ? (
              msgs.map((m, i) => {
                const mine = !!m.mine
                return (
                  <View key={String(m.id ?? i)} style={[s.bubbleRow, mine && { justifyContent: 'flex-end' }]}>
                    {!mine ? <Avatar name={m.sender || peer} size={26} /> : null}
                    <View style={[s.bubble, mine ? { backgroundColor: c.accent } : { backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hair }]}>
                      <Text style={[s.bubbleWho, mine && { color: c.accentInk, opacity: 0.7 }]}>
                        {m.sender || peer} · {ts(m.created_at)}
                      </Text>
                      <Text style={[s.bubbleText, { color: mine ? c.accentInk : c.ink }]}>{m.body}</Text>
                    </View>
                  </View>
                )
              })
            ) : (
              <Empty text="还没有消息，先打个招呼吧" icon="messages" />
            )}
          </ScrollView>

          <View style={s.composer}>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="问问交付时间、模型、配置或售后…"
              placeholderTextColor={c.faint}
              style={s.input}
              multiline
              maxLength={1000}
            />
            <Pressable onPress={send} disabled={sending} style={({ pressed }) => [s.sendBtn, (pressed || sending) && { opacity: 0.7 }]}>
              <Icon name="send" size={16} color={c.accentInk} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    )
  }

  return (
    <Page refreshing={refreshing} onRefresh={onRefresh} gap={10}>
      <PageHead eyebrow="Messages" title="买卖会话" desc="与卖家或买家沟通交付时间、模型、配置与售后；自动共享的服务无需沟通即可直接使用。" />

      {convs.length ? (
        convs.map((cv) => (
          <Pressable key={cv.id} onPress={() => openConv(cv.id)} style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
            <Card style={{ gap: 8 }}>
              <View style={s.convTop}>
                <Avatar name={cv.peer} size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={s.convTitle} numberOfLines={1}>
                    {cv.title || cv.offer_id}
                  </Text>
                  <Text style={s.convPeer}>{cv.peer}</Text>
                </View>
                <Text style={s.convTime}>{relTime(cv.updated_at)}</Text>
              </View>
              <Text style={s.convLast} numberOfLines={1}>
                {cv.last_body || '还没有消息'}
              </Text>
            </Card>
          </Pressable>
        ))
      ) : (
        <Card>
          <Empty text="还没有会话。去服务市场点开一条挂牌，选择「联系卖家」发起对话。" icon="messages" />
          <Btn title="逛服务市场" icon="market" onPress={() => app.nav('market')} block />
        </Card>
      )}
    </Page>
  )
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    convTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    convTitle: { fontSize: 13, fontWeight: '600', color: c.ink },
    convPeer: { fontSize: 10.5, color: c.faint, marginTop: 1 },
    convTime: { fontSize: 9.5, color: c.faint },
    convLast: { fontSize: 11.5, color: c.mute },
    thread: { flex: 1 },
    threadHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.hair,
      backgroundColor: c.surface,
    },
    back: { width: 30, height: 30, borderRadius: 8, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' },
    threadTitle: { fontSize: 13.5, fontWeight: '600', color: c.ink },
    threadSub: { fontSize: 10, color: c.faint, marginTop: 1 },
    chatList: { padding: 14, gap: 10, paddingBottom: 24 },
    bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
    bubble: { maxWidth: '78%', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8, gap: 3 },
    bubbleWho: { fontSize: 9, color: c.faint },
    bubbleText: { fontSize: 13, lineHeight: 19 },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      padding: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hair,
      backgroundColor: c.surface,
    },
    input: {
      flex: 1,
      maxHeight: 96,
      minHeight: 40,
      borderWidth: 1,
      borderColor: c.hair2,
      borderRadius: 10,
      paddingHorizontal: 11,
      paddingVertical: 9,
      fontSize: 13,
      color: c.ink,
      backgroundColor: c.bg,
    },
    sendBtn: { width: 42, height: 42, borderRadius: 10, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  })
