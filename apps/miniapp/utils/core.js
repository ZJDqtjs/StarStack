var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// shared/index.js
var index_exports = {};
__export(index_exports, {
  ApiError: () => ApiError,
  CAP_NAMES: () => CAP_NAMES,
  INFLIGHT: () => INFLIGHT,
  JOB_ST: () => JOB_ST,
  LEDGER_KIND: () => LEDGER_KIND,
  MINIAPP_ROUTES: () => MINIAPP_ROUTES,
  MOBILE_ROUTES: () => MOBILE_ROUTES,
  QUALITY: () => QUALITY,
  VM_ST: () => VM_ST,
  WEB_ROUTES: () => WEB_ROUTES,
  createApi: () => createApi,
  ctxLabel: () => ctxLabel,
  f1: () => f1,
  f2: () => f2,
  fileSize: () => fileSize,
  hms: () => hms,
  memGB: () => memGB,
  parseIntent: () => parseIntent,
  points: () => points,
  portsLabel: () => portsLabel,
  relTime: () => relTime,
  shortId: () => shortId,
  toneOf: () => toneOf,
  ts: () => ts
});
module.exports = __toCommonJS(index_exports);

// shared/api.js
var ApiError = class extends Error {
  constructor(message, status) {
    super(message || "\u8BF7\u6C42\u5931\u8D25");
    this.name = "ApiError";
    this.status = status || 0;
  }
};
var enc = encodeURIComponent;
var trim = (b) => String(b || "").replace(/\/+$/, "");
var qs = (obj) => Object.entries(obj).filter(([, v]) => v !== void 0 && v !== null && v !== "").map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");
var qsSuffix = (obj) => {
  const s = qs(obj || {});
  return s ? "?" + s : "";
};
function createApi({ baseUrl, getToken, request, upload }) {
  const root = () => trim(typeof baseUrl === "function" ? baseUrl() : baseUrl);
  const url = (path) => root() + path;
  const auth = () => {
    const t = getToken ? getToken() : "";
    return t ? { Authorization: "Bearer " + t } : {};
  };
  const parse = (res) => {
    let data = null;
    const text = res && typeof res.text === "string" ? res.text : "";
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
      }
    }
    if (!res || res.status < 200 || res.status >= 300) {
      const msg = data && data.error || text || "HTTP " + (res && res.status || 0);
      throw new ApiError(msg, res ? res.status : 0);
    }
    return data;
  };
  const call = (method, path, body) => request({
    url: url(path),
    method,
    headers: body === void 0 ? auth() : __spreadProps(__spreadValues({}, auth()), { "Content-Type": "application/json" }),
    body: body === void 0 ? void 0 : JSON.stringify(body)
  }).then(parse);
  const get = (p) => call("GET", p);
  const post = (p, b) => call("POST", p, b === void 0 ? {} : b);
  const put = (p, b) => call("PUT", p, b === void 0 ? {} : b);
  const del = (p) => call("DELETE", p, void 0);
  const uploadTo = (p, form) => upload({ url: url(p), method: "POST", headers: auth(), form }).then(parse);
  return {
    baseUrl: root,
    // auth
    login: (name, password) => post("/api/auth/login", { name, password }),
    register: (name, password, invite) => post("/api/auth/register", { name, password, invite }),
    logout: () => post("/api/auth/logout", {}),
    me: () => get("/api/me"),
    state: () => get("/api/state"),
    // jobs
    // jobs 支持可选分页（limit/offset）；不传参数时与旧契约完全一致。
    jobs: (opts) => get("/api/jobs" + qsSuffix(opts)),
    estimate: ({ duration, kind, vcodec, req }) => get("/api/estimate?" + qs({ duration, kind, vcodec, req: JSON.stringify(req || {}) })),
    submitTranscode: (form) => uploadTo("/api/jobs", form),
    submitRender: (form) => uploadTo("/api/jobs/render", form),
    submitBuild: (form) => uploadTo("/api/jobs/build", form),
    cancelJob: (id) => post("/api/jobs/" + enc(id) + "/cancel", {}),
    jobLogs: (id) => get("/api/jobs/" + enc(id) + "/logs"),
    nodeLogs: (id) => get("/api/nodes/" + enc(id) + "/logs"),
    // billing
    // ledger 支持可选分页（limit/offset）；不传参数时与旧契约完全一致。
    ledger: (opts) => get("/api/ledger" + qsSuffix(opts)),
    recharge: (amount) => post("/api/me/recharge", { amount }),
    settings: () => get("/api/me/settings"),
    saveSettings: (advanced) => put("/api/me/settings", { advanced }),
    // model gateway
    keys: () => get("/api/keys"),
    createKey: (name, dailyQuota) => post("/api/keys", { name, daily_quota: Number(dailyQuota) || 0 }),
    revokeKey: (id) => del("/api/keys/" + enc(id)),
    // 免密钥试聊（agent 聊天的模型回落通道）：最多 12 条 / 单条 2000 字 / 合计 8000 字，末条必须是 user。
    tryChat: (model, messages) => post("/api/models/try", { model, messages }),
    // 用量对账仅平台自营账户返回 200，普通账户 403（调用方按降级处理）。
    usage: (days) => get("/api/models/usage?days=" + enc(days || 7)),
    catalog: () => get("/api/models/catalog"),
    upstreams: () => get("/api/models/upstreams"),
    addUpstream: (body) => post("/api/models/upstreams", body),
    probeUpstream: (base_url, api_key) => post("/api/models/upstreams/probe", { base_url, api_key }),
    setUpstream: (id, enabled) => put("/api/models/upstreams/" + enc(id), { enabled }),
    delUpstream: (id) => del("/api/models/upstreams/" + enc(id)),
    // compute market and provider nodes
    market: () => get("/api/market"),
    launchNode: (body) => post("/api/nodes/launch", body),
    pending: () => get("/api/pending"),
    pair: (code) => post("/api/pair", { code }),
    setNodePrice: (id, price) => put("/api/nodes/" + enc(id), { price }),
    pauseNode: (id, paused) => put("/api/nodes/" + enc(id) + "/pause", { paused }),
    deleteNode: (id) => del("/api/nodes/" + enc(id)),
    contribution: () => get("/api/contribution"),
    // service offers (服务挂牌：市场 / 发布 / 买卖会话)
    // 支持可选查询参数：category、q（服务端搜索）、limit/offset（分页）；不传时与旧契约一致。
    offers: (opts) => get("/api/offers" + qsSuffix(opts)),
    offer: (id) => get("/api/offers/" + enc(id)),
    createOffer: (form) => uploadTo("/api/offers", form),
    delOffer: (id) => del("/api/offers/" + enc(id)),
    offerMediaUrl: (id) => url("/api/offers/media/" + enc(id)),
    useOffer: (id) => post("/api/offers/" + enc(id) + "/use", {}),
    startConversation: (id) => post("/api/offers/" + enc(id) + "/conversation", {}),
    conversations: (opts) => get("/api/offers/conversations" + qsSuffix(opts)),
    conversation: (cid, opts) => get("/api/offers/conversations/" + enc(cid) + qsSuffix(opts)),
    sendMessage: (cid, body) => post("/api/offers/conversations/" + enc(cid), { body }),
    // ComfyUI 工作台状态（不可达时 404/失败，调用方降级为离线）
    comfyStatus: () => get("/api/comfy/status"),
    // IPv6 cloud hosts
    vmOffers: () => get("/api/vm/offers"),
    vmInstances: () => get("/api/vm/instances"),
    vmOrder: (body) => post("/api/vm/orders", body),
    vmPublish: (body) => post("/api/vm/offers", body),
    vmSetOffer: (id, enabled) => put("/api/vm/offers/" + enc(id), { enabled }),
    vmDelOffer: (id) => del("/api/vm/offers/" + enc(id)),
    vmStop: (id) => post("/api/vm/instances/" + enc(id) + "/stop", {}),
    vmExtend: (id, hours) => post("/api/vm/instances/" + enc(id) + "/extend", { hours }),
    // community board
    // forumPosts 支持可选分页/搜索（limit/offset/q）；不传时与旧契约一致。
    forumPosts: (opts) => get("/api/forum/posts" + qsSuffix(opts)),
    forumPost: (id) => get("/api/forum/posts/" + enc(id)),
    createPost: (form) => uploadTo("/api/forum/posts", form),
    comment: (id, form) => uploadTo("/api/forum/posts/" + enc(id) + "/comments", form),
    mediaUrl: (id) => url("/api/forum/media/" + enc(id)),
    downloadUrl: (jobId, which) => url("/download/" + enc(jobId) + (which ? "?which=" + enc(which) : "")),
    launchScriptUrl: (path) => url(path)
  };
}

// shared/constants.js
var JOB_ST = {
  pending: "\u5F85\u8C03\u5EA6",
  leased: "\u5DF2\u6D3E\u53D1",
  fetching: "\u53D6\u6E90\u4E2D",
  running: "\u8F6C\u7801\u4E2D",
  uploading: "\u56DE\u4F20\u4E2D",
  merging: "\u5408\u6210\u4E2D",
  queued: "\u6392\u961F\u4E2D",
  done: "\u5B8C\u6210",
  failed: "\u5931\u8D25"
};
var VM_ST = {
  queued: "\u6392\u961F\u4E2D",
  provisioning: "\u542F\u52A8\u4E2D",
  running: "\u8FD0\u884C\u4E2D",
  unreachable: "\u5931\u8054",
  stopping: "\u505C\u673A\u4E2D",
  stopped: "\u5DF2\u505C\u673A",
  failed: "\u5931\u8D25"
};
var LEDGER_KIND = {
  hold: "\u9884\u6263",
  settle: "\u7ED3\u7B97",
  refund: "\u9000\u8FD8",
  earn: "\u6536\u76CA",
  recharge: "\u5145\u503C"
};
var CAP_NAMES = {
  tools: "\u5DE5\u5177\u8C03\u7528",
  json_object: "JSON \u8F93\u51FA",
  json_schema: "JSON Schema",
  regex: "\u6B63\u5219\u7EA6\u675F",
  vision: "\u56FE\u50CF\u8F93\u5165",
  reasoning: "\u63A8\u7406",
  deterministic: "\u786E\u5B9A\u6027",
  prefix_cache: "\u524D\u7F00\u7F13\u5B58"
};
var QUALITY = {
  fast: { vcodec: "libx264", preset: "ultrafast", q: "28" },
  balanced: { vcodec: "libx264", preset: "fast", q: "26" },
  high: { vcodec: "libx264", preset: "slow", q: "20" }
};
var INFLIGHT = ["fetching", "leased", "running", "uploading"];
var toneOf = (status) => status === "done" ? "ok" : status === "failed" ? "bad" : INFLIGHT.includes(status) || status === "running" ? "link" : status === "queued" || status === "pending" || status === "provisioning" ? "vio" : "mute";

// shared/format.js
var f1 = (v) => Number(v || 0).toFixed(1);
var f2 = (v) => Number(v || 0).toFixed(2);
var points = (v) => f2(v) + " \u70B9";
var ts = (sec) => sec ? new Date(sec * 1e3).toLocaleString("zh-CN", { hour12: false }) : "\u2014";
function relTime(t) {
  const d = Date.now() - t * 1e3;
  if (d < 6e4) return "\u521A\u521A";
  if (d < 36e5) return Math.floor(d / 6e4) + " \u5206\u949F\u524D";
  if (d < 864e5) return Math.floor(d / 36e5) + " \u5C0F\u65F6\u524D";
  if (d < 7 * 864e5) return Math.floor(d / 864e5) + " \u5929\u524D";
  return ts(t).slice(0, 10);
}
var hms = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`;
};
var ctxLabel = (n) => {
  if (!n) return "32K";
  if (n >= 1048576) return (n / 1048576).toFixed(n % 1048576 ? 2 : 0) + "M";
  if (n >= 1024) return Math.round(n / 1024) + "K";
  return String(n);
};
var memGB = (mb) => mb ? Math.round(mb / 1024 * 10) / 10 + "G" : "\u2014";
function fileSize(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}
function portsLabel(ports) {
  const list = (ports || []).map((p) => `${p.host_port || "\u81EA\u52A8"}:${p.guest_port}${p.proto === "udp" ? "/udp" : ""}`);
  return list.join(" \xB7 ") || "\u4EC5 SSH";
}
var shortId = (id, n = 10) => String(id || "").slice(0, n);

// shared/agent.js
var WEB_ROUTES = {
  nav: [
    ["\u6211\u7684\u4EFB\u52A1", "jobs"],
    ["\u4EFB\u52A1", "jobs"],
    ["\u94B1\u5305", "wallet"],
    ["\u8D26\u5355", "wallet"],
    ["\u5145\u503C", "wallet"],
    ["\u8BBA\u575B", "forum"],
    ["\u793E\u533A", "forum"],
    ["\u8BBE\u7F6E", "settings"],
    ["\u603B\u89C8", "home"],
    ["\u9996\u9875", "home"],
    ["\u4EEA\u8868\u76D8", "home"],
    ["\u7B97\u529B\u5E02\u573A", "pool"],
    ["\u7B97\u529B\u6C60", "pool"],
    ["\u6211\u7684\u8282\u70B9", "nodes"],
    ["\u8282\u70B9", "nodes"],
    ["\u673A\u5668", "nodes"],
    ["\u670D\u52A1\u5E02\u573A", "market"],
    ["\u5E02\u573A", "market"],
    ["\u6211\u7684\u53D1\u5E03", "sell"],
    ["\u53D1\u5E03", "sell"],
    ["\u6D88\u606F", "messages"],
    ["\u4F1A\u8BDD", "messages"],
    ["\u751F\u56FE", "image"],
    ["\u751F\u89C6\u9891", "video"],
    ["\u6E32\u67D3", "render"],
    ["\u8F6C\u7801", "render"],
    ["\u7F16\u6392", "build"],
    ["\u7F16\u8BD1", "build"],
    ["\u6A21\u578B", "api"],
    ["api", "api"],
    ["\u5BC6\u94A5", "api"],
    ["\u4E0A\u6E38", "api"]
  ],
  titles: {
    home: "\u603B\u89C8",
    image: "\u751F\u56FE",
    video: "\u751F\u89C6\u9891",
    render: "\u6E32\u67D3",
    build: "\u7F16\u6392",
    api: "\u6A21\u578B API",
    market: "\u670D\u52A1\u5E02\u573A",
    sell: "\u6211\u7684\u53D1\u5E03",
    messages: "\u6D88\u606F",
    nodes: "\u6211\u7684\u8282\u70B9",
    pool: "\u7B97\u529B\u5E02\u573A",
    jobs: "\u6211\u7684\u4EFB\u52A1",
    wallet: "\u94B1\u5305\u8D26\u5355",
    forum: "\u8BBA\u575B",
    settings: "\u8BBE\u7F6E"
  }
};
var MOBILE_ROUTES = {
  nav: [
    ["\u6211\u7684\u4EFB\u52A1", "jobs"],
    ["\u4EFB\u52A1", "jobs"],
    ["\u8D26\u5355", "bill"],
    ["\u94B1\u5305", "bill"],
    ["\u5145\u503C", "bill"],
    ["\u8BBA\u575B", "forum"],
    ["\u793E\u533A", "forum"],
    ["\u6211\u7684", "me"],
    ["\u8BBE\u7F6E", "me"],
    ["\u4E91\u4E3B\u673A", "vm"],
    ["\u865A\u62DF\u673A", "vm"],
    ["\u7B97\u529B\u5E02\u573A", "market"],
    ["\u5E02\u573A", "market"],
    ["\u7B97\u529B\u6C60", "market"],
    ["\u6211\u7684\u8282\u70B9", "nodes"],
    ["\u8282\u70B9", "nodes"],
    ["\u673A\u5668", "nodes"],
    ["\u6E32\u67D3", "render"],
    ["\u8F6C\u7801", "render"],
    ["\u7F16\u6392", "build"],
    ["\u7F16\u8BD1", "build"],
    ["\u6A21\u578B", "api"],
    ["api", "api"],
    ["\u5BC6\u94A5", "api"],
    ["\u4E0A\u6E38", "api"]
  ],
  titles: {
    render: "\u6E32\u67D3\u5DE5\u4F5C\u53F0",
    build: "\u4EFB\u52A1\u7F16\u6392",
    jobs: "\u6211\u7684\u4EFB\u52A1",
    market: "\u7B97\u529B\u5E02\u573A",
    vm: "\u4E91\u4E3B\u673A",
    nodes: "\u6211\u7684\u8282\u70B9",
    api: "\u6A21\u578B API",
    bill: "\u8D26\u5355\u4E0E\u6536\u76CA",
    forum: "\u8BBA\u575B",
    me: "\u4E2A\u4EBA\u4E2D\u5FC3"
  }
};
var MINIAPP_ROUTES = {
  nav: [
    ["\u63D0\u4EA4", "submit"],
    ["\u4EFB\u52A1", "jobs"],
    ["\u6211\u7684\u4EFB\u52A1", "jobs"],
    ["\u5E02\u573A", "market"],
    ["\u7B97\u529B\u5E02\u573A", "market"],
    ["\u8D26\u5355", "bill"],
    ["\u94B1\u5305", "bill"],
    ["\u5145\u503C", "bill"],
    ["\u6211\u7684", "me"],
    ["\u8BBE\u7F6E", "me"]
  ],
  titles: {
    submit: "\u63D0\u4EA4\u4EFB\u52A1",
    jobs: "\u6211\u7684\u4EFB\u52A1",
    market: "\u7B97\u529B\u5E02\u573A",
    bill: "\u8D26\u5355",
    me: "\u6211\u7684"
  }
};
var strip = (t, re) => t.replace(re, "").trim();
var cleanPrompt = (t, re) => strip(t, re).replace(/(的)?(图|图片|图像|视频)$/, "").trim() || t;
function parseIntent(raw, routes) {
  const r = routes || WEB_ROUTES;
  const t = String(raw || "").trim();
  if (!t) return { type: "chat", text: t };
  const s = t.toLowerCase();
  const has = (...ks) => ks.some((k) => s.includes(k));
  let m;
  if (has("\u5145\u503C", "\u5145\u70B9", "\u52A0\u70B9", "\u6DFB\u52A0\u7B97\u529B\u70B9")) {
    m = t.match(/(\d+(?:\.\d+)?)/);
    return { type: "recharge", amount: m ? +m[1] : 100 };
  }
  if (has("\u4F59\u989D", "\u8FD8\u5269", "\u591A\u5C11\u70B9", "\u591A\u5C11\u7B97\u529B", "\u67E5\u4F59\u989D", "\u67E5\u8BE2\u4F59\u989D")) return { type: "balance" };
  if (has("\u89C6\u9891") && has("\u751F\u6210", "\u505A", "\u521B\u4F5C", "\u5236\u4F5C", "\u62CD", "\u751F\u89C6\u9891")) {
    return { type: "video", prompt: cleanPrompt(t, /^(帮我|请|麻烦)?(生成|做|创作|制作|拍)(一?(段|个|条))?(视频)?[:：,，]?\s*/) };
  }
  if (has("\u56FE", "\u56FE\u7247", "\u56FE\u50CF") && has("\u751F\u6210", "\u753B", "\u7ED8\u5236", "\u521B\u4F5C", "\u51FA", "\u505A")) {
    return { type: "image", prompt: cleanPrompt(t, /^(帮我|请|麻烦)?(生成|画|绘制|创作|出|做)(一?(张|幅|个))?(图|图片|图像)?[:：,，]?\s*/) };
  }
  if (has("\u8F6C\u7801", "\u538B\u7F29\u89C6\u9891", "\u6E32\u67D3", "blender")) {
    return { type: "render", kind: has("blender", "\u6E32\u67D3") ? "blender" : "transcode" };
  }
  if (has("\u7F16\u8BD1", "\u6253\u5305", "\u7F16\u6392", "\u6784\u5EFA")) return { type: "build" };
  if (has("\u5E02\u573A", "\u6302\u724C", "\u670D\u52A1") && has("\u641C\u7D22", "\u641C", "\u627E", "\u7B5B\u9009")) {
    const kw = strip(t, /^.*(搜索|搜|找)/).replace(/(市场|服务|挂牌|里|中|的|一下)/g, "").trim();
    return { type: "marketSearch", q: kw };
  }
  if (has("\u79DF", "\u79DF\u7528", "\u79DF\u8D41") && has("\u4E91\u4E3B\u673A", "\u865A\u62DF\u673A", "\u4E3B\u673A", "vm") || has("\u4E91\u4E3B\u673A", "\u865A\u62DF\u673A") && has("\u79DF")) {
    return { type: "vmRent" };
  }
  if (has("\u53D1\u5E03", "\u4E0A\u67B6", "\u51FA\u552E", "\u5356") && has("\u670D\u52A1", "\u6302\u724C", "\u5546\u54C1")) {
    return { type: "sellPublish", title: strip(t, /^.*(发布|上架|出售|卖)(一个|个)?(服务|挂牌|商品)?[:：,，]?\s*/) };
  }
  if (has("\u53D1\u5E16", "\u53D1\u5E16\u5B50", "\u53D1\u5E03\u5E16\u5B50", "\u8BBA\u575B\u53D1", "\u53D1\u4E00\u4E2A\u5E16")) {
    return { type: "forumPost", title: strip(t, /^.*(发帖|发帖子|发布帖子|发一个帖|论坛发)(子)?[:：,，]?\s*/) };
  }
  if (has("\u521B\u5EFA", "\u65B0\u5EFA", "\u751F\u6210") && has("api key", "apikey", "\u5BC6\u94A5", "key")) {
    return { type: "createKey", name: strip(t, /^.*(创建|新建|生成)(一个|个)?(api ?key|密钥|key)?[:：,，]?\s*/) };
  }
  if (has("\u4EFB\u52A1") && has("\u72B6\u6001", "\u600E\u4E48\u6837", "\u8FDB\u5EA6", "\u6709\u54EA\u4E9B", "\u5217\u8868", "\u67E5\u770B", "\u770B\u770B", "\u8FD0\u884C", "\u8FDB\u884C\u4E2D")) return { type: "tasks" };
  if (has("\u8282\u70B9", "\u673A\u5668") && has("\u5728\u7EBF", "\u72B6\u6001", "\u600E\u4E48\u6837", "\u6536\u76CA", "\u5217\u8868", "\u67E5\u770B", "\u770B\u770B") || has("\u6211\u7684\u8282\u70B9")) return { type: "nodes" };
  if (has("\u6253\u5F00", "\u8FDB\u5165", "\u8DF3\u8F6C", "\u5207\u6362\u5230", "\u53BB", "\u5230", "\u770B\u770B", "\u67E5\u770B", "\u901B")) {
    for (const [kw, view] of r.nav) if (s.includes(kw)) return { type: "nav", view, tab: view === "market" && has("\u4E91\u4E3B\u673A", "\u865A\u62DF\u673A") ? "vm" : null };
  }
  for (const [kw, view] of r.nav) if (s === kw || s === kw + "\u9875" || s === "\u53BB" + kw) return { type: "nav", view, tab: null };
  return { type: "chat", text: t };
}
