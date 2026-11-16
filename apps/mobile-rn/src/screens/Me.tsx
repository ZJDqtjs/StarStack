import React from 'react'
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { f2 } from '../api/format'
import { useApp, type Route } from '../ctx'
import { mem } from '../session'
import { Avatar, Badge, Btn, Card, Icon, Page, PageHead, type IconName } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'

const LINKS: { route: Route; label: string; desc: string; icon: IconName }[] = [
  { route: 'wallet', label: '钱包账单', desc: '余额、充值、流水与节点收益', icon: 'wallet' },
  { route: 'sell', label: '我的发布', desc: '发布服务挂牌、管理已上架的服务', icon: 'sell' },
  { route: 'messages', label: '买卖会话', desc: '与卖家或买家沟通交付与售后', icon: 'messages' },
  { route: 'nodes', label: '我的节点', desc: '改价、暂停接单、删除节点', icon: 'nodes' },
  { route: 'pool', label: '算力池', desc: '在线节点、编码器与实时单价', icon: 'pool' },
  { route: 'api', label: '模型 API', desc: '模型目录与 OpenAI 兼容试聊', icon: 'api' },
  { route: 'forum', label: '星栈论坛', desc: '分享工作流、讨论调度策略', icon: 'forum' },
  { route: 'settings', label: '设置', desc: '服务器地址、主题与安全说明', icon: 'settings' },
]

export default function Me() {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c, mode, toggle } = useTheme()

  const myNodes = app.workers.filter((w) => w.mine)
  const online = myNodes.filter((w) => w.online)
  const earn = Number(app.contrib?.seller?.total_earned || 0)

  const logout = () => {
    Alert.alert('退出登录', '本地会话会被清除，节点前台服务需要重新启动。', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: app.logout },
    ])
  }

  return (
    <Page gap={10}>
      <PageHead eyebrow="Account" title="个人中心" desc="账户资料、连接设置与界面偏好。" />

      <Card>
        <View style={s.profile}>
          <Avatar name={app.me?.name} size={46} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.name}>{app.me?.name || '星友'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Badge text="已登录" tone="ok" />
              <Text style={s.meta}>{mem.base.replace(/^https?:\/\//, '')}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.credits}>{f2(app.me?.credits)}</Text>
            <Text style={s.meta}>算力点</Text>
          </View>
        </View>

        <View style={s.stats}>
          <View style={s.statCell}>
            <Text style={s.statV}>{app.jobs.length}</Text>
            <Text style={s.statL}>我的任务</Text>
          </View>
          <View style={s.divider} />
          <View style={s.statCell}>
            <Text style={s.statV}>
              {online.length}/{myNodes.length}
            </Text>
            <Text style={s.statL}>在线节点</Text>
          </View>
          <View style={s.divider} />
          <View style={s.statCell}>
            <Text style={s.statV}>{f2(earn)}</Text>
            <Text style={s.statL}>累计贡献</Text>
          </View>
        </View>

        <View style={s.row}>
          <Btn title="钱包账单" icon="wallet" kind="ghost" onPress={() => app.nav('wallet')} style={{ flex: 1 }} />
          <Btn title="我的发布" icon="sell" kind="ghost" onPress={() => app.nav('sell')} style={{ flex: 1 }} />
        </View>
      </Card>

      <Card pad={false}>
        {LINKS.map((l, i) => (
          <Pressable
            key={l.route}
            onPress={() => app.nav(l.route)}
            style={({ pressed }) => [s.link, i > 0 && s.linkBorder, pressed && { opacity: 0.6 }]}
          >
            <View style={s.linkIcon}>
              <Icon name={l.icon} size={16} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.linkLabel}>{l.label}</Text>
              <Text style={s.linkDesc}>{l.desc}</Text>
            </View>
            <Icon name="chevR" size={14} color={c.faint} />
          </Pressable>
        ))}
      </Card>

      <Card>
        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.linkLabel}>深色主题</Text>
            <Text style={s.linkDesc}>与控制台同一套星舷配色，立即生效并记住选择</Text>
          </View>
          <Switch value={mode === 'dark'} onValueChange={toggle} trackColor={{ true: c.accent, false: c.hair2 }} thumbColor="#fff" />
        </View>
        <Btn title="退出登录" kind="danger" icon="x" onPress={logout} block />
      </Card>

      <Text style={s.footer}>星栈算力 · Android 原生端 0.1.0 · 节点常驻由 Kotlin 前台服务承载</Text>
    </Page>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    profile: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    name: { fontSize: 16, fontWeight: '700', color: c.ink },
    meta: { fontSize: 10.5, color: c.faint },
    credits: { fontSize: 18, fontWeight: '700', color: c.accent },
    stats: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.inset, borderRadius: 10, paddingVertical: 10 },
    statCell: { flex: 1, alignItems: 'center', gap: 1 },
    statV: { fontSize: 14, fontWeight: '700', color: c.ink },
    statL: { fontSize: 9.5, color: c.faint },
    divider: { width: StyleSheet.hairlineWidth, height: 20, backgroundColor: c.hair2 },
    row: { flexDirection: 'row', gap: 8 },
    link: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 12 },
    linkBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hair },
    linkIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
    linkLabel: { fontSize: 13, fontWeight: '600', color: c.ink },
    linkDesc: { fontSize: 10.5, color: c.faint, marginTop: 2 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    footer: { fontSize: 10, color: c.faint, textAlign: 'center', lineHeight: 16 },
  })
