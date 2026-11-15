import AsyncStorage from '@react-native-async-storage/async-storage'

const K = {
  token: 'ss.token',
  base: 'ss.base',
  theme: 'ss.theme',
  nodeRun: 'ss.node.run',
} as const

// 公网入口；本地联调时在登录页改成 http://<局域网IP>:8787
export const DEFAULT_BASE = 'https://starstack.run'

export type Session = { token: string; base: string }

// createApi 需要同步读 token/base，而 AsyncStorage 只有异步接口：
// 这里维护一份内存镜像，启动时灌一次、之后写入时同步更新。
export const mem: Session = { token: '', base: DEFAULT_BASE }

export async function loadSession(): Promise<Session> {
  const [token, base] = await Promise.all([AsyncStorage.getItem(K.token), AsyncStorage.getItem(K.base)])
  mem.token = token ?? ''
  mem.base = base || DEFAULT_BASE
  return { ...mem }
}

export async function saveToken(token: string): Promise<void> {
  mem.token = token
  if (token) await AsyncStorage.setItem(K.token, token)
}

export async function clearToken(): Promise<void> {
  mem.token = ''
  await AsyncStorage.removeItem(K.token)
}

export async function saveBase(base: string): Promise<void> {
  const v = (base || '').trim().replace(/\/+$/, '')
  mem.base = v || DEFAULT_BASE
  await AsyncStorage.setItem(K.base, mem.base)
}

export async function getTheme(): Promise<'light' | 'dark'> {
  const v = await AsyncStorage.getItem(K.theme)
  return v === 'dark' ? 'dark' : 'light'
}

export async function setTheme(v: 'light' | 'dark'): Promise<void> {
  await AsyncStorage.setItem(K.theme, v)
}

// 上次退出时节点是否在跑，用于重进 App 后自动恢复前台服务
export async function getNodeAutoStart(): Promise<boolean> {
  return (await AsyncStorage.getItem(K.nodeRun)) === '1'
}

export async function setNodeAutoStart(on: boolean): Promise<void> {
  await AsyncStorage.setItem(K.nodeRun, on ? '1' : '0')
}
