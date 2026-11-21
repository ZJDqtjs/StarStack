import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api } from '../mobile-rn/src/api'
import { clearToken, getTheme, loadSession, setTheme as persistTheme } from '../mobile-rn/src/session'
import { AppCtx, type Route, type RouteParams } from '../mobile-rn/src/ctx'
import { PlatformProvider } from '../mobile-rn/src/platform'
import { ThemeProvider, useStyles, useTheme, type Mode, type Palette } from '../mobile-rn/src/theme'
import { Icon, Loading, StarMark, Toast, type IconName } from '../mobile-rn/src/ui'
import Auth from '../mobile-rn/src/screens/Auth'
import Overview from '../mobile-rn/src/screens/Overview'
import Create from '../mobile-rn/src/screens/Create'
import Market from '../mobile-rn/src/screens/Market'
import Jobs from '../mobile-rn/src/screens/Jobs'
import JobDetail from '../mobile-rn/src/screens/JobDetail'
import Me from '../mobile-rn/src/screens/Me'
import Wallet from '../mobile-rn/src/screens/Wallet'
import Nodes from '../mobile-rn/src/screens/Nodes'
import Messages from '../mobile-rn/src/screens/Messages'
import Forum from '../mobile-rn/src/screens/Forum'
import ApiView from '../mobile-rn/src/screens/ApiView'
import Sell from '../mobile-rn/src/screens/Sell'
import Settings from '../mobile-rn/src/screens/Settings'
import { winPlatform } from './src/platform-win'

const NAV: { label: string; items: [Route, string, IconName][] }[] = [
  { label: 'Workspace', items: [['overview', '总览', 'home'], ['create', '创作工作台', 'render'], ['jobs', '我的任务', 'jobs']] },
  { label: 'Trade', items: [['market', '服务市场', 'market'], ['sell', '我的发布', 'sell'], ['messages', '买卖会话', 'messages']] },
  { label: 'Compute', items: [['nodes', '我的节点', 'nodes'], ['pool', '算力池', 'pool']] },
  { label: 'Account', items: [['wallet', '钱包账单', 'wallet'], ['forum', '星栈论坛', 'forum'], ['api', '模型 API', 'api'], ['settings', '设置', 'settings'], ['me', '个人中心', 'user']] },
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

export default function App() {
  const [mode, setMode] = useState<Mode>('light')
  const [booting, setBooting] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [me, setMe] = useState<any>(null)
  const [workers, setWorkers] = useState<any[]>([])
  const [jobs, setJobs] = useState<any[]>([])
  const [contrib, setContrib] = useState<any>(null)
  const [policy, setPolicy] = useState<any>(null)
  const [route, setRoute] = useState<Route>('overview')
  const [params, setParams] = useState<RouteParams | undefined>()
  const [toastState, setToastState] = useState<{ msg: string; tone?: 'ok' | 'bad' | 'warn' } | null>(null)

  const toast = useCallback((msg: string, tone?: 'ok' | 'bad' | 'warn') => {
    setToastState({ msg, tone })
    setTimeout(() => setToastState(null), 2600)
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
        // token 由 loadSession 灌进内存；没有 token 时 refresh 会返回 signed_in=false
        await refresh()
      } catch {
        // 启动阶段网络不可用不阻塞登录页
      } finally {
        setBooting(false)
      }
    })()
  }, [refresh])

  useEffect(() => {
    if (!authed) return
    const timer = setInterval(() => refresh().catch(() => {}), 15_000)
    return () => clearInterval(timer)
  }, [authed, refresh])

  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      void persistTheme(next)
      return next
    })
  }, [])

  const nav = useCallback((r: Route, p?: RouteParams) => {
    setRoute(r)
    setParams(p)
  }, [])

  const logout = useCallback(() => {
    api.logout().catch(() => {})
    void clearToken()
    setAuthed(false)
    setMe(null)
    setJobs([])
    setWorkers([])
    setContrib(null)
    setRoute('overview')
  }, [])

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
      back: () => setRoute('overview'),
      route,
      prefill: null,
      setPrefill: () => {},
      logout,
    }),
    [me, workers, jobs, contrib, policy, refresh, toast, nav, route, logout],
  )

  return (
    <PlatformProvider value={winPlatform}>
      <ThemeProvider mode={mode} toggle={toggleTheme} signedIn={authed}>
        <AppCtx.Provider value={ctxValue}>
          <Shell
            booting={booting}
            authed={authed}
            me={me}
            workers={workers}
            route={route}
            params={params}
            mode={mode}
            onToggleTheme={toggleTheme}
            onNav={nav}
            onAuthed={() => void refresh()}
            onLogout={logout}
            toastState={toastState}
          />
        </AppCtx.Provider>
      </ThemeProvider>
    </PlatformProvider>
  )
}

function Shell({
  booting,
  authed,
  me,
  workers,
  route,
  params,
  mode,
  onToggleTheme,
  onNav,
  onAuthed,
  onLogout,
  toastState,
}: {
  booting: boolean
  authed: boolean
  me: any
  workers: any[]
  route: Route
  params?: RouteParams
  mode: Mode
  onToggleTheme: () => void
  onNav: (r: Route, p?: RouteParams) => void
  onAuthed: () => void
  onLogout: () => void
  toastState: { msg: string; tone?: 'ok' | 'bad' | 'warn' } | null
}) {
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const online = workers.filter((w) => w.online).length

  if (booting) {
    return (
      <View style={[s.root, { backgroundColor: c.bg }]}>
        <Loading text="正在连接星栈…" />
      </View>
    )
  }

  if (!authed) {
    return (
      <View style={[s.root, { backgroundColor: c.bg }]}>
        <Auth onDone={onAuthed} />
      </View>
    )
  }

  return (
    <View style={[s.root, { backgroundColor: c.bg }]}>
      <View style={s.side}>
        <View style={s.brand}>
          <View style={s.mark}>
            <StarMark size={16} color={c.accentInk} />
          </View>
          <View>
            <Text style={s.brandName}>星栈算力</Text>
            <Text style={s.brandSub}>Desktop · React Native</Text>
          </View>
        </View>
        {NAV.map((g) => (
          <View key={g.label} style={s.group}>
            <Text style={s.groupLabel}>{g.label}</Text>
            {g.items.map(([r, label, icon]) => {
              const on = route === r
              return (
                <Pressable key={r} onPress={() => onNav(r)} style={[s.navItem, on && s.navOn]}>
                  <Icon name={icon} size={16} color={on ? c.accent : c.mute} />
                  <Text style={[s.navText, on && { color: c.accent, fontWeight: '600' }]}>{label}</Text>
                </Pressable>
              )
            })}
          </View>
        ))}
        <View style={s.sideFoot}>
          <Pressable onPress={() => onNav('wallet')} style={s.wallet}>
            <Text style={s.walletLabel}>账户余额</Text>
            <Text style={s.walletValue}>{Number(me?.credits || 0).toFixed(2)}</Text>
          </Pressable>
          <View style={s.sideRow}>
            <Pressable onPress={onToggleTheme} style={s.iconBtn}>
              <Icon name={mode === 'dark' ? 'sun' : 'moon'} size={15} color={c.body} />
            </Pressable>
            <Text style={s.user} numberOfLines={1}>{me?.name || ''}</Text>
            <Pressable onPress={onLogout} style={s.logout}>
              <Text style={s.logoutText}>退出</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={s.main}>
        <View style={s.topbar}>
          <View>
            <Text style={s.crumb}>星栈控制台 / Desktop</Text>
            <Text style={s.title}>{TITLES[route]}</Text>
          </View>
          <View style={s.topRight}>
            <View style={s.pill}>
              <View style={s.dot} />
              <Text style={s.pillText}>在线节点 {online}</Text>
            </View>
            <View style={s.pill}>
              <Text style={s.pillText}>余额 {Number(me?.credits || 0).toFixed(2)} 点</Text>
            </View>
            <Pressable onPress={() => onNav('create')} style={s.newBtn}>
              <Icon name="plus" size={14} color={c.accentInk} />
              <Text style={s.newText}>新建任务</Text>
            </Pressable>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Screen route={route} params={params} />
        </View>
      </View>

      {toastState ? (
        <View style={s.toastWrap} pointerEvents="none">
          <Toast msg={toastState.msg} tone={toastState.tone} />
        </View>
      ) : null}
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
    root: { flex: 1, flexDirection: 'row' },
    side: { width: 214, backgroundColor: c.surface, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.hair, padding: 12, gap: 10 },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 6, paddingVertical: 8 },
    mark: { width: 32, height: 32, borderRadius: 9, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
    brandName: { fontSize: 14, fontWeight: '700', color: c.ink },
    brandSub: { fontSize: 9.5, color: c.faint },
    group: { gap: 2, marginTop: 4 },
    groupLabel: { fontSize: 9.5, letterSpacing: 1, color: c.faint, paddingHorizontal: 8, marginBottom: 2 },
    navItem: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 8 },
    navOn: { backgroundColor: c.accentSoft },
    navText: { fontSize: 12.5, color: c.body },
    sideFoot: { marginTop: 'auto', gap: 8 },
    wallet: { backgroundColor: c.inset, borderRadius: 10, padding: 10 },
    walletLabel: { fontSize: 9.5, color: c.faint },
    walletValue: { fontSize: 18, fontWeight: '700', color: c.ink, marginTop: 2 },
    sideRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    iconBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' },
    user: { flex: 1, fontSize: 11, color: c.body },
    logout: { paddingHorizontal: 8, paddingVertical: 5 },
    logoutText: { fontSize: 11, color: c.mute },
    main: { flex: 1 },
    topbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.hair,
      backgroundColor: c.bg,
    },
    crumb: { fontSize: 9.5, color: c.faint },
    title: { fontSize: 18, fontWeight: '700', color: c.ink, marginTop: 1 },
    topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hair, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.ok },
    pillText: { fontSize: 10.5, color: c.body },
    newBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.accent, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8 },
    newText: { fontSize: 11.5, fontWeight: '600', color: c.accentInk },
    toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center' },
  })
