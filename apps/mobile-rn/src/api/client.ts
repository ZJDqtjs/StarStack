// 迁移自 apps/shared/api.js：路径、payload、错误解包与旧客户端完全一致，
// 只把 transport 换成 RN 的 fetch（见 transport.ts）。

export class ApiError extends Error {
  status: number
  constructor(message?: string, status?: number) {
    super(message || '请求失败')
    this.name = 'ApiError'
    this.status = status || 0
  }
}

export type HttpReq = { url: string; method: string; headers: Record<string, string>; body?: string }
export type UploadReq = { url: string; method: string; headers: Record<string, string>; form: FormData }
export type Resp = { status: number; text: string }

export type ApiOptions = {
  baseUrl: string | (() => string)
  getToken?: () => string
  request: (req: HttpReq) => Promise<Resp>
  upload: (req: UploadReq) => Promise<Resp>
}

const enc = encodeURIComponent
const trim = (b: string) => String(b || '').replace(/\/+$/, '')
const qs = (obj: Record<string, unknown>) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(String(v))}`)
    .join('&')
const qsSuffix = (obj?: Record<string, unknown>) => {
  const s = qs(obj || {})
  return s ? '?' + s : ''
}

export function createApi({ baseUrl, getToken, request, upload }: ApiOptions) {
  const root = () => trim(typeof baseUrl === 'function' ? baseUrl() : baseUrl)
  const url = (path: string) => root() + path
  const auth = (): Record<string, string> => {
    const t = getToken ? getToken() : ''
    return t ? { Authorization: 'Bearer ' + t } : {}
  }
  const parse = (res: Resp): any => {
    let data: any = null
    const text = res && typeof res.text === 'string' ? res.text : ''
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        // 非 JSON 响应：把原文当作错误信息
      }
    }
    if (!res || res.status < 200 || res.status >= 300) {
      const msg = (data && data.error) || text || 'HTTP ' + ((res && res.status) || 0)
      throw new ApiError(msg, res ? res.status : 0)
    }
    return data
  }
  const call = (method: string, path: string, body?: unknown) =>
    request({
      url: url(path),
      method,
      headers: body === undefined ? auth() : { ...auth(), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(parse)
  const get = (p: string) => call('GET', p)
  const post = (p: string, b?: unknown) => call('POST', p, b === undefined ? {} : b)
  const put = (p: string, b?: unknown) => call('PUT', p, b === undefined ? {} : b)
  const del = (p: string) => call('DELETE', p, undefined)
  const uploadTo = (p: string, form: FormData) =>
    upload({ url: url(p), method: 'POST', headers: auth(), form }).then(parse)

  return {
    baseUrl: root,

    // auth
    login: (name: string, password: string) => post('/api/auth/login', { name, password }),
    register: (name: string, password: string, invite?: string) =>
      post('/api/auth/register', { name, password, invite }),
    logout: () => post('/api/auth/logout', {}),
    me: () => get('/api/me'),
    state: () => get('/api/state'),

    // jobs
    jobs: (opts?: Record<string, unknown>) => get('/api/jobs' + qsSuffix(opts)),
    estimate: (body: { duration: number; kind?: string; vcodec?: string; req?: unknown }) =>
      get('/api/estimate?' + qs({ ...body, req: JSON.stringify(body.req || {}) })),
    submitTranscode: (form: FormData) => uploadTo('/api/jobs', form),
    submitRender: (form: FormData) => uploadTo('/api/jobs/render', form),
    submitBuild: (form: FormData) => uploadTo('/api/jobs/build', form),
    cancelJob: (id: string) => post('/api/jobs/' + enc(id) + '/cancel', {}),
    jobLogs: (id: string) => get('/api/jobs/' + enc(id) + '/logs'),
    nodeLogs: (id: string) => get('/api/nodes/' + enc(id) + '/logs'),

    // billing
    ledger: (opts?: Record<string, unknown>) => get('/api/ledger' + qsSuffix(opts)),
    settings: () => get('/api/me/settings'),
    saveSettings: (advanced: boolean) => put('/api/me/settings', { advanced }),
    recharge: (amount: number) => post('/api/me/recharge', { amount }),

    // 服务市场（卖家挂牌）与买卖会话
    offers: () => get('/api/offers'),
    useOffer: (id: string) => post('/api/offers/' + enc(id) + '/use', {}),
    contactOffer: (id: string) => post('/api/offers/' + enc(id) + '/conversation', {}),
    publishOffer: (form: FormData) => uploadTo('/api/offers', form),
    deleteOffer: (id: string) => del('/api/offers/' + enc(id)),
    offerImage: (id: string) => url('/api/offers/media/' + enc(id)),
    conversations: () => get('/api/offers/conversations'),
    conversation: (id: string) => get('/api/offers/conversations/' + enc(id)),
    sendMessage: (id: string, body: string) => post('/api/offers/conversations/' + enc(id), { body }),

    // 社区
    posts: () => get('/api/forum/posts'),
    post: (id: string) => get('/api/forum/posts/' + enc(id)),
    createPost: (form: FormData) => uploadTo('/api/forum/posts', form),
    commentPost: (id: string, form: FormData) => uploadTo('/api/forum/posts/' + enc(id) + '/comments', form),
    mediaUrl: (id: string) => url('/api/forum/media/' + enc(id)),

    // model gateway
    catalog: () => get('/api/models/catalog'),
    tryChat: (model: string, messages: unknown[]) => post('/api/models/try', { model, messages }),

    // compute market and provider nodes
    market: () => get('/api/market'),
    launchNode: (body: unknown) => post('/api/nodes/launch', body),
    pending: () => get('/api/pending'),
    pair: (code: string) => post('/api/pair', { code }),
    setNodePrice: (id: string, price: number) => put('/api/nodes/' + enc(id), { price }),
    pauseNode: (id: string, paused: boolean) => put('/api/nodes/' + enc(id) + '/pause', { paused }),
    deleteNode: (id: string) => del('/api/nodes/' + enc(id)),
    contribution: () => get('/api/contribution'),

    // IPv6 cloud hosts
    vmOffers: () => get('/api/vm/offers'),
    vmInstances: () => get('/api/vm/instances'),
    vmOrder: (body: unknown) => post('/api/vm/orders', body),
    vmStop: (id: string) => post('/api/vm/instances/' + enc(id) + '/stop', {}),
    vmExtend: (id: string, hours: number) => post('/api/vm/instances/' + enc(id) + '/extend', { hours }),
    vmUpdateOffer: (id: string, enabled: boolean) => put('/api/vm/offers/' + enc(id), { enabled }),
    vmPublishOffer: (body: unknown) => post('/api/vm/offers', body),
    vmDeleteOffer: (id: string) => del('/api/vm/offers/' + enc(id)),

    // API keys（模型网关）
    keys: () => get('/api/keys'),
    createKey: (name: string, daily_quota: number) => post('/api/keys', { name, daily_quota }),
    deleteKey: (id: string) => del('/api/keys/' + enc(id)),

    downloadUrl: (jobId: string, which?: string) =>
      url('/download/' + enc(jobId) + (which ? '?which=' + enc(which) : '')),
  }
}

export type Api = ReturnType<typeof createApi>
