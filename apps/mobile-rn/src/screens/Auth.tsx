import React, { useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { DEFAULT_BASE, mem, saveBase, saveToken } from '../session'
import { Btn, Card, Field, SectionTitle } from '../ui'
import { C } from '../theme'

export default function Auth({ onDone }: { onDone: () => void }) {
  const [base, setBase] = useState(mem.base || DEFAULT_BASE)
  const [name, setName] = useState('')
  const [pwd, setPwd] = useState('')
  const [invite, setInvite] = useState('')
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim() || !pwd) {
      Alert.alert('提示', '请填写用户名和密码')
      return
    }
    setBusy(true)
    try {
      await saveBase(base)
      const r =
        register && api.register
          ? await api.register(name.trim(), pwd, invite.trim() || undefined)
          : await api.login(name.trim(), pwd)
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
          <Text style={s.heroTitle}>星栈算力</Text>
          <Text style={s.heroSub}>把闲置的 CPU / GPU 接入市场，按真实用量结算</Text>
        </View>

        <Card>
          <SectionTitle eyebrow={register ? 'REGISTER' : 'SIGN IN'} title={register ? '创建账户' : '登录控制台'} />
          <Field label="服务器地址" value={base} onChangeText={setBase} placeholder="https://starstack.run" />
          <Field label="用户名" value={name} onChangeText={setName} placeholder="ASCII 用户名" />
          <Field label="密码" value={pwd} onChangeText={setPwd} secureTextEntry placeholder="至少 8 位" />
          {register ? (
            <Field label="邀请码" value={invite} onChangeText={setInvite} placeholder="公网档需要邀请码" />
          ) : null}
          <Btn title={register ? '注册并登录' : '登录'} onPress={submit} loading={busy} />
          <Btn
            title={register ? '已有账户，去登录' : '没有账户，去注册'}
            kind="ghost"
            onPress={() => setRegister((v) => !v)}
          />
          <Text style={s.hint}>
            本地联调把服务器地址改成 http://{'<局域网IP>'}:8787；公网档注册需要邀请码。
          </Text>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 16, paddingBottom: 48 },
  hero: { paddingVertical: 28, gap: 8 },
  heroTitle: { fontSize: 30, fontWeight: '700', color: C.text, letterSpacing: -0.5 },
  heroSub: { fontSize: 14, color: C.muted, lineHeight: 21 },
  hint: { fontSize: 11, color: C.dim, lineHeight: 17 },
})
