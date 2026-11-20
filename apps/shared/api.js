// Shared by the Android app (React + Capacitor) and the WeChat mini program.
// The platform supplies a transport and token storage; everything else — paths,
// payload shapes, error unwrapping — lives here so the two clients cannot drift.

export class ApiError extends Error {
  constructor(message, status) {
    super(message || '请求失败')
    this.name = 'ApiError'
    this.status = status || 0
  }
}

const enc = encodeURIComponent
const trim = (b) => String(b || '').replace(/\/+$/, '')
const qs = (obj) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&')
// 列表端点的可选查询串（分页 limit/offset/cursor、服务端搜索 q）。
// 不传参数时返回空串，请求与旧契约完全一致。
const qsSuffix = (obj) => {
  const s = qs(obj || {})
  return s ? '?' + s : ''
}

/**
 * @param {object} opts
 * @param {string|(()=>string)} opts.baseUrl  broker root, e.g. http://1.2.3.4:8787
 * @param {()=>string} opts.getToken          session token from login response
 * @param {(req:{url:string,method:string,headers:object,body?:string})=>Promise<{status:number,text:string}>} opts.request
 * @param {(req:{url:string,method:string,headers:object,form:FormData|object})=>Promise<{status:number,text:string}>} opts.upload
 */
export function createApi({ baseUrl, getToken, request, upload }) {
  const root = () => trim(typeof baseUrl === 'function' ? baseUrl() : baseUrl)
  const url = (path) => root() + path
  const auth = () => {
    const t = getToken ? getToken() : ''
    return t ? { Authorization: 'Bearer ' + t } : {}
  }
  const parse = (res) => {
    let data = null
    const text = res && typeof res.text === 'string' ? res.text : ''
    if (text) {
      try {
        data = JSON.parse(text)
      } catch (e) {
        /* non-JSON body: fall through to raw text as the error message */
      }
    }
    if (!res || res.status < 200 || res.status >= 300) {
      const msg = (data && data.error) || text || 'HTTP ' + ((res && res.status) || 0)
      throw new ApiError(msg, res ? res.status : 0)
    }
    return data
  }
  const call = (method, path, body) =>
    request({
      url: url(path),
      method,
      headers: body === undefined ? auth() : { ...auth(), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(parse)
  const get = (p) => call('GET', p)
  const post = (p, b) => call('POST', p, b === undefined ? {} : b)
  const put = (p, b) => call('PUT', p, b === undefined ? {} : b)
  const del = (p) => call('DELETE', p, undefined)
  const uploadTo = (p, form) => upload({ url: url(p), method: 'POST', headers: auth(), form }).then(parse)

  return {
    baseUrl: root,

    // auth
    login: (name, password) => post('/api/auth/login', { name, password }),
    // 账号是邮箱：注册只收 email，显示名由服务端从邮箱前缀推导。
    register: (email, password, invite) => post('/api/auth/register', { email, password, invite }),
    logout: () => post('/api/auth/logout', {}),
    me: () => get('/api/me'),
    state: () => get('/api/state'),

    // jobs
    // jobs 支持可选分页（limit/offset）；不传参数时与旧契约完全一致。
    jobs: (opts) => get('/api/jobs' + qsSuffix(opts)),
    estimate: ({ duration, kind, vcodec, req }) => get('/api/estimate?' + qs({ duration, kind, vcodec, req: JSON.stringify(req || {}) })),
    submitTranscode: (form) => uploadTo('/api/jobs', form),
    submitRender: (form) => uploadTo('/api/jobs/render', form),
    submitBuild: (form) => uploadTo('/api/jobs/build', form),
    cancelJob: (id) => post('/api/jobs/' + enc(id) + '/cancel', {}),
    jobLogs: (id) => get('/api/jobs/' + enc(id) + '/logs'),
    nodeLogs: (id) => get('/api/nodes/' + enc(id) + '/logs'),

    // billing
    // ledger 支持可选分页（limit/offset）；不传参数时与旧契约完全一致。
    ledger: (opts) => get('/api/ledger' + qsSuffix(opts)),
    recharge: (amount) => post('/api/me/recharge', { amount }),
    settings: () => get('/api/me/settings'),
    saveSettings: (advanced) => put('/api/me/settings', { advanced }),

    // model gateway
    keys: () => get('/api/keys'),
    createKey: (name, dailyQuota) => post('/api/keys', { name, daily_quota: Number(dailyQuota) || 0 }),
    revokeKey: (id) => del('/api/keys/' + enc(id)),
    // 免密钥试聊（agent 聊天的模型回落通道）：最多 12 条 / 单条 2000 字 / 合计 8000 字，末条必须是 user。
    tryChat: (model, messages) => post('/api/models/try', { model, messages }),
    // 用量对账仅平台自营账户返回 200，普通账户 403（调用方按降级处理）。
    usage: (days) => get('/api/models/usage?days=' + enc(days || 7)),
    catalog: () => get('/api/models/catalog'),
    upstreams: () => get('/api/models/upstreams'),
    addUpstream: (body) => post('/api/models/upstreams', body),
    probeUpstream: (base_url, api_key) => post('/api/models/upstreams/probe', { base_url, api_key }),
    setUpstream: (id, enabled) => put('/api/models/upstreams/' + enc(id), { enabled }),
    delUpstream: (id) => del('/api/models/upstreams/' + enc(id)),

    // compute market and provider nodes
    market: () => get('/api/market'),
    launchNode: (body) => post('/api/nodes/launch', body),
    pending: () => get('/api/pending'),
    pair: (code) => post('/api/pair', { code }),
    setNodePrice: (id, price) => put('/api/nodes/' + enc(id), { price }),
    pauseNode: (id, paused) => put('/api/nodes/' + enc(id) + '/pause', { paused }),
    deleteNode: (id) => del('/api/nodes/' + enc(id)),
    contribution: () => get('/api/contribution'),

    // service offers (服务挂牌：市场 / 发布 / 买卖会话)
    // 支持可选查询参数：category、q（服务端搜索）、limit/offset（分页）；不传时与旧契约一致。
    offers: (opts) => get('/api/offers' + qsSuffix(opts)),
    offer: (id) => get('/api/offers/' + enc(id)),
    createOffer: (form) => uploadTo('/api/offers', form),
    delOffer: (id) => del('/api/offers/' + enc(id)),
    offerMediaUrl: (id) => url('/api/offers/media/' + enc(id)),
    useOffer: (id) => post('/api/offers/' + enc(id) + '/use', {}),
    startConversation: (id) => post('/api/offers/' + enc(id) + '/conversation', {}),
    conversations: (opts) => get('/api/offers/conversations' + qsSuffix(opts)),
    conversation: (cid, opts) => get('/api/offers/conversations/' + enc(cid) + qsSuffix(opts)),
    sendMessage: (cid, body) => post('/api/offers/conversations/' + enc(cid), { body }),

    // ComfyUI 工作台状态（不可达时 404/失败，调用方降级为离线）
    comfyStatus: () => get('/api/comfy/status'),

    // IPv6 cloud hosts
    vmOffers: () => get('/api/vm/offers'),
    vmInstances: () => get('/api/vm/instances'),
    vmOrder: (body) => post('/api/vm/orders', body),
    vmPublish: (body) => post('/api/vm/offers', body),
    vmSetOffer: (id, enabled) => put('/api/vm/offers/' + enc(id), { enabled }),
    vmDelOffer: (id) => del('/api/vm/offers/' + enc(id)),
    vmStop: (id) => post('/api/vm/instances/' + enc(id) + '/stop', {}),
    vmExtend: (id, hours) => post('/api/vm/instances/' + enc(id) + '/extend', { hours }),

    // community board
    // forumPosts 支持可选分页/搜索（limit/offset/q）；不传时与旧契约一致。
    forumPosts: (opts) => get('/api/forum/posts' + qsSuffix(opts)),
    forumPost: (id) => get('/api/forum/posts/' + enc(id)),
    createPost: (form) => uploadTo('/api/forum/posts', form),
    comment: (id, form) => uploadTo('/api/forum/posts/' + enc(id) + '/comments', form),
    mediaUrl: (id) => url('/api/forum/media/' + enc(id)),
    downloadUrl: (jobId, which) => url('/download/' + enc(jobId) + (which ? '?which=' + enc(which) : '')),
    launchScriptUrl: (path) => url(path),
  }
}
