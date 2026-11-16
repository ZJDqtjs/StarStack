import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState as RNAppState, BackHandler, Platform, Pressable, StatusBar as RNStatusBar, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { api } from './src/api'
import { clearToken, getTheme, loadSession, mem, setTheme as persistTheme } from './src/session'
import { AppCtx, type Prefill, type Route, type RouteParams } from './src/ctx'
import { ThemeProvider, useStyles, useTheme, type Mode, type Palette } from './src/theme'
import { Icon, Loading, StarMark, Toast, type IconName } from './src/ui'
import Auth from './src/screens/Auth'
import Overview from './src/screens/Overview'
import Create from './src/screens/Create'
import Market from './src/screens/Market'
import Jobs from './src/screens/Jobs'
import JobDetail from './src/screens/JobDetail'
import Me from './src/screens/Me'
import Wallet from './src/screens/Wallet'
import Nodes from './src/screens/Nodes'
import Messages from './src/screens/Messages'
import Forum from './src/screens/Forum'
import ApiView from './src/screens/ApiView'
import Sell from './src/screens/Sell'
import Settings from './src/screens/Settings'

const TABS: { key: Route; label: string; icon: IconName }[] = [
  { key: 'overview', label: '总览', icon: 'home' },
  { key: 'create', label: '创作', icon: 'render' },
  { key: 'market', label: '市场', icon: 'market' },
  { key: 'jobs', label: '任务', icon: 'jobs' },
  { key: 'me', label: '我的', icon: 'user' },
]

const TITLES: Record<Route, string> = {
  overview: '总览',
  create: '创作工作台',
  market: '服务市场',
  jobs: '我的任务',
  me: '个人中心',
  wallet: '钱包账单',
  nodes: '我的节点',
  pool: '算力池',
  messages: '买卖会话',
  forum: '星栈论坛',
  api: '模型 API',
  sell: '我的发布',
  settings: '设置',
  job: '任务详情',
}

const SUBTITLES: Partial<Record<Route, string>> = {
  overview: 'Starstack Console',
  create: 'Submit · Render · Build',
  market: 'Offers · VM · Compute',
  jobs: 'Jobs & Segments',
  me: 'Account',
}

type Entry = { route: Route; params?: RouteParams }

export default function App() {
  const [mode, setMode] = useState<Mode>('light')
  const [booting, setBooting] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [me, setMe] = useState<any>(null)
  const [workers, setWorkers] = useState<any[]>([])
  const [jobs, setJobs] = useState<any[]>([])
  const [contrib, setContrib] = useState<any>(null)
  const [policy, setPolicy] = useState<any>(null)
  const [stack, setStack] = useState<Entry[]>([{ route: 'overview' }])
  const [toastState, setToastState] = useState<{ msg: string; tone?: 'ok' | 'bad' | 'warn' } | null>(null)
  const [prefill, setPrefill] = useState<Prefill>(null)
  const toastTimer = useRef<any>(null)

  const toast = useCallback((msg: string, tone?: 'ok' | 'bad' | 'warn') => {
    setToastState({ msg, tone })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastState(null), 2400)
  }, [])

  const refresh = useCallback(async () => {
    const st = await api.state()
    setWorkers(Array.isArray(st?.workers) ? st.workers : [])
    setJobs(Array.isArray(st?.jobs) ? st.jobs : [])
    setPolicy(st?.policy || null)
    const signed = Boolean(st?.me?.signed_in)
    setAuthed(signed)
    if (signed) {
      setMe(st.me)
      api.contribution().then(setContrib).catch(() => {})
    } else {
      setMe(null)
      setContrib(null)
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const [m] = await Promise.all([getTheme(), loadSession()])
        setMode(m)
        if (mem.token) await refresh()
      } catch {
        // 启动阶段网络不可用不阻塞登录页
      } finally {
        setBooting(false)
      }
    })()
  }, [refresh])

  useEffect(() => {
    if (!authed) return
    const tick = () => {
      if (RNAppState.currentState === 'active') refresh().catch(() => {})
    }
    const timer = setInterval(tick, 15_000)
    return () => clearInterval(timer)
  }, [authed, refresh])

  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      void persistTheme(next)
      return next
    })
  }, [])

  const nav = useCallback(
    (route: Route, params?: RouteParams) => {
      const isTab = TABS.some((t) => t.key === route)
      setStack((prev) => {
        if (isTab) return [{ route, params }]
        const top = prev[prev.length - 1]
        if (top && top.route === route && JSON.stringify(top.params) === JSON.stringify(params)) return prev
        return [...prev, { route, params }]
      })
    },
    []
  )

  const back = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }, [])

  const logout = useCallback(() => {
    api.logout().catch(() => {})
    void clearToken()
    setAuthed(false)
    setMe(null)
    setJobs([])
    setWorkers([])
    setContrib(null)
    setStack([{ route: 'overview' }])
  }, [])

  // 安卓物理返回键先退页面栈，栈底才交给系统退出 App。
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        setStack((prev) => prev.slice(0, -1))
        return true
      }
      return false
    })
    return () => sub.remove()
  }, [stack.length])

  const entry = stack[stack.length - 1]
  const depth = stack.length - 1

  const ctxValue = useMemo(
    () => ({
      me,
      workers,
      jobs,
      contrib,
      policy,
      refresh,
      toast,
      nav,
      back,
      route: entry.route,
      prefill,
      setPrefill,
      logout,
    }),
    [me, workers, jobs, contrib, policy, refresh, toast, nav, back, entry.route, prefill, logout]
  )

  return (
    <ThemeProvider mode={mode} toggle={toggleTheme} signedIn={authed}>
      <AppCtx.Provider value={ctxValue}>
        <Shell
          booting={booting}
          authed={authed}
          entry={entry}
          depth={depth}
          me={me}
          mode={mode}
          onToggleTheme={toggleTheme}
          onNav={nav}
          onBack={back}
          onAuthed={() => void refresh()}
          toastState={toastState}
        />
      </AppCtx.Provider>
    </ThemeProvider>
  )
}

function Shell({
  booting,
  authed,
  entry,
  depth,
  me,
  mode,
  onToggleTheme,
  onNav,
  onBack,
  onAuthed,
  toastState,
}: {
  booting: boolean
  authed: boolean
  entry: Entry
  depth: number
  me: any
  mode: Mode
  onToggleTheme: () => void
  onNav: (r: Route, p?: RouteParams) => void
  onBack: () => void
  onAuthed: () => void
  toastState: { msg: string; tone?: 'ok' | 'bad' | 'warn' } | null
}) {
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const statusBarStyle = mode === 'dark' ? 'light' : 'dark'

  if (booting) {
    return (
      <View style={[s.root, { backgroundColor: c.bg }]}>
        <StatusBar style={statusBarStyle} />
        <Loading text="正在连接星栈…" />
      </View>
    )
  }

  if (!authed) {
    return (
      <View style={[s.root, { backgroundColor: c.bg }]}>
        <StatusBar style={statusBarStyle} />
        <Auth onDone={onAuthed} />
      </View>
    )
  }

  return (
    <View style={[s.root, { backgroundColor: c.bg }]}>
      <StatusBar style={statusBarStyle} />
      <View style={s.topbar}>
        {depth > 0 ? (
          <Pressable onPress={onBack} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}>
            <Icon name="chevL" size={18} color={c.body} />
          </Pressable>
        ) : (
          <View style={s.brandMark}>
            <StarMark size={16} color={c.accentInk} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={s.crumb} numberOfLines={1}>
            {depth > 0 ? '星栈控制台' : TITLES[entry.route]} ·{' '}
            <Text style={s.crumbSub}>{SUBTITLES[entry.route] || 'Starstack'}</Text>
          </Text>
          <Text style={s.pageTitle} numberOfLines={1}>
            {depth > 0 ? TITLES[entry.route] : '星栈算力'}
          </Text>
        </View>
        <Pressable onPress={onToggleTheme} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}>
          <Icon name={mode === 'dark' ? 'sun' : 'moon'} size={16} color={c.body} />
        </Pressable>
        <Pressable onPress={() => onNav('wallet')} style={({ pressed }) => [s.balance, pressed && { opacity: 0.7 }]}>
          <Text style={s.balanceLabel}>余额</Text>
          <Text style={s.balanceValue}>{Number(me?.credits || 0).toFixed(2)}</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        <Screen route={entry.route} params={entry.params} />
      </View>

      {toastState ? (
        <View style={s.toastWrap} pointerEvents="none">
          <Toast msg={toastState.msg} tone={toastState.tone} />
        </View>
      ) : null}

      <View style={s.tabbar}>
        {TABS.map((t) => {
          const on = entry.route === t.key
          return (
            <Pressable
              key={t.key}
              onPress={() => onNav(t.key)}
              style={({ pressed }) => [s.tab, on && s.tabOn, pressed && { opacity: 0.7 }]}
            >
              <Icon name={t.icon} size={19} color={on ? c.accent : c.mute} />
              <Text style={[s.tabLabel, { color: on ? c.accent : c.mute }, on && { fontWeight: '600' }]}>{t.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function Screen({ route, params }: { route: Route; params?: RouteParams }) {
  switch (route) {
    case 'overview':
      return <Overview />
    case 'create':
      return <Create params={params} />
    case 'market':
      return <Market params={params} />
    case 'pool':
      return <Market params={{ tab: 'pool' }} />
    case 'jobs':
      return <Jobs />
    case 'job':
      return <JobDetail id={params?.id || ''} />
    case 'me':
      return <Me />
    case 'wallet':
      return <Wallet />
    case 'nodes':
      return <Nodes />
    case 'messages':
      return <Messages params={params} />
    case 'forum':
      return <Forum />
    case 'api':
      return <ApiView />
    case 'sell':
      return <Sell />
    case 'settings':
      return <Settings />
    default:
      return <Overview />
  }
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 0 : 44,
    },
    topbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 10,
      backgroundColor: c.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.hair,
    },
    brandMark: {
      width: 32,
      height: 32,
      borderRadius: 9,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconBtn: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.soft,
    },
    crumb: { fontSize: 10, color: c.mute, letterSpacing: 0.3 },
    crumbSub: { color: c.faint },
    pageTitle: { fontSize: 15, fontWeight: '700', color: c.ink, marginTop: 1 },
    balance: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 3,
      paddingHorizontal: 10,
      height: 30,
      borderRadius: 999,
      backgroundColor: c.accentSoft,
    },
    balanceLabel: { fontSize: 9.5, color: c.accent, fontWeight: '600' },
    balanceValue: { fontSize: 12.5, color: c.accent, fontWeight: '700' },
    tabbar: {
      flexDirection: 'row',
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hair,
      backgroundColor: c.surface,
      paddingTop: 6,
      paddingBottom: Platform.OS === 'android' ? 10 : 20,
      paddingHorizontal: 6,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      gap: 3,
      paddingVertical: 6,
      marginHorizontal: 2,
      borderRadius: 10,
    },
    tabOn: { backgroundColor: c.accentSoft },
    tabLabel: { fontSize: 10.5 },
    toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 84, alignItems: 'center' },
  })
