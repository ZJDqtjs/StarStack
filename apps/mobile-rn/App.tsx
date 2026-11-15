import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, StatusBar as RNStatusBar, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { api } from './src/api'
import { loadSession } from './src/session'
import Auth from './src/screens/Auth'
import Nodes from './src/screens/Nodes'
import Overview from './src/screens/Overview'
import { C } from './src/theme'

type Tab = 'overview' | 'nodes'

export default function App() {
  const [booting, setBooting] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [me, setMe] = useState<any>(null)
  const [workers, setWorkers] = useState<any[]>([])
  const [contribution, setContribution] = useState<any>(null)
  const [tab, setTab] = useState<Tab>('overview')

  const refresh = useCallback(async () => {
    const st = await api.state()
    setWorkers(Array.isArray(st?.workers) ? st.workers : [])
    const signed = Boolean(st?.me?.signed_in)
    setAuthed(signed)
    if (signed) {
      setMe(st.me)
      api.contribution().then(setContribution).catch(() => {})
    } else {
      setMe(null)
      setContribution(null)
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const s = await loadSession()
        if (s.token) await refresh()
      } catch {
        // 启动阶段网络不可用不应阻塞登录页
      } finally {
        setBooting(false)
      }
    })()
  }, [refresh])

  useEffect(() => {
    if (!authed) return
    const timer = setInterval(() => {
      refresh().catch(() => {})
    }, 15_000)
    return () => clearInterval(timer)
  }, [authed, refresh])

  if (booting) {
    return (
      <View style={[s.center, s.root]}>
        <ActivityIndicator color={C.primary} />
        <StatusBar style="dark" />
      </View>
    )
  }

  if (!authed) {
    return (
      <View style={s.root}>
        <Auth onDone={() => void refresh()} />
        <StatusBar style="dark" />
      </View>
    )
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        {tab === 'overview' ? (
          <Overview me={me} refreshMe={() => void refresh().catch(() => {})} />
        ) : (
          <Nodes workers={workers} contribution={contribution} onRefresh={refresh} />
        )}
      </View>
      <View style={s.tabbar}>
        <TabBtn label="总览" active={tab === 'overview'} onPress={() => setTab('overview')} />
        <TabBtn label="节点" active={tab === 'nodes'} onPress={() => setTab('nodes')} />
      </View>
    </View>
  )
}

function TabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.tab}>
      <Text style={[s.tabText, active && s.tabActive]}>{label}</Text>
    </Pressable>
  )
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    paddingTop: Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) : 0,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  tabbar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.line,
    backgroundColor: C.surface,
    paddingBottom: 8,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { fontSize: 13, color: C.muted, fontWeight: '500' },
  tabActive: { color: C.primary },
})
