import React, { useState } from 'react'
import { Alert, StyleSheet, Switch, Text, View } from 'react-native'
import { f2 } from '../api/format'
import { useApp } from '../ctx'
import { clearToken, DEFAULT_BASE, mem, saveBase } from '../session'
import { Badge, Btn, Card, Field, Icon, KV, Page, PageHead } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'

export default function Settings() {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c, mode, toggle } = useTheme()
  const [base, setBase] = useState(mem.base)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await saveBase(base)
      await app.refresh()
      app.toast('服务器地址已保存', 'ok')
    } catch (e) {
      app.toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'bad')
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBase(DEFAULT_BASE)
    await saveBase(DEFAULT_BASE)
    setBusy(true)
    try {
      await app.refresh()
      app.toast('已恢复公网地址', 'ok')
    } finally {
      setBusy(false)
    }
  }

  const logout = () => {
    Alert.alert('退出登录', '本地会话会被清除，节点前台服务需要重新启动。', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: () => {
          void clearToken()
          app.logout()
        },
      },
    ])
  }

  return (
    <Page gap={10}>
      <PageHead eyebrow="Settings" title="设置" desc="账户概览、连接地址与界面偏好。" />

      <Card>
        <View style={s.head}>
          <Text style={s.cardTitle}>账户概览</Text>
          <Badge text={app.me?.name || '—'} tone="ok" />
        </View>
        <KV k="算力点余额" v={`${f2(app.me?.credits)} 点`} />
        <KV k="我的任务" v={String(app.jobs.length)} />
        <KV k="我的在线节点" v={String(app.workers.filter((w) => w.mine && w.online).length)} />
        <KV k="累计贡献" v={`${f2(app.contrib?.seller?.total_earned)} 点`} />
      </Card>

      <Card>
        <View style={s.head}>
          <Text style={s.cardTitle}>服务器地址</Text>
          <Badge text="Broker" tone="info" />
        </View>
        <Field
          label="API 根地址"
          value={base}
          onChangeText={setBase}
          placeholder={DEFAULT_BASE}
          hint="线上留 https://starstack.run；本地联调填 http://<局域网IP>:8787。"
        />
        <View style={s.row}>
          <Btn title="保存并重连" icon="check" onPress={save} loading={busy} style={{ flex: 1 }} />
          <Btn title="恢复默认" kind="ghost" icon="refresh" onPress={reset} style={{ flex: 1 }} />
        </View>
      </Card>

      <Card>
        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>深色主题</Text>
            <Text style={s.hint}>与控制台同一套星舷配色，立即生效并记在本机。</Text>
          </View>
          <Switch value={mode === 'dark'} onValueChange={toggle} trackColor={{ true: c.accent, false: c.hair2 }} thumbColor="#fff" />
        </View>
      </Card>

      <Card>
        <Text style={s.cardTitle}>安全说明</Text>
        <View style={s.tipRow}>
          <Icon name="check" size={13} color={c.ok} />
          <Text style={s.tip}>
            口令以 PBKDF2-HMAC-SHA256（20 万次迭代 + 随机盐）存储；会话令牌保存在本机 AsyncStorage，退出登录即清除。API 密钥只在创建时显示一次，服务端只存 SHA-256 哈希。
          </Text>
        </View>
      </Card>

      <Card>
        <Text style={s.cardTitle}>关于</Text>
        <KV k="客户端" v="Android 原生端 0.1.0（RN + Kotlin）" />
        <KV k="节点常驻" v="Kotlin 前台 Service，退到后台不中断" />
        <KV k="设计系统" v="星舷 · 与控制台同一套色板与图标" />
        <Btn title="退出登录" kind="danger" icon="x" onPress={logout} block />
      </Card>
    </Page>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { fontSize: 14, fontWeight: '600', color: c.ink },
    row: { flexDirection: 'row', gap: 8 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    hint: { fontSize: 10.5, color: c.faint, lineHeight: 16, marginTop: 2 },
    tipRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    tip: { flex: 1, fontSize: 10.5, color: c.mute, lineHeight: 16 },
  })
