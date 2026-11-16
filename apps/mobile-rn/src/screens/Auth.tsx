import React, { useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { DEFAULT_BASE, mem, saveBase, saveToken } from '../session'
import { Badge, Btn, Card, Field, Icon, StarMark } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'

export default function Auth({ onDone }: { onDone: () => void }) {
  const s = useStyles(makeStyles)
  const { c, mode } = useTheme()
  const [base, setBase] = useState(mem.base || DEFAULT_BASE)
  const [name, setName] = useState('')
  const [pwd, setPwd] = useState('')
  const [invite, setInvite] = useState('')
  const [register, setRegister] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim() || !pwd) {
      Alert.alert('提示', '请填写用户名和密码')
      return
    }
    setBusy(true)
    try {
      await saveBase(base)
      const r = register && api.register ? await api.register(name.trim(), pwd, invite.trim() || undefined) : await api.login(name.trim(), pwd)
      const token: string = r?.token || r?.session?.token || ''
      if (!token) throw new Error('服务端没有返回会话 token')
      await saveToken(token)
      onDone()
    } catch (e) {
      Alert.alert(register ? '注册失败' : '登录失败', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <View style={s.hero}>
          <View style={s.mark}>
            <StarMark size={26} color={c.accentInk} />
          </View>
          <Text style={s.brand}>星栈算力</Text>
          <Text style={s.slogan}>把闲置的 CPU / GPU 接入市场，按真实用量结算。</Text>
          <View style={s.badges}>
            <Badge text="买方保底" tone="accent" />
            <Badge text="卖方常驻" tone="ok" />
            <Badge text={mode === 'dark' ? '深色' : '浅色'} tone="neutral" />
          </View>
        </View>

        <Card>
          <View style={s.tabs}>
            {[
              { k: false, label: '登录' },
              { k: true, label: '注册' },
            ].map((t) => (
              <Pressable key={String(t.k)} onPress={() => setRegister(t.k)} style={[s.tab, register === t.k && s.tabOn]}>
                <Text style={[s.tabText, register === t.k && { color: c.ink, fontWeight: '600' }]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          <Field label="用户名" value={name} onChangeText={setName} placeholder="ASCII 用户名" />
          <Field label="密码" value={pwd} onChangeText={setPwd} secureTextEntry placeholder="至少 8 位" />
          {register ? <Field label="邀请码" value={invite} onChangeText={setInvite} placeholder="公网档注册需要邀请码" /> : null}

          <Pressable onPress={() => setAdvanced((v) => !v)} style={s.adv}>
            <Icon name="settings" size={13} color={c.mute} />
            <Text style={s.advText} numberOfLines={1}>
              服务器地址：{base.replace(/^https?:\/\//, '')}
            </Text>
            <Icon name={advanced ? 'chevL' : 'chevR'} size={12} color={c.faint} />
          </Pressable>
          {advanced ? (
            <Field
              label="Broker 根地址"
              value={base}
              onChangeText={setBase}
              placeholder={DEFAULT_BASE}
              hint="本地联调填 http://<局域网IP>:8787；公网档保持默认即可。"
            />
          ) : null}

          <Btn title={register ? '注册并登录' : '登录控制台'} icon="arrowR" onPress={submit} loading={busy} block />
          <Text style={s.hint}>登录后会建立本地会话；节点常驻服务需要单独在「总览」里启动。</Text>
        </Card>

        <Text style={s.footer}>Starstack · 星栈算力 · 移动端</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { padding: 16, gap: 16, paddingBottom: 40 },
    hero: { paddingTop: 26, paddingBottom: 6, gap: 8 },
    mark: { width: 52, height: 52, borderRadius: 15, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    brand: { fontSize: 26, fontWeight: '700', color: c.ink, letterSpacing: -0.5 },
    slogan: { fontSize: 12.5, color: c.mute, lineHeight: 19 },
    badges: { flexDirection: 'row', gap: 6, marginTop: 4 },
    tabs: { flexDirection: 'row', backgroundColor: c.soft, borderRadius: 8, padding: 3, gap: 3 },
    tab: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 6 },
    tabOn: { backgroundColor: c.surface },
    tabText: { fontSize: 12.5, color: c.mute },
    adv: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
    advText: { flex: 1, fontSize: 11, color: c.mute },
    hint: { fontSize: 10.5, color: c.faint, lineHeight: 16 },
    footer: { fontSize: 10, color: c.faint, textAlign: 'center' },
  })
