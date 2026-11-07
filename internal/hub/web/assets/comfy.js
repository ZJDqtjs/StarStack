/* 生图 / 生视频 · ComfyUI 工作台
 * ---------------------------------------------------------------------------
 * 与 ComfyUI 官方前端保持一致的约定（参考 ComfyUI server.py / litegraph）：
 *   - 工作流文件为 UI 格式 JSON：{nodes, links:[[id,from,slot,to,slot,type]],...}
 *   - 提交执行时转成 API 格式：{"<id>":{class_type,inputs,_meta}}，POST /prompt
 *   - /object_info 决定节点的输入/输出与控件，/ws 推送 executing/progress/executed
 *   - /upload/image、/view、/history、/queue、/interrupt 与官方同路径
 * 平台把这些官方路由挂在 /comfyui/api/ 下（Go 反向代理），工作流部署与预设
 * 存在 /api/comfy/workflows。未连接 ComfyUI 时自动退回内置节点库，仍可编辑、
 * 导入、导出与部署，方便离线调图。
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ 基础 */
  const ROOT = (function () {
    try {
      const s = document.currentScript && document.currentScript.src;
      if (s) return new URL('../', s).pathname.replace(/\/$/, '');
    } catch (e) { /* file:// preview */ }
    return (location.pathname.match(/^(\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)\/[^/]*$/) || ['', ''])[1];
  })();
  const API = p => ROOT + '/api/comfy/' + p;
  const CF = p => ROOT + '/comfyui/api/' + p;
  // 主控制台会重写 window.fetch 给绝对路径加 BASE 前缀；本脚本在它之前加载，
  // 这里保留原生 fetch，避免带 ROOT 的 URL 被二次加前缀（子路径部署场景）。
  const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const $ = s => document.querySelector(s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const CONTROL = ['fixed', 'increment', 'decrement', 'randomize'];
  const WIDGET_TYPES = { INT: 1, FLOAT: 1, STRING: 1, BOOLEAN: 1 };
  // UI-only 节点（注释 / 标签 / 连线中转）不会被官方 graphToPrompt 提交。
  const isNoteType = t => /note|label/i.test(String(t));
  const isPassType = t => /^(Reroute|SetNode|GetNode)$/i.test(String(t));
  const isOutputType = t => /save|preview|output|combine|export|view|display/i.test(String(t));
  const TYPE_COLOR = {
    MODEL: '#b39ddb', CLIP: '#ffd54f', VAE: '#ff8a65', LATENT: '#ce93d8',
    IMAGE: '#64b5f6', MASK: '#80cbc4', CONDITIONING: '#ffab91', CONTROL_NET: '#a5d6a7',
    SAMPLER: '#90caf9', SIGMAS: '#b0bec5', NOISE: '#80deea', GUIDER: '#f48fb1',
    VIDEO: '#4dd0e1', AUDIO: '#ffe082', INT: '#90a4ae', FLOAT: '#90a4ae',
    STRING: '#a5d6a7', BOOLEAN: '#ef9a9a', '*': '#cfd8dc'
  };
  const CAT_COLOR = {
    loaders: '#3f5170', conditioning: '#5a3f66', latent: '#3f5f52',
    sampling: '#6b4a3a', image: '#2f5670', video: '#5b3d63',
    utils: '#4a4a55', imported: '#555560'
  };
  const colorOf = t => TYPE_COLOR[t] || (() => {
    let n = 0; for (const c of String(t)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
    const p = ['#8c9eff', '#80cbc4', '#f48fb1', '#ffd54f', '#a5d6a7', '#b39ddb', '#90caf9', '#ffcc80'];
    return p[n % p.length];
  })();

  async function apiJSON(url, options) {
    const doFetch = nativeFetch || fetch;
    const r = await doFetch(url, options);
    const text = await r.text();
    let data = null; try { data = JSON.parse(text); } catch (e) { /* non JSON */ }
    if (!r.ok) throw new Error((data && data.error) || text || ('HTTP ' + r.status));
    return data;
  }
  const postJSON = (url, body) => apiJSON(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function safeName(s) { return String(s || 'workflow').replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 60); }

  /* -------------------------------------------------------- 离线节点定义库 */
  /* 与 /object_info 返回的形状一致：input.required / optional、output、category。
     连上 ComfyUI 后会被 /object_info 的真实定义覆盖（含模型列表与自定义节点）。 */
  const I = (d, min, max, step, control) => ['INT', Object.assign({ default: d, min: min == null ? 0 : min, max: max == null ? 4294967295 : max, step: step == null ? 1 : step }, control ? { control_after_generate: true } : {})];
  const F = (d, min, max, step) => ['FLOAT', { default: d, min: min == null ? 0 : min, max: max == null ? 1e9 : max, step: step == null ? 0.01 : step }];
  const S = (d, multi) => ['STRING', { default: d || '', multiline: !!multi }];
  const B = d => ['BOOLEAN', { default: !!d }];
  const C = (list, d) => [list, { default: d == null ? list[0] : d }];
  const T = t => [t];
  function def(cat, req, opt, out, flags) {
    flags = flags || {};
    return {
      input: { required: req || {}, optional: opt || {} },
      output: out || [], output_name: out || [], category: cat,
      output_node: !!flags.out, display_name: flags.name || undefined,
      description: flags.desc || ''
    };
  }
  const SAMPLERS = ['euler', 'euler_ancestral', 'heun', 'dpm_2', 'dpmpp_2m', 'dpmpp_sde', 'ddim', 'uni_pc', 'lcm'];
  const SCHEDULERS = ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform'];
  const UPSCALE = ['nearest-exact', 'bilinear', 'area', 'bicubic', 'bislerp', 'lanczos'];

  const CATALOG = {
    CheckpointLoaderSimple: def('loaders', { ckpt_name: C(['v1-5-pruned-emaonly.safetensors', 'sd_xl_base_1.0.safetensors', 'flux1-dev.safetensors']) }, null, ['MODEL', 'CLIP', 'VAE']),
    VAELoader: def('loaders', { vae_name: C(['vae-ft-mse-840000-ema-pruned.safetensors', 'sdxl_vae.safetensors', 'minimax_h3_video_vae_fp16.safetensors']) }, null, ['VAE']),
    LoraLoader: def('loaders', { model: T('MODEL'), clip: T('CLIP'), lora_name: C(['<无>']), strength_model: F(1, -10, 10), strength_clip: F(1, -10, 10) }, null, ['MODEL', 'CLIP']),
    CLIPLoader: def('loaders', { clip_name: C(['clip_l.safetensors', 't5xxl_fp16.safetensors', 'umt5_xxl_fp8_e4m3fn_scaled.safetensors']), type: C(['stable_diffusion', 'sdxl', 'flux', 'hunyuan_video', 'wan']) }, null, ['CLIP']),
    UNETLoader: def('loaders', { unet_name: C(['wan2.1_t2v_1.3B_fp16.safetensors', 'hunyuan_video_t2v_720p_fp8_e4m3fn.safetensors']), weight_dtype: C(['default', 'fp8_e4m3fn', 'fp8_e5m2']) }, null, ['MODEL']),
    ControlNetLoader: def('loaders', { control_net_name: C(['<无>']) }, null, ['CONTROL_NET']),
    LoadImage: def('image', { image: C(['example.png']) }, null, ['IMAGE', 'MASK']),
    LoadLatent: def('latent', { latent: C(['empty.latent']) }, null, ['LATENT']),
    CLIPTextEncode: def('conditioning', { text: S('', true), clip: T('CLIP') }, null, ['CONDITIONING'], { name: 'CLIP Text Encode (Prompt)' }),
    ConditioningCombine: def('conditioning', { conditioning_1: T('CONDITIONING'), conditioning_2: T('CONDITIONING') }, null, ['CONDITIONING']),
    ConditioningAverage: def('conditioning', { conditioning_to: T('CONDITIONING'), conditioning_from: T('CONDITIONING'), conditioning_to_strength: F(1, 0, 1) }, null, ['CONDITIONING']),
    ControlNetApply: def('conditioning', { conditioning: T('CONDITIONING'), control_net: T('CONTROL_NET'), image: T('IMAGE'), strength: F(1, 0, 10) }, null, ['CONDITIONING']),
    FluxGuidance: def('conditioning', { conditioning: T('CONDITIONING'), guidance: F(3.5, 0, 100, 0.1) }, null, ['CONDITIONING']),
    EmptyLatentImage: def('latent', { width: I(512, 16, 16384, 8), height: I(512, 16, 16384, 8), batch_size: I(1, 1, 4096) }, null, ['LATENT']),
    EmptyHunyuanLatentVideo: def('latent', { width: I(848, 16, 16384, 16), height: I(480, 16, 16384, 16), length: I(49, 1, 4096, 4), batch_size: I(1, 1, 64) }, null, ['LATENT']),
    VAEEncode: def('latent', { pixels: T('IMAGE'), vae: T('VAE') }, null, ['LATENT']),
    VAEDecode: def('latent', { samples: T('LATENT'), vae: T('VAE') }, null, ['IMAGE']),
    VAEDecodeTiled: def('latent', { samples: T('LATENT'), vae: T('VAE'), tile_size: I(512, 64, 4096, 32) }, null, ['IMAGE']),
    LatentUpscale: def('latent', { samples: T('LATENT'), upscale_method: C(UPSCALE), width: I(1024, 16, 16384, 8), height: I(1024, 16, 16384, 8), crop: C(['disabled', 'center']) }, null, ['LATENT']),
    LatentUpscaleBy: def('latent', { samples: T('LATENT'), upscale_method: C(UPSCALE), scale_by: F(1.5, 0.01, 8) }, null, ['LATENT']),
    KSampler: def('sampling', {
      model: T('MODEL'), seed: I(0, 0, 4294967295, 1, true), steps: I(20, 1, 10000),
      cfg: F(8, 0, 100, 0.1), sampler_name: C(SAMPLERS), scheduler: C(SCHEDULERS),
      positive: T('CONDITIONING'), negative: T('CONDITIONING'), latent_image: T('LATENT'), denoise: F(1, 0, 1)
    }, null, ['LATENT']),
    KSamplerAdvanced: def('sampling', {
      model: T('MODEL'), add_noise: C(['enable', 'disable']), noise_seed: I(0, 0, 4294967295, 1, true),
      steps: I(20, 1, 10000), cfg: F(8, 0, 100, 0.1), sampler_name: C(SAMPLERS), scheduler: C(SCHEDULERS),
      positive: T('CONDITIONING'), negative: T('CONDITIONING'), latent_image: T('LATENT'),
      start_at_step: I(0, 0, 10000), end_at_step: I(10000, 0, 10000), return_with_leftover_noise: C(['disable', 'enable'])
    }, null, ['LATENT']),
    KSamplerSelect: def('sampling', { sampler_name: C(SAMPLERS) }, null, ['SAMPLER']),
    BasicScheduler: def('sampling', { model: T('MODEL'), scheduler: C(SCHEDULERS), steps: I(20, 1, 10000), denoise: F(1, 0, 1) }, null, ['SIGMAS']),
    BasicGuider: def('sampling', { model: T('MODEL'), conditioning: T('CONDITIONING') }, null, ['GUIDER']),
    RandomNoise: def('sampling', { noise_seed: I(0, 0, 4294967295, 1, true) }, null, ['NOISE']),
    SamplerCustomAdvanced: def('sampling', { noise: T('NOISE'), guider: T('GUIDER'), sampler: T('SAMPLER'), sigmas: T('SIGMAS'), latent_image: T('LATENT') }, null, ['LATENT', 'LATENT']),
    SaveImage: def('image', { images: T('IMAGE'), filename_prefix: S('StarStack/Image') }, null, [], { out: true }),
    PreviewImage: def('image', { images: T('IMAGE') }, null, [], { out: true }),
    ImageScale: def('image', { image: T('IMAGE'), upscale_method: C(UPSCALE), width: I(1024, 16, 16384, 8), height: I(1024, 16, 16384, 8), crop: C(['disabled', 'center']) }, null, ['IMAGE']),
    ImageInvert: def('image', { image: T('IMAGE') }, null, ['IMAGE']),
    ImageUpscaleWithModel: def('image', { upscale_model: T('UPSCALE_MODEL'), image: T('IMAGE') }, null, ['IMAGE']),
    UpscaleModelLoader: def('loaders', { model_name: C(['RealESRGAN_x4.pth']) }, null, ['UPSCALE_MODEL']),
    SaveAnimatedWEBP: def('video', { images: T('IMAGE'), filename_prefix: S('StarStack/Video'), fps: F(8, 1, 120, 0.1), lossless: B(false), quality: I(80, 0, 100), method: C(['default', 'fastest', 'slowest']) }, null, [], { out: true }),
    SaveAnimatedPNG: def('video', { images: T('IMAGE'), filename_prefix: S('StarStack/Video'), fps: F(8, 1, 120, 0.1), compress_level: I(4, 0, 9) }, null, [], { out: true }),
    CreateVideo: def('video', { images: T('IMAGE'), fps: F(24, 1, 120, 0.1) }, null, ['VIDEO']),
    SaveVideo: def('video', { video: T('VIDEO'), filename_prefix: S('StarStack/Video'), format: C(['auto', 'mp4', 'webm']), codec: C(['auto', 'h264', 'h265', 'vp9']) }, null, [], { out: true }),
    VHS_VideoCombine: def('video', { images: T('IMAGE'), frame_rate: F(8, 1, 120, 0.1), loop_count: I(0, 0, 1000), filename_prefix: S('StarStack/Video'), format: C(['image/gif', 'image/webp', 'video/h264-mp4', 'video/h265-mp4']), pingpong: B(false), save_output: B(true) }, { audio: T('AUDIO') }, ['GIF'], { out: true }),
    VHS_LoadVideo: def('video', { video: C(['example.mp4']), force_rate: F(0, 0, 120, 0.1), force_size: C(['Disabled', 'Custom Width x Height']), custom_width: I(512, 0, 8192, 8), custom_height: I(512, 0, 8192, 8) }, null, ['IMAGE', 'INT', 'AUDIO']),
    ResolutionSelector: def('utils', { aspect_ratio: C(['16:9 (Widescreen)', '1:1 (Square)', '9:16 (Portrait)', '4:3']), megapixels: F(0.2, 0.01, 8), multiple: I(32, 1, 512, 8) }, null, ['INT', 'INT']),
    Note: def('utils', { text: S('') }, null, []),
    PrimitiveNode: def('utils', { value: S(''), control_after_generate: C(CONTROL) }, null, ['*']),
    Reroute: def('utils', {}, { input: T('*') }, ['*'])
  };

  /* -------------------------------------------------------------- 全局状态 */
  const W = {
    defs: {}, inferred: new Set(), tabs: [], active: -1, kindGraph: { image: null, video: null },
    root: null, built: false, online: false, remote: false, status: {},
    clientId: 'starstack-' + uid(), ws: null, wsRetry: null,
    library: [], sideTab: 'nodes', wfScope: 'template',
    cardTab: { image: 'template', video: 'template' },
    view: { x: 60, y: 40, scale: 1 }, selection: new Set(), selectedLink: null,
    clipboard: null, drag: null, linkDrag: null, panning: false, space: false,
    queue: [], outputs: [], progress: { value: 0, max: 0 }, runningNode: null,
    queueRemaining: 0, toastTimer: null, objInfoLoaded: false,
    settings: { snap: false, showGrid: true }, cardFiles: {}
  };

  /* ------------------------------------------------------------ 图数据结构 */
  function emptyGraph() {
    return { version: 0.4, last_node_id: 0, last_link_id: 0, nodes: [], links: [], groups: [], config: {}, extra: {} };
  }
  function getDef(type) {
    if (W.defs[type]) return W.defs[type];
    if (CATALOG[type]) return CATALOG[type];
    return null;
  }
  function defFromUINode(n) {
    const req = {}, out = [];
    for (const i of (n.inputs || [])) if (i.name && !i.widget) req[i.name] = T(i.type || '*');
    for (const o of (n.outputs || [])) out.push(o.type || '*');
    return def('imported', req, null, out, { out: isOutputType(n.type) && !isNoteType(n.type) });
  }
  function slotsFor(type, seedDef) {
    const d = seedDef || getDef(type) || def('imported', {}, null, []);
    const req = (d.input && d.input.required) || {}, opt = (d.input && d.input.optional) || {};
    const inputs = [], widgets = [];
    for (const name of [...Object.keys(req), ...Object.keys(opt)]) {
      const spec = req[name] || opt[name] || [];
      const t = spec[0], opts = spec[1] || {};
      if (Array.isArray(t)) {
        widgets.push({ name, type: 'COMBO', value: opts.default == null ? t[0] : opts.default, options: t.slice(), opts: opts || {}, link: null });
      } else if (WIDGET_TYPES[t]) {
        const w = { name, type: t, value: opts.default == null ? (t === 'BOOLEAN' ? false : t === 'STRING' ? '' : 0) : opts.default, opts: opts || {}, link: null };
        if (opts.control_after_generate || (/seed$/i.test(name) && t === 'INT')) w.control = 'randomize';
        widgets.push(w);
      } else {
        inputs.push({ name, type: t || '*', link: null, optional: Object.prototype.hasOwnProperty.call(opt, name) });
      }
    }
    const outputs = (d.output || []).map((t, i) => ({
      name: (d.output_name && d.output_name[i]) || String(t), type: String(t), links: []
    }));
    return { inputs, widgets, outputs, def: d };
  }
  function makeNode(type, id, pos, values, defOverride) {
    if (!getDef(type) && !defOverride) W.defs[type] = def('imported', {}, null, []);
    const s = slotsFor(type, defOverride);
    const n = {
      id: id == null ? ++W._tmpId : id, type, pos: pos || [0, 0], size: [220, 100],
      mode: 0, collapsed: false, title: (s.def && s.def.display_name) || type,
      color: '#232', bgcolor: '#353', inputs: s.inputs, outputs: s.outputs, widgets: s.widgets
    };
    for (const w of n.widgets) if (values && Object.prototype.hasOwnProperty.call(values, w.name)) w.value = values[w.name];
    if (/CLIPTextEncode|Note/.test(type)) n.size = [270, 160];
    return n;
  }
  W._tmpId = 0;
  function nextNodeId(g) { return ++g.last_node_id; }
  function nextLinkId(g) { return ++g.last_link_id; }

  /* UI 格式 -> 内部图。保留官方 widgets_values / inputs / links 的顺序语义。 */
  function fromUI(raw, name) {
    const base = (raw && raw.workflow) ? raw.workflow : raw;
    if (!base || !Array.isArray(base.nodes)) throw new Error('缺少 nodes 数组，不是 ComfyUI 工作流');
    const g = emptyGraph();
    g.extra = clone(base.extra || {}); g.config = clone(base.config || {});
    g.groups = clone(base.groups || []);
    const rawLinks = Array.isArray(base.links) ? base.links : [];
    const slotMaps = new Map();
    for (const rn of base.nodes) {
      // 未在 /object_info 与内置库里出现的节点：按该节点自身的 inputs/outputs
      // 逐节点推断定义，避免同类型不同实例共用第一份定义而丢输入。
      const canonical = !!CATALOG[rn.type] || (!!W.defs[rn.type] && !W.inferred.has(rn.type));
      let override = null;
      if (!canonical) {
        override = defFromUINode(rn);
        W.defs[rn.type] = override; W.inferred.add(rn.type);
      }
      const id = Number(rn.id);
      W._tmpId = Math.max(W._tmpId, id || 0);
      const n = makeNode(rn.type, id, rn.pos || [0, 0], null, override);
      n.size = Array.isArray(rn.size) ? rn.size.slice() : n.size;
      n.mode = Number(rn.mode) || 0;
      n.collapsed = !!(rn.flags && rn.flags.collapsed);
      n.title = (rn.properties && rn.properties['Node name for S&R']) || rn.title || (getDef(rn.type) || {}).display_name || rn.type;
      n.color = rn.color || n.color; n.bgcolor = rn.bgcolor || n.bgcolor;
      const wv = Array.isArray(rn.widgets_values) ? rn.widgets_values.slice() : [];
      // 自定义节点离线时无法把 widgets_values 映射成具名控件，保留原值以便
      // 导出回官方 UI 时字节级不丢失（连上 /object_info 后会正确解析）。
      n.rawWidgetsValues = wv;
      let k = 0;
      for (const w of n.widgets) {
        if (k >= wv.length) break;
        w.value = wv[k++];
        if (w.control && k < wv.length && typeof wv[k] === 'string' && CONTROL.indexOf(wv[k]) >= 0) w.control = wv[k++];
      }
      // 官方 node.inputs 里既有连线输入，也有「控件转输入」的项；链接槽位下标
      // 指向这个数组，所以在此建立精确映射。
      const map = (rn.inputs || []).map(inp => ({ name: inp.name, widget: !!inp.widget, type: inp.type || '*' }));
      if (!map.length) map.push(...n.inputs.map(i => ({ name: i.name, widget: false, type: i.type })));
      for (const m of map) {
        if (n.inputs.some(i => i.name === m.name) || n.widgets.some(w => w.name === m.name)) continue;
        n.inputs.push({ name: m.name, type: m.type, link: null, widget: !!m.widget });
      }
      slotMaps.set(n.id, map);
      // 输出槽位也按官方文件补齐，避免自定义节点输出类型被推断为 '*'
      (rn.outputs || []).forEach((o, i) => {
        if (!n.outputs[i]) n.outputs[i] = { name: o.name || ('output' + i), type: o.type || '*', links: [] };
        else n.outputs[i].name = o.name || n.outputs[i].name;
      });
      g.nodes.push(n);
      g.last_node_id = Math.max(g.last_node_id, n.id);
    }
    for (const l of rawLinks) {
      const id = Number(l[0]), origin = Number(l[1]), originSlot = Number(l[2]),
        target = Number(l[3]), targetSlot = Number(l[4]), type = String(l[5] || '*');
      const tn = g.nodes.find(n => n.id === target), on = g.nodes.find(n => n.id === origin);
      if (!tn || !on) continue;
      const m = (slotMaps.get(target) || [])[targetSlot];
      if (!m) continue;
      let input = tn.inputs.find(i => i.name === m.name);
      const widget = tn.widgets.find(x => x.name === m.name);
      if (!input && widget) { input = { name: m.name, type: m.type, link: null, widget: true }; tn.inputs.push(input); }
      if (!input) continue;
      const link = { id, origin, originSlot, target, targetSlot: targetSlotFor(tn, m.name), type };
      input.link = link.id;
      if (widget) widget.link = link.id;
      if (on.outputs[originSlot]) on.outputs[originSlot].links.push(link.id);
      g.links.push(link);
      g.last_link_id = Math.max(g.last_link_id, id);
    }
    g.name = name || '导入的工作流';
    return g;
  }
  function targetSlotFor(n, name) {
    const idx = n.inputs.findIndex(i => i.name === name);
    if (idx >= 0) return idx;
    const wi = n.widgets.findIndex(w => w.name === name);
    return wi >= 0 ? n.inputs.length + wi : 0;
  }

  /* API 格式 -> 内部图（自动按依赖分层排版） */
  function fromAPI(raw, name) {
    const entries = Object.entries(raw || {}).filter(([, v]) => v && typeof v === 'object' && v.class_type);
    if (!entries.length) throw new Error('缺少 class_type，不是 ComfyUI API 格式工作流');
    const specs = new Map(), perNodeDef = new Map();
    const infer = v => {
      if (typeof v === 'boolean') return ['BOOLEAN', { default: v }];
      if (typeof v === 'number') return Number.isInteger(v)
        ? ['INT', { default: v, min: 0, max: 4294967295, step: 1 }]
        : ['FLOAT', { default: v, min: 0, max: 1e9, step: 0.01 }];
      return ['STRING', { default: String(v), multiline: String(v).length > 60 }];
    };
    for (const [id, spec] of entries) {
      const base = getDef(spec.class_type);
      const req = Object.assign({}, (base && base.input && base.input.required) || {});
      for (const [key, v] of Object.entries(spec.inputs || {})) {
        const isLink = Array.isArray(v) && v.length === 2 && Number.isInteger(v[1]);
        if (!req[key]) req[key] = isLink ? T('*') : infer(v);
      }
      const d = base
        ? {
          input: { required: req, optional: (base.input && base.input.optional) || {} },
          output: base.output || [], output_name: base.output_name || [],
          category: base.category, output_node: !!base.output_node, display_name: base.display_name
        }
        : def('imported', req, null, [], { out: false });
      if (!base) { W.defs[spec.class_type] = d; W.inferred.add(spec.class_type); }
      specs.set(String(id), spec);
      perNodeDef.set(String(id), d);
    }
    const g = emptyGraph();
    for (const [id, spec] of entries) {
      const vals = {};
      for (const [k, v] of Object.entries(spec.inputs || {})) {
        if (!(Array.isArray(v) && v.length === 2 && Number.isInteger(v[1]))) vals[k] = v;
      }
      const n = makeNode(spec.class_type, Number(id) || (g.last_node_id + 1), [0, 0], vals, perNodeDef.get(String(id)));
      n.title = (spec._meta && spec._meta.title) || n.title;
      g.nodes.push(n); g.last_node_id = Math.max(g.last_node_id, n.id);
    }
    // 依赖层级：被引用最多、无出边的排最右
    const refs = new Map();
    for (const [id, spec] of entries) for (const v of Object.values(spec.inputs || {})) {
      if (Array.isArray(v) && v.length === 2 && Number.isInteger(v[1])) refs.set(String(v[0]), (refs.get(String(v[0])) || 0) + 1);
    }
    const depth = new Map();
    const calc = (id, seen) => {
      if (depth.has(id)) return depth.get(id);
      if (seen.has(id)) return 0;
      seen.add(id);
      const spec = specs.get(id); let d = 0;
      for (const v of Object.values((spec && spec.inputs) || {})) {
        if (Array.isArray(v) && v.length === 2 && Number.isInteger(v[1])) d = Math.max(d, calc(String(v[0]), seen) + 1);
      }
      depth.set(id, d); return d;
    };
    for (const id of specs.keys()) calc(id, new Set());
    const rows = new Map();
    for (const n of g.nodes) {
      const d = depth.get(String(n.id)) || 0, r = rows.get(d) || 0; rows.set(d, r + 1);
      n.pos = [60 + d * 300, 60 + r * 210];
      if (!refs.has(String(n.id))) n.pos[0] += 60;
    }
    // 连线
    for (const [id, spec] of entries) {
      const tn = g.nodes.find(n => String(n.id) === id);
      if (!tn) continue;
      for (const [key, v] of Object.entries(spec.inputs || {})) {
        if (!(Array.isArray(v) && v.length === 2 && Number.isInteger(v[1]))) continue;
        const on = g.nodes.find(n => String(n.id) === String(v[0]));
        if (!on) continue;
        const outSlot = Number(v[1]) || 0;
        if (!on.outputs[outSlot]) on.outputs.push({ name: 'output' + outSlot, type: '*', links: [] });
        let input = tn.inputs.find(i => i.name === key && !i.widget);
        const widget = tn.widgets.find(x => x.name === key);
        if (!input && widget) { input = { name: key, type: widget.type, link: null, widget: true }; tn.inputs.push(input); }
        if (!input) { input = { name: key, type: '*', link: null }; tn.inputs.push(input); }
        const link = { id: nextLinkId(g), origin: on.id, originSlot: outSlot, target: tn.id, targetSlot: targetSlotFor(tn, key), type: on.outputs[outSlot].type };
        input.link = link.id; if (widget) widget.link = link.id;
        on.outputs[outSlot].links.push(link.id);
        g.links.push(link);
      }
    }
    // API 格式本身就是官方执行后的 prompt，所有节点都要提交，不能再按
    // 输出节点做闭包裁剪，否则会丢掉独立分支。
    g.apiDirect = true;
    g.name = name || 'API 工作流';
    return g;
  }

  function toUI(g) {
    return {
      id: uid(), revision: 0, last_node_id: g.last_node_id, last_link_id: g.last_link_id,
      nodes: g.nodes.map((n, order) => {
        // node.inputs 的顺序就是 links[][4] 的槽位下标，必须原样保留；
        // 「控件转输入」的项带 widget 字段，与官方导出的 UI 格式一致。
        const inputs = n.inputs.map(i => {
          const o = { name: i.name, type: i.type, link: i.link, label: i.name };
          if (i.widget) o.widget = { name: i.name };
          return o;
        });
        let widgets_values = [];
        for (const w of n.widgets) {
          widgets_values.push(w.value);
          if (w.control) widgets_values.push(w.control);
        }
        if (!n.widgets.length && n.rawWidgetsValues && n.rawWidgetsValues.length) widgets_values = n.rawWidgetsValues.slice();
        return {
          id: n.id, type: n.type, pos: n.pos.slice(), size: n.size.slice(),
          flags: { collapsed: !!n.collapsed }, order, mode: n.mode || 0,
          inputs, outputs: n.outputs.map(o => ({ name: o.name, type: o.type, links: o.links.slice(), label: o.name })),
          properties: { 'Node name for S&R': n.title || n.type },
          widgets_values, color: n.color, bgcolor: n.bgcolor
        };
      }),
      links: g.links.map(l => [l.id, l.origin, l.originSlot, l.target, l.targetSlot, l.type]),
      groups: g.groups || [], config: g.config || {}, extra: g.extra || {}, version: 0.4
    };
  }

  /* 与官方 app.graphToPrompt() 等价：只提交输出节点的依赖闭包，
     跳过静音(mode 2)节点，绕过(mode 4)节点把上游输出透传给下游。 */
  function toAPI(g) {
    const byId = new Map(g.nodes.map(n => [n.id, n]));
    const byLink = new Map(g.links.map(l => [l.id, l]));
    const linkRef = (id, depth) => {
      const l = byLink.get(id); if (!l || depth > 8) return null;
      const o = byId.get(l.origin); if (!o) return null;
      // 绕过节点、Reroute / rgthree SetNode-GetNode 这类虚拟中转节点：
      // 官方前端会把它们解析成上游的真实输出，这里做同样的透传。
      if (o.mode === 4 || isPassType(o.type) || isNoteType(o.type)) {
        const pass = o.inputs.find(i => i.link && i.type === l.type) || o.inputs.find(i => i.link) ||
          o.widgets.filter(w => w.link != null).map(w => ({ link: w.link }))[0];
        if (pass && pass.link != null) return linkRef(pass.link, depth + 1);
        return null;
      }
      return [String(o.id), l.originSlot];
    };
    const used = new Set();
    const walk = id => {
      if (used.has(id)) return; used.add(id);
      const n = byId.get(id); if (!n) return;
      for (const i of n.inputs) if (i.link != null && byLink.has(i.link)) walk(byLink.get(i.link).origin);
      for (const w of n.widgets) if (w.link != null && byLink.has(w.link)) walk(byLink.get(w.link).origin);
    };
    // 官方只提交输出节点（SaveImage / PreviewImage / 自定义输出节点）的依赖闭包；
    // 图里没有声明输出节点时退化为「无出边节点」，避免把孤立节点也塞进 prompt。
    const isRoot = n => {
      const d = getDef(n.type);
      return (d && d.output_node) || (!isNoteType(n.type) && isOutputType(n.type));
    };
    const hasOut = g.nodes.some(n => !isNoteType(n.type) && isRoot(n));
    for (const n of g.nodes) {
      if (n.mode === 2 || isNoteType(n.type)) continue;
      const root = g.apiDirect ? true : (hasOut ? isRoot(n) : !g.links.some(l => l.origin === n.id));
      if (root) walk(n.id);
    }
    const prompt = {};
    for (const id of used) {
      const n = byId.get(id);
      if (!n || n.mode === 2 || n.mode === 4 || isNoteType(n.type) || isPassType(n.type)) continue;
      const inputs = {};
      for (const i of n.inputs) if (i.link != null) { const r = linkRef(i.link, 0); if (r) inputs[i.name] = r; }
      for (const w of n.widgets) {
        if (w.link != null) { const r = linkRef(w.link, 0); if (r) inputs[w.name] = r; }
        else inputs[w.name] = w.value;
      }
      prompt[String(n.id)] = { class_type: n.type, inputs, _meta: { title: n.title || n.type } };
    }
    return prompt;
  }

  function validateGraph(g) {
    const missing = [], errors = [];
    for (const n of g.nodes) {
      if (!CATALOG[n.type] && !W.defs[n.type]) missing.push(n.type);
      for (const i of n.inputs) {
        if (i.link == null && !i.widget && !i.optional && i.type !== '*' && !isNoteType(n.type))
          errors.push({ node: n.id, msg: '输入 ' + i.name + ' 未连接' });
      }
    }
    return { missing: [...new Set(missing)], errors };
  }

  /* ------------------------------------------------------------ 内置模板 */
  function buildTemplate(spec) {
    const g = emptyGraph();
    for (const s of spec.nodes) {
      const n = makeNode(s.type, s.id, s.pos, s.values || {});
      n.title = s.title || n.title;
      g.nodes.push(n); g.last_node_id = Math.max(g.last_node_id, n.id);
    }
    for (const l of spec.links) {
      const [from, outName, to, inName] = l;
      const on = g.nodes.find(n => n.id === from), tn = g.nodes.find(n => n.id === to);
      if (!on || !tn) continue;
      const os = typeof outName === 'number' ? outName : on.outputs.findIndex(o => o.name === outName || o.type === outName);
      let input = tn.inputs.find(i => i.name === inName);
      const widget = tn.widgets.find(w => w.name === inName);
      if (!input && widget) { input = { name: inName, type: widget.type, link: null, widget: true }; tn.inputs.push(input); }
      if (!input || os < 0) continue;
      const link = { id: nextLinkId(g), origin: from, originSlot: os, target: to, targetSlot: targetSlotFor(tn, inName), type: (on.outputs[os] || {}).type || '*' };
      input.link = link.id; if (widget) widget.link = link.id;
      if (on.outputs[os]) on.outputs[os].links.push(link.id);
      g.links.push(link);
    }
    g.name = spec.name; g.builtin = spec.id;
    return g;
  }
  function sdSpec(id, name, kind, overrides) {
    const o = overrides || {};
    const nodes = [
      { id: 1, type: 'CheckpointLoaderSimple', pos: [40, 420] },
      { id: 2, type: 'CLIPTextEncode', pos: [350, 60], title: '正向提示词', values: { text: 'a cinematic photo of a neon city at night, ultra detailed' } },
      { id: 3, type: 'CLIPTextEncode', pos: [350, 260], title: '反向提示词', values: { text: 'blurry, low quality, watermark, text' } },
      { id: 4, type: o.latentType || 'EmptyLatentImage', pos: [40, 640], values: o.latentValues || { width: 512, height: 512, batch_size: 1 } },
      { id: 5, type: 'KSampler', pos: [680, 60], values: { seed: 42, steps: 20, cfg: 8, denoise: 1 } },
      { id: 6, type: 'VAEDecode', pos: [960, 60] },
      { id: 7, type: o.outputNode || 'SaveImage', pos: [1180, 60], values: o.outputValues || { filename_prefix: 'StarStack/Image' } }
    ];
    const links = [
      [1, 'MODEL', 5, 'model'], [1, 'CLIP', 2, 'clip'], [1, 'CLIP', 3, 'clip'],
      [2, 'CONDITIONING', 5, 'positive'], [3, 'CONDITIONING', 5, 'negative'],
      [4, 'LATENT', 5, 'latent_image'], [5, 'LATENT', 6, 'samples'],
      [1, 'VAE', 6, 'vae'], [6, 'IMAGE', 7, o.outputInput || 'images']
    ];
    return { id, name, kind, desc: o.desc || '', nodes, links };
  }
  const TEMPLATE_SPECS = [
    sdSpec('tpl-txt2img', '文生图 · 官方默认工作流', 'image', { desc: 'Checkpoint → CLIP 文本编码 → KSampler → VAE 解码 → 保存图片，与官方默认图一致。' }),
    (function () {
      const s = sdSpec('tpl-img2img', '图生图 · 重绘', 'image', { desc: '在原图基础上重绘，可调节 denoise 控制改动幅度。' });
      s.nodes.push({ id: 8, type: 'LoadImage', pos: [40, 60] }, { id: 9, type: 'VAEEncode', pos: [350, 640] });
      s.nodes.find(n => n.id === 5).values = { seed: 42, steps: 20, cfg: 7, denoise: 0.6 };
      s.links = s.links.filter(l => !(l[0] === 4 && l[2] === 5));
      s.links.push([8, 'IMAGE', 9, 'pixels'], [1, 'VAE', 9, 'vae'], [9, 'LATENT', 5, 'latent_image']);
      return s;
    })(),
    (function () {
      const s = sdSpec('tpl-upscale', '高清放大 · 两步采样', 'image', { desc: '先出基础图，再潜空间放大并二次采样，适合高分辨率出图。' });
      s.nodes = s.nodes.filter(n => n.id !== 6 && n.id !== 7);
      s.nodes.push({ id: 10, type: 'LatentUpscaleBy', pos: [960, 300], values: { scale_by: 1.5 } },
        { id: 11, type: 'KSampler', pos: [1200, 60], title: '二次采样', values: { seed: 42, steps: 12, cfg: 7, denoise: 0.5 } },
        { id: 12, type: 'VAEDecode', pos: [1480, 60] }, { id: 13, type: 'SaveImage', pos: [1700, 60], values: { filename_prefix: 'StarStack/Upscale' } });
      s.links = s.links.filter(l => l[0] !== 6 && l[0] !== 7 && l[2] !== 6 && l[2] !== 7);
      s.links.push([5, 'LATENT', 10, 'samples'], [10, 'LATENT', 11, 'latent_image'],
        [1, 'MODEL', 11, 'model'], [2, 'CONDITIONING', 11, 'positive'], [3, 'CONDITIONING', 11, 'negative'],
        [11, 'LATENT', 12, 'samples'], [1, 'VAE', 12, 'vae'], [12, 'IMAGE', 13, 'images']);
      return s;
    })(),
    sdSpec('tpl-video-webp', '生视频 · 帧序列 (Animated WEBP)', 'video', {
      desc: '一次生成多帧并封装为动图/视频；fps 与时长可在节点里调整。',
      latentValues: { width: 512, height: 320, batch_size: 16 },
      outputNode: 'SaveAnimatedWEBP',
      outputValues: { filename_prefix: 'StarStack/Video', fps: 8, lossless: false, quality: 80, method: 'default' }
    }),
    (function () {
      const s = sdSpec('tpl-video-core', '生视频 · 官方 CreateVideo / SaveVideo', 'video', {
        desc: 'ComfyUI 新版核心视频节点：帧序列 → CreateVideo → SaveVideo 输出 mp4/webm。',
        latentValues: { width: 512, height: 320, batch_size: 24 }, outputNode: 'CreateVideo'
      });
      s.nodes.find(n => n.id === 7).pos = [1180, 60];
      s.nodes.push({ id: 14, type: 'SaveVideo', pos: [1420, 60], values: { filename_prefix: 'StarStack/Video', format: 'auto', codec: 'auto' } });
      s.links.push([7, 'VIDEO', 14, 'video']);
      return s;
    })()
  ];
  function builtinTemplate(kind, id) {
    const s = TEMPLATE_SPECS.filter(x => x.kind === kind && (!id || x.id === id))[0] || TEMPLATE_SPECS[0];
    return buildTemplate(s);
  }

  /* -------------------------------------------------------------- 工作流 IO */
  function parseWorkflow(text, name) {
    let raw;
    try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch (e) { throw new Error('JSON 解析失败：' + e.message); }
    if (raw && raw.workflow) return fromUI(raw, name);
    if (raw && Array.isArray(raw.nodes)) return fromUI(raw, name);
    if (raw && typeof raw === 'object' && Object.values(raw).some(v => v && v.class_type)) return fromAPI(raw, name);
    throw new Error('未识别的工作流格式（需要 UI 格式 nodes/links 或 API 格式 class_type）');
  }
  async function pngWorkflow(file) {
    const buf = await file.arrayBuffer();
    const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder('utf-8');
    if (dv.byteLength < 8 || dv.getUint32(0) !== 0x89504e47) throw new Error('不是 PNG 图片');
    let p = 8; const meta = {};
    while (p + 8 <= dv.byteLength) {
      const len = dv.getUint32(p);
      if (p + 12 + len > dv.byteLength) break;
      const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      const data = u8.subarray(p + 8, p + 8 + len);
      if (type === 'tEXt') {
        const z = data.indexOf(0);
        if (z > 0) meta[dec.decode(data.subarray(0, z))] = dec.decode(data.subarray(z + 1));
      } else if (type === 'iTXt') {
        const parts = []; let off = 0;
        for (let k = 0; k < 4; k++) { const z = data.indexOf(0, off); parts.push(dec.decode(data.subarray(off, z < 0 ? data.length : z))); off = (z < 0 ? data.length : z) + 1; }
        meta[parts[0]] = dec.decode(data.subarray(off));
      }
      p += 12 + len;
      if (type === 'IEND') break;
    }
    if (meta.workflow) return parseWorkflow(meta.workflow, file.name.replace(/\.png$/i, ''));
    if (meta.prompt) return parseWorkflow(meta.prompt, file.name.replace(/\.png$/i, ''));
    throw new Error('PNG 内没有 ComfyUI 工作流元数据');
  }
  async function importFile(file, kind) {
    if (!file) return;
    let g;
    try {
      g = /\.png$/i.test(file.name) ? await pngWorkflow(file) : parseWorkflow(await file.text(), file.name.replace(/\.(json|txt)$/i, ''));
    } catch (e) { toast('导入失败：' + e.message, true); return; }
    loadGraphInto(kind || W.tabs[W.active].kind, g, g.name);
    toast('已导入 ' + g.nodes.length + ' 个节点 · ' + g.links.length + ' 条连线');
    return g;
  }

  /* ------------------------------------------------------------ 预设持久化 */
  const LS_KEY = 'starstack-comfy-workflows';
  function readLocal() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; } }
  function writeLocal(list) { try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 60))); } catch (e) { /* quota */ } }
  async function loadLibrary() {
    try {
      const r = await apiJSON(API('workflows'));
      W.remote = true;
      W.library = (r.workflows || []).map(x => Object.assign({}, x, { remote: true }));
    } catch (e) {
      W.remote = false; W.library = readLocal();
    }
    renderSide(); renderCards();
  }
  async function saveWorkflow(scope, deploy, customName) {
    const t = W.tabs[W.active]; if (!t) return;
    const name = customName || t.name || '未命名工作流';
    const graph = toUI(t.graph);
    const payload = { id: t.savedId && t.savedId.indexOf('local-') !== 0 ? t.savedId : undefined, name, kind: t.kind, scope, graph, active: !!deploy };
    let saved;
    if (W.remote) {
      try { saved = (await postJSON(API('workflows'), payload)).workflow; }
      catch (e) { W.remote = false; }
    }
    if (!W.remote) {
      const list = readLocal();
      const id = payload.id || ('local-' + uid());
      const item = { id, name, kind: t.kind, scope, graph, active: !!deploy, updated_at: Date.now() / 1000, local: true };
      if (deploy) list.forEach(x => { if (x.kind === t.kind) x.active = false; });
      const i = list.findIndex(x => x.id === id);
      if (i >= 0) list[i] = Object.assign({}, list[i], item); else list.unshift(item);
      writeLocal(list);
      saved = { id, name, kind: t.kind, scope, active: !!deploy, nodes: graph.nodes.length };
    }
    t.savedId = saved.id; t.name = name; t.scope = scope; t.dirty = false;
    W.kindGraph[t.kind] = t.graph;
    if (deploy) {
      try { W.status.active = Object.assign({}, W.status.active, { [t.kind]: saved.id }); } catch (e) { /* older browser */ }
      toast('已部署「' + name + '」为' + (t.kind === 'image' ? '生图' : '生视频') + '默认工作流');
    } else {
      toast('已保存' + (scope === 'draft' ? '草稿' : '预设') + '：' + name);
    }
    await loadLibrary(); renderTabs(); renderCards();
    return saved;
  }
  async function loadSaved(item) {
    let graph = item.graph;
    if (!graph && W.remote) {
      try { graph = (await apiJSON(API('workflows/' + encodeURIComponent(item.id)))).workflow.graph; }
      catch (e) { toast('读取失败：' + e.message, true); return; }
    }
    if (!graph) return;
    try { loadGraphInto(item.kind, parseWorkflow(typeof graph === 'string' ? graph : JSON.stringify(graph), item.name), item.name, item.id); }
    catch (e) { toast('工作流损坏：' + e.message, true); }
  }
  async function deleteSaved(item) {
    if (W.remote && !item.local) {
      try { await apiJSON(API('workflows/' + encodeURIComponent(item.id)), { method: 'DELETE' }); }
      catch (e) { toast('删除失败：' + e.message, true); return; }
    } else writeLocal(readLocal().filter(x => x.id !== item.id));
    await loadLibrary();
  }
  async function activateSaved(item) {
    if (W.remote && !item.local) {
      try { await postJSON(API('workflows/' + encodeURIComponent(item.id) + '/activate?kind=' + encodeURIComponent(item.kind)), {}); }
      catch (e) { toast('部署失败：' + e.message, true); return; }
    } else {
      const list = readLocal();
      list.forEach(x => { if (x.kind === item.kind) x.active = false; });
      const found = list.find(x => x.id === item.id); if (found) found.active = true;
      writeLocal(list);
    }
    await loadSaved(item);
    toast('已部署「' + item.name + '」');
  }

  /* ------------------------------------------------------------------ 标签页 */
  function ensureTab(kind, graph, name) {
    let t = W.tabs.find(x => x.kind === kind);
    if (!t) {
      const g = graph || W.kindGraph[kind] || builtinTemplate(kind);
      t = { id: uid(), name: name || g.name || '未命名工作流', kind, graph: g, dirty: false, savedId: null, scope: 'draft' };
      W.tabs.push(t); W.kindGraph[kind] = g;
      if (W.active < 0) W.active = W.tabs.length - 1;
    }
    return t;
  }
  function graphFor(kind) { return W.kindGraph[kind] || ensureTab(kind).graph; }
  function loadGraphInto(kind, g, name, savedId) {
    let t = W.tabs.find(x => x.kind === kind);
    if (!t) t = ensureTab(kind);
    t.graph = g; t.name = name || g.name || '未命名工作流'; t.savedId = savedId || null; t.dirty = true;
    W.kindGraph[kind] = g;
    W.selection.clear(); W.selectedLink = null;
    if (W.active >= 0 && W.tabs[W.active].kind !== kind) W.active = W.tabs.indexOf(t);
    if (W.built && W.root.classList.contains('cw-open')) { renderAll(); fitView(); }
    renderCards();
  }
  function currentTab() { return W.tabs[W.active] || null; }
  function currentGraph() { const t = currentTab(); return t && t.graph; }

  /* -------------------------------------------------------------- DOM 骨架 */
  function buildRoot() {
    if (W.built) return;
    const root = document.createElement('div');
    root.id = 'cw-root';
    root.innerHTML = `
      <div class="cw-top">
        <div class="cw-brand"><i></i><div>ComfyUI 工作台<small>星栈算力 · Workflow</small></div></div>
        <div class="cw-tabs" id="cw-tabs"></div>
        <div class="cw-top-actions">
          <button class="cw-btn tiny" data-act="new" title="新建空白工作流">＋ 新建</button>
          <button class="cw-btn tiny" data-act="import" title="导入 .json / .png">导入</button>
          <button class="cw-btn tiny" data-act="export" title="导出 UI 格式 workflow.json">导出</button>
          <button class="cw-btn tiny" data-act="export-api" title="导出 API 格式 prompt.json">导出 API</button>
          <button class="cw-btn tiny" data-act="save-draft">存草稿</button>
          <button class="cw-btn tiny" data-act="save-preset">存预设</button>
          <button class="cw-btn tiny" data-act="deploy">部署</button>
          <button class="cw-btn primary" data-act="queue" title="提交到 ComfyUI 执行队列">▶ 运行 (Queue Prompt)</button>
          <button class="cw-btn icon" data-act="help" title="使用教程">?</button>
          <button class="cw-btn icon" data-act="close" title="关闭工作台">✕</button>
        </div>
      </div>
      <div class="cw-main">
        <div class="cw-side" id="cw-side">
          <div class="cw-side-tabs">
            <button class="cw-side-tab on" data-side="nodes">节点库</button>
            <button class="cw-side-tab" data-side="workflows">工作流</button>
            <button class="cw-side-tab" data-side="queue">队列</button>
            <button class="cw-side-tab" data-side="results">结果</button>
            <button class="cw-side-tab" data-side="settings">设置</button>
          </div>
          <div class="cw-side-body" id="cw-side-body"></div>
        </div>
        <div class="cw-stage" id="cw-stage">
          <div class="cw-canvas" id="cw-canvas">
            <div class="cw-world" id="cw-world">
              <svg class="cw-links" id="cw-links"></svg>
              <div id="cw-nodes"></div>
            </div>
          </div>
          <div class="cw-empty" id="cw-empty">画布为空 · 双击或右键添加节点</div>
          <div class="cw-zoom">
            <button class="cw-btn tiny" data-zoom="out">−</button>
            <span id="cw-zoom-label">100%</span>
            <button class="cw-btn tiny" data-zoom="in">＋</button>
            <button class="cw-btn tiny" data-zoom="fit">适应</button>
            <button class="cw-btn tiny" data-zoom="side">☰</button>
          </div>
          <div id="cw-float"></div>
        </div>
      </div>
      <div class="cw-bottom">
        <span><i class="cw-dot" id="cw-conn-dot"></i><span id="cw-conn-text">检测 ComfyUI 服务…</span></span>
        <span id="cw-stats"></span>
        <span class="cw-grow"></span>
        <span id="cw-exec-text">就绪</span>
        <span class="cw-mini-bar"><i id="cw-progress"></i></span>
        <span id="cw-queue-text">队列 0</span>
      </div>
      <input type="file" id="cw-file" class="cw-hidden" accept=".json,.png,application/json,image/png">
    `;
    document.body.appendChild(root);
    W.root = root; W.built = true;
    bindEvents();
  }

  /* -------------------------------------------------------------- 渲染：节点 */
  function nodeHTML(n) {
    const d = getDef(n.type) || {};
    const head = CAT_COLOR[d.category] || CAT_COLOR.imported;
    const ioRows = [];
    const maxIO = Math.max(n.inputs.filter(i => !i.widget).length, n.outputs.length);
    for (let i = 0; i < maxIO; i++) {
      const inp = n.inputs.filter(x => !x.widget)[i], out = n.outputs[i];
      ioRows.push(`<div class="cw-row cw-io">
        <div>${inp ? `<span class="cw-slot ${inp.link != null ? 'connected' : ''}" style="--cw-slot-color:${colorOf(inp.type)}"
              data-kind="in" data-node="${n.id}" data-name="${h(inp.name)}" data-slot="${i}" title="${h(inp.name)} · ${h(inp.type)}"></span>
              <span class="cw-slot-label">${h(inp.name)}</span>` : ''}</div>
        <div>${out ? `<span class="cw-slot-label">${h(out.name)}</span>
              <span class="cw-slot" style="--cw-slot-color:${colorOf(out.type)}"
              data-kind="out" data-node="${n.id}" data-name="${h(out.name)}" data-slot="${i}" title="${h(out.name)} · ${h(out.type)}"></span>` : ''}</div>
      </div>`);
    }
    const widgets = n.widgets.map((w, i) => {
      const attrs = `data-node="${n.id}" data-widget="${i}"`;
      let control = '';
      if (w.type === 'COMBO') {
        const opts = (w.options || []).map(o => `<option value="${h(o)}" ${String(o) === String(w.value) ? 'selected' : ''}>${h(o)}</option>`).join('');
        if (String(w.value) !== '' && !(w.options || []).some(o => String(o) === String(w.value)))
          control = `<option value="${h(w.value)}" selected>${h(w.value)}</option>`;
        control = `<select ${attrs}>${control}${opts}</select>`;
      } else if (w.type === 'BOOLEAN') {
        control = `<input type="checkbox" ${attrs} ${w.value ? 'checked' : ''}>`;
      } else if (w.type === 'STRING' && (w.opts.multiline || String(w.value).length > 42)) {
        control = `<textarea rows="3" ${attrs}>${h(w.value)}</textarea>`;
      } else if (w.type === 'INT' || w.type === 'FLOAT') {
        control = `<input type="number" ${attrs} value="${h(w.value)}" step="${w.type === 'INT' ? (w.opts.step || 1) : (w.opts.step || 0.01)}">`;
      } else {
        control = `<input type="text" ${attrs} value="${h(w.value)}">`;
      }
      const seed = w.control ? `<button class="cw-seed-btn" data-seed="${n.id}:${i}" title="随机种子">随机</button>` : '';
      return `<div class="cw-widget-row"><label title="${h(w.name)}">${h(w.name)}</label>
        <div class="cw-widget-wrap ${w.link != null ? 'linked' : ''}">${control}${seed}
          <span class="cw-slot" style="--cw-slot-color:${colorOf(w.type)}" data-kind="widget" data-node="${n.id}" data-name="${h(w.name)}" title="把 ${h(w.name)} 转为输入"></span>
        </div></div>`;
    }).join('');
    return `<div class="cw-node ${W.selection.has(n.id) ? 'sel' : ''} ${n.mode === 2 ? 'muted' : n.mode === 4 ? 'bypass' : ''} ${n.collapsed ? 'collapsed' : ''} ${W.runningNode === n.id ? 'executing' : ''}"
        data-node="${n.id}" style="left:${n.pos[0]}px;top:${n.pos[1]}px;width:${n.size[0]}px;--cw-head:${head}">
      <div class="cw-node-head" data-drag-node="${n.id}">
        <button class="cw-collapse" data-collapse="${n.id}">${n.collapsed ? '▸' : '▾'}</button>
        <span class="cw-node-title" title="${h(n.type)}">${h(n.title || n.type)}</span>
        <span class="cw-node-id">#${n.id}</span>
      </div>
      <div class="cw-node-body">${ioRows.join('')}${widgets}</div>
    </div>`;
  }
  function renderNodes() {
    const g = currentGraph(); if (!g) return;
    $('#cw-nodes').innerHTML = g.nodes.map(nodeHTML).join('');
    $('#cw-empty').style.display = g.nodes.length ? 'none' : 'flex';
    drawLinks();
  }
  function slotCenter(nodeId, kind, name, slot) {
    const g = currentGraph();
    const n = g && g.nodes.find(x => x.id === nodeId); if (!n) return null;
    let sel;
    if (kind === 'out') sel = `.cw-node[data-node="${nodeId}"] .cw-slot[data-kind="out"][data-slot="${slot}"]`;
    else if (kind === 'in') sel = `.cw-node[data-node="${nodeId}"] .cw-slot[data-kind="in"][data-name="${CSS.escape(name)}"]`;
    else sel = `.cw-node[data-node="${nodeId}"] .cw-slot[data-kind="widget"][data-name="${CSS.escape(name)}"]`;
    const el = document.querySelector(sel); if (!el) return null;
    const r = el.getBoundingClientRect(), wr = $('#cw-world').getBoundingClientRect(), s = W.view.scale;
    return { x: (r.left + r.width / 2 - wr.left) / s, y: (r.top + r.height / 2 - wr.top) / s };
  }
  function bezier(a, b) {
    const dx = Math.max(45, Math.abs(b.x - a.x) * 0.5);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }
  function drawLinks() {
    const g = currentGraph(); if (!g || !W.built) return;
    const byId = new Map(g.nodes.map(n => [n.id, n]));
    let svg = '';
    for (const l of g.links) {
      const on = byId.get(l.origin), tn = byId.get(l.target);
      if (!on || !tn) continue;
      const out = on.outputs[l.originSlot] || {}, inp = tn.inputs[l.targetSlot] || {};
      let bName = inp.name, bKind = inp.widget ? 'widget' : 'in';
      if (!bName) {
        const fallback = tn.widgets[l.targetSlot - tn.inputs.length];
        if (fallback) { bName = fallback.name; bKind = 'widget'; }
      }
      const a = slotCenter(l.origin, 'out', out.name, l.originSlot);
      const b = slotCenter(l.target, bKind, bName, l.targetSlot);
      if (!a || !b) continue;
      svg += `<path class="cw-link ${W.selectedLink === l.id ? 'sel' : ''}" data-link="${l.id}" d="${bezier(a, b)}" stroke="${colorOf(l.type)}"></path>`;
    }
    if (W.linkDrag && W.linkDrag.pos) {
      const f = W.linkDrag.from, a = slotCenter(f.node, f.kind, f.name, f.slot);
      if (a) svg += `<path class="cw-link temp" d="${bezier(f.kind === 'out' ? a : W.linkDrag.pos, f.kind === 'out' ? W.linkDrag.pos : a)}"></path>`;
    }
    $('#cw-links').innerHTML = svg;
  }
  function applyView() {
    if (!W.built) return;
    $('#cw-world').style.transform = `translate(${W.view.x}px,${W.view.y}px) scale(${W.view.scale})`;
    $('#cw-zoom-label').textContent = Math.round(W.view.scale * 100) + '%';
    const c = $('#cw-canvas');
    c.style.backgroundSize = (22 * W.view.scale) + 'px ' + (22 * W.view.scale) + 'px';
    c.style.backgroundPosition = W.view.x + 'px ' + W.view.y + 'px';
    c.style.backgroundImage = W.settings.showGrid ? 'radial-gradient(#34343c 1px,transparent 1px)' : 'none';
  }
  function fitView() {
    const g = currentGraph(); if (!g || !g.nodes.length) { W.view = { x: 60, y: 40, scale: 1 }; applyView(); return; }
    const xs = g.nodes.map(n => n.pos[0]), ys = g.nodes.map(n => n.pos[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const x1 = Math.max(...g.nodes.map(n => n.pos[0] + n.size[0]));
    const y1 = Math.max(...g.nodes.map(n => n.pos[1] + Math.max(80, n.size[1])));
    const c = $('#cw-canvas'), w = c.clientWidth - 80, hh = c.clientHeight - 80;
    const s = clamp(Math.min(w / Math.max(1, x1 - x0), hh / Math.max(1, y1 - y0), 1.25), 0.18, 1.25);
    W.view.scale = s;
    W.view.x = (c.clientWidth - (x1 - x0) * s) / 2 - x0 * s;
    W.view.y = (c.clientHeight - (y1 - y0) * s) / 2 - y0 * s;
    applyView();
  }
  function renderTabs() {
    if (!W.built) return;
    $('#cw-tabs').innerHTML = W.tabs.map((t, i) => `<button class="cw-tab ${i === W.active ? 'on' : ''}" data-tab="${i}">
      <span class="cw-tab-name">${h(t.name)}</span>${t.dirty ? '<i class="cw-dirty"></i>' : ''}
      <span class="cw-x" data-close-tab="${i}">×</span></button>`).join('') +
      '<button class="cw-btn tiny" data-act="new" title="新建工作流">＋</button>';
  }
  function renderAll() { renderTabs(); renderNodes(); applyView(); renderSide(); renderFooter(); }

  /* -------------------------------------------------------------- 渲染：侧栏 */
  function renderSide() {
    if (!W.built) return;
    document.querySelectorAll('.cw-side-tab').forEach(b => b.classList.toggle('on', b.dataset.side === W.sideTab));
    const body = $('#cw-side-body');
    if (W.sideTab === 'nodes') {
      const q = (W.nodeQuery || '').toLowerCase();
      const groups = {};
      for (const [type, d] of Object.entries(Object.assign({}, CATALOG, W.defs))) {
        if (q && type.toLowerCase().indexOf(q) < 0 && (d.category || '').toLowerCase().indexOf(q) < 0) continue;
        (groups[d.category || 'imported'] = groups[d.category || 'imported'] || []).push(type);
      }
      body.innerHTML = `<input class="cw-field" id="cw-node-search" placeholder="搜索节点，例如 KSampler / 加载 / 视频" value="${h(W.nodeQuery || '')}">
        <div class="cw-hint">双击画布或右键空白处也可以搜索添加节点。连接到 ComfyUI 后会自动载入服务器上的全部节点与模型列表。</div>
        <div class="cw-node-lib">${Object.entries(groups).sort().map(([cat, list]) => `
          <div class="cw-lib-group"><span>${h(cat)}</span>${list.sort().map(t => `
            <button class="cw-lib-item" data-add-node="${h(t)}"><i style="background:${CAT_COLOR[cat] || '#666'}"></i>${h(t)}<small>${h((getDef(t).input && Object.keys(getDef(t).input.required || {}).length) || '')}</small></button>`).join('')}</div>`).join('')}</div>`;
    } else if (W.sideTab === 'workflows') {
      const t = currentTab();
      const items = W.library.filter(x => x.scope === W.wfScope);
      body.innerHTML = `
        <div class="cw-subtabs">
          <button class="cw-subtab ${W.wfScope === 'template' ? 'on' : ''}" data-wf-scope="template">模板配置</button>
          <button class="cw-subtab ${W.wfScope === 'preset' ? 'on' : ''}" data-wf-scope="preset">我的预设</button>
          <button class="cw-subtab ${W.wfScope === 'draft' ? 'on' : ''}" data-wf-scope="draft">保存草稿</button>
        </div>
        ${W.wfScope === 'template' ? `
          <div class="cw-hint">官方同款起始工作流，载入后可像 ComfyUI 一样增删节点、改控件、连线和导出。</div>
          <div class="cw-list">${TEMPLATE_SPECS.filter(s => !t || s.kind === t.kind).map(s => `
            <div class="cw-item"><div class="cw-item-top"><span class="cw-item-name">${h(s.name)}</span><span class="cw-badge">内置</span></div>
            <div class="cw-item-meta">${h(s.desc)}</div>
            <div class="cw-item-actions"><button class="cw-btn tiny" data-tpl="${h(s.id)}">载入</button>
            <button class="cw-btn tiny" data-tpl-deploy="${h(s.id)}">部署为默认</button></div></div>`).join('')}</div>` : `
          <div class="cw-drop" id="cw-side-drop">拖入 workflow.json / 带工作流元数据的 PNG<br>或点击这里选择文件</div>
          <div class="cw-hint">${W.remote ? '已同步到账号（服务端保存）' : '离线模式：保存到浏览器本地存储'}</div>
          <div class="cw-list">${items.length ? items.map((x, i) => `
            <div class="cw-item ${x.active ? 'active' : ''}"><div class="cw-item-top"><span class="cw-item-name">${h(x.name)}</span>
              <span class="cw-badge ${x.active ? 'ok' : ''}">${x.active ? '已部署' : h(x.kind === 'image' ? '生图' : '生视频')}</span></div>
              <div class="cw-item-meta">${x.nodes || 0} 节点 · ${new Date((x.updated_at || 0) * 1000).toLocaleString('zh-CN')}</div>
              <div class="cw-item-actions">
                <button class="cw-btn tiny" data-wf-load="${i}">载入</button>
                <button class="cw-btn tiny" data-wf-active="${i}">部署</button>
                <button class="cw-btn tiny" data-wf-export="${i}">导出</button>
                <button class="cw-btn tiny" data-wf-del="${i}">删除</button>
              </div></div>`).join('') : '<div class="cw-hint">这里还没有内容，先在画布里编辑并「存预设 / 存草稿」。</div>'}</div>`}
        <div class="cw-hint" style="margin-top:14px">当前：${h(t ? t.name : '—')} · ${t ? t.graph.nodes.length : 0} 节点 / ${t ? t.graph.links.length : 0} 连线</div>`;
    } else if (W.sideTab === 'queue') {
      body.innerHTML = `<div style="display:flex;gap:6px;margin-bottom:10px">
          <button class="cw-btn tiny" data-act="refresh-queue">刷新队列</button>
          <button class="cw-btn tiny" data-act="interrupt">中断当前</button>
          <button class="cw-btn tiny" data-act="clear-queue">清空队列</button></div>
        <div class="cw-hint">与官方 Queue Prompt 一致：提交后立即返回 prompt_id，执行进度由 /ws 实时推送。</div>
        ${W.queue.length ? W.queue.map(q => `<div class="cw-queue-item">
          <div style="display:flex;justify-content:space-between"><b>${h(String(q.id).slice(0, 12))}</b><span>${h(q.state || '排队中')}</span></div>
          <div style="color:var(--cw-faint);font-size:10px;margin-top:3px">${h(q.name || '')}</div>
          <div class="cw-bar"><i style="width:${q.id === W.currentPrompt ? Math.round((W.progress.value / Math.max(1, W.progress.max)) * 100) : (q.state === '完成' ? 100 : 0)}%"></i></div>
        </div>`).join('') : '<div class="cw-hint">暂无任务</div>'}`;
    } else if (W.sideTab === 'results') {
      body.innerHTML = `<div class="cw-hint">生成结果由 ComfyUI 输出节点通过 /view 提供，点击可打开原图/视频。</div>
        <div class="cw-gallery">${W.outputs.slice(0, 60).map(o => {
        const url = CF('view?filename=' + encodeURIComponent(o.filename) + '&subfolder=' + encodeURIComponent(o.subfolder || '') + '&type=' + encodeURIComponent(o.type || 'output'));
        const isImg = /\.(png|jpe?g|webp|gif)$/i.test(o.filename);
        return `<a class="cw-tile" href="${h(url)}" target="_blank" rel="noreferrer">${isImg ? `<img src="${h(url)}" alt="">` : '<div style="height:100px;display:flex;align-items:center;justify-content:center;font-size:26px">▶</div>'}<span>${h(o.filename)}</span></a>`;
      }).join('') || '<div class="cw-hint">还没有输出</div>'}</div>`;
    } else {
      const st = W.status.system_stats || {};
      body.innerHTML = `<h4>ComfyUI 服务</h4>
        <div class="cw-kv"><span>状态</span><b>${W.online ? '已连接' : '离线 / 未配置'}</b></div>
        <div class="cw-kv"><span>代理路径</span><b>${h(ROOT || '/')} /comfyui/api/</b></div>
        <div class="cw-kv"><span>节点定义</span><b>${Object.keys(W.defs).length + Object.keys(CATALOG).length} 类</b></div>
        <div class="cw-kv"><span>客户端 ID</span><b>${h(W.clientId.slice(0, 16))}</b></div>
        ${(st.devices && st.devices[0]) ? `<div class="cw-kv"><span>设备</span><b>${h(st.devices[0].name || 'GPU')}</b></div>` : ''}
        <div class="cw-hint">服务端用 <code>--comfyui http://127.0.0.1:8188</code>（或环境变量 <code>STARSTACK_COMFYUI</code>）指向 ComfyUI。平台会复用当前登录会话代理官方 API，包括 WebSocket。</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="cw-btn tiny" data-act="reload-defs">重新载入节点定义</button>
        <button class="cw-btn tiny" data-act="reconnect">重新连接服务</button>
        <button class="cw-btn tiny" data-act="validate">校验当前工作流</button></div>
        <h4>编辑器</h4>
        <label class="cw-kv"><span>对齐网格</span><input type="checkbox" data-setting="snap" ${W.settings.snap ? 'checked' : ''}></label>
        <label class="cw-kv"><span>显示网格</span><input type="checkbox" data-setting="showGrid" ${W.settings.showGrid ? 'checked' : ''}></label>
        <div class="cw-hint">快捷键：Delete 删除 · Ctrl+C/V 复制粘贴 · Ctrl+D 复制节点 · Ctrl+A 全选 · 滚轮缩放 · 空格/中键拖动画布 · 右键添加节点 · Ctrl+Enter 运行</div>`;
    }
  }
  function renderFooter() {
    if (!W.built) return;
    $('#cw-conn-dot').className = 'cw-dot ' + (W.online ? 'ok' : '');
    $('#cw-conn-text').textContent = W.online ? 'ComfyUI 已连接' : '离线编辑模式（内置节点库）';
    $('#cw-queue-text').textContent = '队列 ' + (W.queueRemaining || W.queue.length);
    $('#cw-stats').textContent = W.objInfoLoaded ? Object.keys(W.defs).length + ' 类节点' : '';
    const pct = W.progress.max ? Math.round(W.progress.value / W.progress.max * 100) : 0;
    $('#cw-progress').style.width = pct + '%';
    $('#cw-exec-text').textContent = W.currentPrompt ? ('执行中 ' + pct + '%') : '就绪';
  }
  function toast(msg, isErr) {
    const f = W.built ? $('#cw-float') : null;
    const old = (f || document.body).querySelector(f ? '.cw-toast' : '.cw-body-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = (f ? 'cw-toast' : 'cw-body-toast') + (isErr ? ' err' : '');
    el.textContent = msg;
    (f || document.body).appendChild(el);
    clearTimeout(W.toastTimer); W.toastTimer = setTimeout(() => el.remove(), 3600);
  }
  function closeFloat() { const f = $('#cw-float'); if (f) { f.querySelectorAll('.cw-search,.cw-ctx').forEach(x => x.remove()); } }

  /* -------------------------------------------------------------- 交互实现 */
  function screenToWorld(ev) {
    const r = $('#cw-canvas').getBoundingClientRect();
    return { x: (ev.clientX - r.left - W.view.x) / W.view.scale, y: (ev.clientY - r.top - W.view.y) / W.view.scale };
  }
  function addNode(type, pos) {
    const g = currentGraph(); if (!g) return;
    const n = makeNode(type, nextNodeId(g), pos || screenToWorld({ clientX: $('#cw-canvas').getBoundingClientRect().left + 160, clientY: $('#cw-canvas').getBoundingClientRect().top + 120 }));
    if (W.settings.snap) { n.pos[0] = Math.round(n.pos[0] / 20) * 20; n.pos[1] = Math.round(n.pos[1] / 20) * 20; }
    g.nodes.push(n);
    W.selection = new Set([n.id]);
    markDirty(); renderNodes(); renderSide();
  }
  function removeLink(g, id) {
    const l = g.links.find(x => x.id === id); if (!l) return;
    const on = g.nodes.find(n => n.id === l.origin);
    if (on && on.outputs[l.originSlot]) on.outputs[l.originSlot].links = on.outputs[l.originSlot].links.filter(x => x !== id);
    const tn = g.nodes.find(n => n.id === l.target);
    if (tn) {
      const inp = tn.inputs.find(i => i.link === id); if (inp) inp.link = null;
      const w = tn.widgets.find(x => x.link === id); if (w) w.link = null;
    }
    g.links = g.links.filter(x => x.id !== id);
  }
  function connect(from, to) {
    const g = currentGraph(); if (!g) return;
    let out, inp;
    if (from.kind === 'out' && to.kind !== 'out') out = from, inp = to;
    else if (to.kind === 'out' && from.kind !== 'out') out = to, inp = from;
    else return;
    if (out.node === inp.node) return;
    const on = g.nodes.find(n => n.id === out.node), tn = g.nodes.find(n => n.id === inp.node);
    if (!on || !tn) return;
    const oType = (on.outputs[out.slot] || {}).type || '*';
    const iType = inp.kind === 'widget'
      ? ((tn.widgets.find(w => w.name === inp.name) || {}).type || '*')
      : ((tn.inputs.filter(i => !i.widget)[inp.slot] || {}).type || '*');
    if (oType !== '*' && iType !== '*' && oType !== iType && !WIDGET_TYPES[iType]) {
      toast('类型不匹配：' + oType + ' → ' + iType, true); return;
    }
    let input = tn.inputs.find(i => i.name === inp.name);
    const widget = tn.widgets.find(w => w.name === inp.name);
    if (!input) { input = { name: inp.name, type: inp.kind === 'widget' ? iType : '*', link: null, widget: inp.kind === 'widget' }; tn.inputs.push(input); }
    const ts = targetSlotFor(tn, inp.name);
    // 一个输入只保留一条连线（官方行为）
    const existing = g.links.find(l => l.target === tn.id && l.targetSlot === ts);
    if (existing) removeLink(g, existing.id);
    const link = { id: nextLinkId(g), origin: on.id, originSlot: out.slot, target: tn.id, targetSlot: ts, type: oType };
    input.link = link.id; if (widget) widget.link = link.id;
    if (on.outputs[out.slot]) on.outputs[out.slot].links.push(link.id);
    g.links.push(link);
    markDirty(); renderNodes();
  }
  function deleteSelection() {
    const g = currentGraph(); if (!g) return;
    if (W.selectedLink != null) { removeLink(g, W.selectedLink); W.selectedLink = null; }
    for (const id of W.selection) {
      for (const l of g.links.filter(x => x.origin === id || x.target === id).map(x => x.id)) removeLink(g, l);
    }
    g.nodes = g.nodes.filter(n => !W.selection.has(n.id));
    W.selection.clear(); markDirty(); renderNodes(); renderSide();
  }
  function duplicateSelection() {
    const g = currentGraph(); if (!g || !W.selection.size) return;
    const map = new Map(), clones = [];
    for (const n of g.nodes.filter(x => W.selection.has(x.id))) {
      const c = clone(n); c.id = nextNodeId(g); c.pos = [n.pos[0] + 30, n.pos[1] + 30];
      c.inputs.forEach(i => i.link = null); c.outputs.forEach(o => o.links = []); c.widgets.forEach(w => w.link = null);
      map.set(n.id, c.id); clones.push(c);
    }
    for (const l of g.links.filter(x => map.has(x.origin) && map.has(x.target))) {
      const c = clone(l); c.id = nextLinkId(g); c.origin = map.get(l.origin); c.target = map.get(l.target);
      const on = clones.find(n => n.id === c.origin), tn = clones.find(n => n.id === c.target);
      if (on.outputs[c.originSlot]) on.outputs[c.originSlot].links.push(c.id);
      const inp = tn.inputs[c.targetSlot]; if (inp) inp.link = c.id;
      const w = tn.widgets.find(x => x.name === inp.name); if (w) w.link = c.id;
      g.links.push(c);
    }
    g.nodes.push(...clones);
    W.selection = new Set(clones.map(n => n.id));
    markDirty(); renderNodes();
  }
  function copySelection() {
    const g = currentGraph(); if (!g) return;
    W.clipboard = clone(g.nodes.filter(n => W.selection.has(n.id)));
    toast('已复制 ' + W.clipboard.length + ' 个节点');
  }
  function pasteClipboard() {
    if (!W.clipboard || !W.clipboard.length) return;
    const g = currentGraph(); const map = new Map(), clones = [];
    for (const n of W.clipboard) {
      const c = clone(n); c.id = nextNodeId(g); c.pos = [n.pos[0] + 40, n.pos[1] + 40];
      c.inputs.forEach(i => i.link = null); c.outputs.forEach(o => o.links = []); c.widgets.forEach(w => w.link = null);
      map.set(n.id, c.id); clones.push(c);
    }
    g.nodes.push(...clones); W.selection = new Set(clones.map(n => n.id));
    markDirty(); renderNodes();
  }
  function markDirty() {
    const t = currentTab(); if (!t) return;
    t.dirty = true; renderTabs();
    clearTimeout(W.cardTimer); W.cardTimer = setTimeout(renderCards, 220);
  }
  function showSearch(x, y, worldPos) {
    closeFloat();
    const stage = $('#cw-stage').getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'cw-search';
    el.style.left = clamp(x - stage.left, 6, Math.max(6, stage.width - 300)) + 'px';
    el.style.top = clamp(y - stage.top, 6, Math.max(6, stage.height - 350)) + 'px';
    el.innerHTML = `<input class="cw-field" placeholder="搜索节点…"><div class="cw-search-list"></div>`;
    $('#cw-float').appendChild(el);
    const input = el.querySelector('input'), list = el.querySelector('.cw-search-list');
    const all = Object.keys(Object.assign({}, CATALOG, W.defs)).sort();
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const found = all.filter(t => !q || t.toLowerCase().includes(q)).slice(0, 60);
      list.innerHTML = found.map((t, i) => `<button class="cw-search-item ${i === 0 ? 'sel' : ''}" data-add-node="${h(t)}"><i style="width:8px;height:8px;border-radius:50%;background:${CAT_COLOR[(getDef(t) || {}).category] || '#666'}"></i>${h(t)}</button>`).join('') || '<div class="cw-hint">没有匹配的节点</div>';
    };
    draw(); input.focus();
    input.addEventListener('input', draw);
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeFloat(); return; }
      if (e.key === 'Enter') { const b = list.querySelector('.cw-search-item'); if (b) { addNode(b.dataset.addNode, worldPos); closeFloat(); } }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...list.querySelectorAll('.cw-search-item')]; let i = items.findIndex(x => x.classList.contains('sel'));
        items.forEach(x => x.classList.remove('sel'));
        i = clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
        if (items[i]) { items[i].classList.add('sel'); items[i].scrollIntoView({ block: 'nearest' }); }
        e.preventDefault();
      }
    });
    W.searchWorld = worldPos;
  }
  function showNodeMenu(x, y, nodeId) {
    closeFloat();
    const g = currentGraph(), n = g && g.nodes.find(x => x.id === nodeId); if (!n) return;
    const stage = $('#cw-stage').getBoundingClientRect();
    const el = document.createElement('div'); el.className = 'cw-ctx';
    el.style.left = clamp(x - stage.left, 6, Math.max(6, stage.width - 190)) + 'px';
    el.style.top = clamp(y - stage.top, 6, Math.max(6, stage.height - 240)) + 'px';
    el.innerHTML = `<div style="padding:4px 9px;color:var(--cw-faint);font-size:10px">${h(n.type)} #${n.id}</div><hr>
      <button data-node-act="title">重命名</button>
      <button data-node-act="duplicate">复制节点 (Ctrl+D)</button>
      <button data-node-act="collapse">${n.collapsed ? '展开' : '折叠'}</button>
      <button data-node-act="mute">${n.mode === 2 ? '取消静音' : '静音 (Never)'}</button>
      <button data-node-act="bypass">${n.mode === 4 ? '取消绕过' : '绕过 (Bypass)'}</button>
      <button data-node-act="inputs">断开全部输入</button><hr>
      <button data-node-act="delete">删除 (Delete)</button>`;
    el.dataset.node = nodeId;
    $('#cw-float').appendChild(el);
  }

  function bindEvents() {
    const root = W.root;
    root.addEventListener('click', async e => {
      const actEl = e.target.closest('[data-act]');
      if (actEl) { await handleAction(actEl.dataset.act, e); return; }
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        if (e.target.closest('[data-close-tab]')) {
          const i = Number(e.target.closest('[data-close-tab]').dataset.closeTab);
          if (W.tabs.length === 1) { toast('至少保留一个工作流'); return; }
          W.tabs.splice(i, 1); W.active = clamp(W.active, 0, W.tabs.length - 1);
        } else W.active = Number(tab.dataset.tab);
        renderAll(); fitView(); return;
      }
      const side = e.target.closest('[data-side]');
      if (side) { W.sideTab = side.dataset.side; renderSide(); return; }
      const scope = e.target.closest('[data-wf-scope]');
      if (scope) { W.wfScope = scope.dataset.wfScope; renderSide(); return; }
      const tpl = e.target.closest('[data-tpl],[data-tpl-deploy]');
      if (tpl) {
        const id = tpl.dataset.tpl || tpl.dataset.tplDeploy;
        const spec = TEMPLATE_SPECS.find(s => s.id === id); if (!spec) return;
        loadGraphInto(currentTab().kind, buildTemplate(spec), spec.name);
        toast('已载入模板：' + spec.name);
        if (tpl.dataset.tplDeploy) await saveWorkflow('preset', true, spec.name);
        return;
      }
      const add = e.target.closest('[data-add-node]');
      if (add) {
        const stage = $('#cw-stage').getBoundingClientRect();
        const pos = W.searchWorld || { x: (160 - W.view.x) / W.view.scale, y: (120 - W.view.y) / W.view.scale };
        addNode(add.dataset.addNode, { ...pos });
        W.searchWorld = null; closeFloat(); return;
      }
      const wf = e.target.closest('[data-wf-load],[data-wf-active],[data-wf-export],[data-wf-del]');
      if (wf) {
        const items = W.library.filter(x => x.scope === W.wfScope), item = items[Number(wf.dataset.wfLoad ?? wf.dataset.wfActive ?? wf.dataset.wfExport ?? wf.dataset.wfDel)];
        if (!item) return;
        if (wf.dataset.wfLoad != null) await loadSaved(item);
        else if (wf.dataset.wfActive != null) await activateSaved(item);
        else if (wf.dataset.wfExport != null) {
          await loadSaved(item);
          download(safeName(item.name) + '.json', JSON.stringify(toUI(graphFor(item.kind)), null, 2));
        } else await deleteSaved(item);
        return;
      }
      const z = e.target.closest('[data-zoom]');
      if (z) { handleZoom(z.dataset.zoom); return; }
      const nodeMenu = e.target.closest('[data-node-act]');
      if (nodeMenu) { await handleNodeAction(nodeMenu.closest('.cw-ctx').dataset.node, nodeMenu.dataset.nodeAct); closeFloat(); return; }
      const collapse = e.target.closest('[data-collapse]');
      if (collapse) {
        const g = currentGraph(), n = g.nodes.find(x => x.id === Number(collapse.dataset.collapse));
        if (n) { n.collapsed = !n.collapsed; markDirty(); renderNodes(); }
        return;
      }
      const seed = e.target.closest('[data-seed]');
      if (seed) {
        const [id, i] = seed.dataset.seed.split(':');
        const g = currentGraph(), n = g.nodes.find(x => x.id === Number(id));
        if (n && n.widgets[i]) { n.widgets[i].value = Math.floor(Math.random() * 4294967295); markDirty(); renderNodes(); }
        return;
      }
      const link = e.target.closest('[data-link]');
      if (link) { W.selectedLink = Number(link.dataset.link); W.selection.clear(); renderNodes(); return; }
      const nodeEl = e.target.closest('.cw-node');
      if (nodeEl && e.target.closest('.cw-node-body') === null) { /* header selection handled on mousedown */ }
      const drop = e.target.closest('#cw-side-drop');
      if (drop) { $('#cw-file').click(); return; }
      const modalClose = e.target.closest('[data-modal-close]');
      if (modalClose) { const m = root.querySelector('.cw-modal'); if (m) m.remove(); }
    });

    root.addEventListener('input', e => {
      if (e.target.id === 'cw-node-search') {
        W.nodeQuery = e.target.value;
        const pos = e.target.selectionStart; renderSide();
        const again = $('#cw-node-search'); if (again) { again.focus(); again.setSelectionRange(pos, pos); }
        return;
      }
      const f = e.target.closest('[data-widget]');
      if (f) setWidget(f);
    });
    root.addEventListener('change', e => {
      const f = e.target.closest('[data-widget]'); if (f) setWidget(f);
      const s = e.target.closest('[data-setting]');
      if (s) { W.settings[s.dataset.setting] = s.checked; applyView(); }
      if (e.target.id === 'cw-file' && e.target.files[0]) { importFile(e.target.files[0]); e.target.value = ''; }
    });
    function setWidget(f) {
      const g = currentGraph(); if (!g) return;
      const n = g.nodes.find(x => x.id === Number(f.dataset.node)); if (!n) return;
      const w = n.widgets[Number(f.dataset.widget)]; if (!w) return;
      let v = f.type === 'checkbox' ? f.checked : f.value;
      if (w.type === 'INT') v = Math.round(Number(v) || 0);
      else if (w.type === 'FLOAT') v = Number(v) || 0;
      w.value = v; markDirty();
      // 文本域输入时不能重建节点 DOM，否则每敲一个字都会丢焦点；
      // 只有下拉框换值才需要重绘（可能影响控件外观）。
      if (f.tagName === 'SELECT') renderNodes();
    }

    const canvas = $('#cw-canvas');
    canvas.addEventListener('mousedown', e => {
      closeFloat();
      const slot = e.target.closest('.cw-slot');
      const head = e.target.closest('[data-drag-node]');
      const nodeEl = e.target.closest('.cw-node');
      const g = currentGraph(); if (!g) return;
      if (e.button === 2) return;
      // 空格/中键在任意位置都拖动画布（官方 ComfyUI 的手势）
      if (W.space || e.button === 1) {
        W.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, x: W.view.x, y: W.view.y };
        canvas.classList.add('panning'); e.preventDefault(); return;
      }
      if (slot) {
        const kind = slot.dataset.kind, node = Number(slot.dataset.node), name = slot.dataset.name;
        const slotIdx = kind === 'out' ? Number(slot.dataset.slot) : kind === 'in' ? Number(slot.dataset.slot) : 0;
        W.selection.clear(); W.selectedLink = null;
        if (kind === 'in' || kind === 'widget') {
          const t = g.nodes.find(n => n.id === node);
          const inp = (t.inputs || []).find(i => i.name === name);
          const w = (t.widgets || []).find(x => x.name === name);
          const lid = (inp && inp.link != null) ? inp.link : (w && w.link != null ? w.link : null);
          if (lid != null) {
            const l = g.links.find(x => x.id === lid);
            removeLink(g, lid);
            if (l) W.linkDrag = { from: { node: l.origin, kind: 'out', name: (g.nodes.find(n => n.id === l.origin).outputs[l.originSlot] || {}).name, slot: l.originSlot }, pos: screenToWorld(e) };
            markDirty(); renderNodes();
            if (W.linkDrag) { canvas.classList.add('linking'); e.preventDefault(); return; }
          }
        }
        W.linkDrag = { from: { node, kind, name, slot: slotIdx }, pos: screenToWorld(e) };
        canvas.classList.add('linking'); e.preventDefault(); return;
      }
      if (head && !e.target.closest('.cw-collapse')) {
        const id = Number(head.dataset.dragNode);
        if (e.shiftKey) { if (W.selection.has(id)) W.selection.delete(id); else W.selection.add(id); }
        else if (!W.selection.has(id)) W.selection = new Set([id]);
        W.selectedLink = null;
        W.drag = { type: 'node', sx: e.clientX, sy: e.clientY, origins: [...W.selection].map(i => { const n = g.nodes.find(x => x.id === i); return { id: i, x: n.pos[0], y: n.pos[1] }; }) };
        renderNodes(); e.preventDefault(); return;
      }
      if (nodeEl) { W.selection = new Set([Number(nodeEl.dataset.node)]); W.selectedLink = null; renderNodes(); return; }
      W.selection.clear(); W.selectedLink = null; renderNodes();
      W.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, x: W.view.x, y: W.view.y };
      canvas.classList.add('panning');
    });
    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      const nodeEl = e.target.closest('.cw-node');
      if (nodeEl) { showNodeMenu(e.clientX, e.clientY, Number(nodeEl.dataset.node)); return; }
      const link = e.target.closest('[data-link]');
      if (link) { const g = currentGraph(); removeLink(g, Number(link.dataset.link)); markDirty(); renderNodes(); return; }
      showSearch(e.clientX, e.clientY, screenToWorld(e));
    });
    canvas.addEventListener('dblclick', e => {
      if (e.target.closest('.cw-node')) return;
      showSearch(e.clientX, e.clientY, screenToWorld(e));
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      const before = screenToWorld(e);
      W.view.scale = clamp(W.view.scale * (e.deltaY > 0 ? 0.9 : 1.1), 0.15, 2.5);
      W.view.x = sx - before.x * W.view.scale;
      W.view.y = sy - before.y * W.view.scale;
      applyView(); drawLinks();
    }, { passive: false });

    document.addEventListener('mousemove', e => {
      if (!W.built || !W.root.classList.contains('cw-open')) return;
      if (W.linkDrag) { W.linkDrag.pos = screenToWorld(e); drawLinks(); return; }
      if (!W.drag) return;
      if (W.drag.type === 'pan') { W.view.x = W.drag.x + e.clientX - W.drag.sx; W.view.y = W.drag.y + e.clientY - W.drag.sy; applyView(); drawLinks(); }
      else if (W.drag.type === 'node') {
        const dx = (e.clientX - W.drag.sx) / W.view.scale, dy = (e.clientY - W.drag.sy) / W.view.scale;
        const g = currentGraph();
        for (const o of W.drag.origins) {
          const n = g.nodes.find(x => x.id === o.id); if (!n) continue;
          n.pos = [o.x + dx, o.y + dy];
          if (W.settings.snap) n.pos = [Math.round(n.pos[0] / 20) * 20, Math.round(n.pos[1] / 20) * 20];
          const el = document.querySelector(`.cw-node[data-node="${o.id}"]`);
          if (el) { el.style.left = n.pos[0] + 'px'; el.style.top = n.pos[1] + 'px'; }
        }
        drawLinks();
      }
    });
    document.addEventListener('mouseup', e => {
      if (!W.built) return;
      const canvas2 = $('#cw-canvas');
      if (W.drag && W.drag.type === 'node') markDirty();
      W.drag = null; canvas2.classList.remove('panning');
      if (W.linkDrag) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const slot = el && el.closest ? el.closest('.cw-slot') : null;
        if (slot) {
          const kind = slot.dataset.kind;
          connect(W.linkDrag.from, {
            kind, node: Number(slot.dataset.node), name: slot.dataset.name,
            slot: kind === 'out' ? Number(slot.dataset.slot) : 0
          });
        }
        W.linkDrag = null; canvas2.classList.remove('linking'); drawLinks();
      }
    });
    document.addEventListener('keydown', e => {
      if (!W.built || !W.root.classList.contains('cw-open')) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) || e.target.isContentEditable;
      if (e.key === 'Escape') { const m = W.root.querySelector('.cw-modal'); if (m) { m.remove(); return; } closeFloat(); if (!typing) close(); return; }
      if (typing) return;
      if (e.key === ' ') { W.space = true; e.preventDefault(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); queuePrompt(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { copySelection(); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { pasteClipboard(); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { duplicateSelection(); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        const g = currentGraph(); W.selection = new Set(g.nodes.map(n => n.id)); renderNodes(); e.preventDefault();
      } else if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); e.preventDefault(); }
      else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) { fitView(); e.preventDefault(); }
    });
    document.addEventListener('keyup', e => { if (e.key === ' ') W.space = false; });

    // 拖放 workflow.json / PNG 到画布
    const stage = $('#cw-stage');
    stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('cw-drop-hover'); });
    stage.addEventListener('dragleave', () => stage.classList.remove('cw-drop-hover'));
    stage.addEventListener('drop', e => {
      e.preventDefault(); stage.classList.remove('cw-drop-hover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]);
    });
    // 侧栏的拖放区
    root.addEventListener('dragover', e => { const d = e.target.closest('#cw-side-drop'); if (d) { e.preventDefault(); d.classList.add('hover'); } });
    root.addEventListener('drop', e => {
      const d = e.target.closest('#cw-side-drop');
      if (d) { e.preventDefault(); d.classList.remove('hover'); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); }
    });
  }
  function handleZoom(a) {
    if (a === 'in') W.view.scale = clamp(W.view.scale * 1.15, 0.15, 2.5);
    else if (a === 'out') W.view.scale = clamp(W.view.scale / 1.15, 0.15, 2.5);
    else if (a === 'fit') { fitView(); return; }
    else if (a === 'side') { $('#cw-side').classList.toggle('collapsed'); setTimeout(drawLinks, 180); return; }
    applyView(); drawLinks();
  }
  async function handleNodeAction(id, act) {
    const g = currentGraph(), n = g && g.nodes.find(x => x.id === Number(id)); if (!n) return;
    if (act === 'delete') { W.selection = new Set([n.id]); deleteSelection(); }
    else if (act === 'duplicate') { W.selection = new Set([n.id]); duplicateSelection(); }
    else if (act === 'collapse') { n.collapsed = !n.collapsed; }
    else if (act === 'mute') { n.mode = n.mode === 2 ? 0 : 2; }
    else if (act === 'bypass') { n.mode = n.mode === 4 ? 0 : 4; }
    else if (act === 'title') {
      const v = prompt('节点标题', n.title || n.type); if (v != null) n.title = v.slice(0, 60);
    } else if (act === 'inputs') {
      for (const l of g.links.filter(x => x.target === n.id).map(x => x.id)) removeLink(g, l);
    }
    markDirty(); renderNodes();
  }

  /* -------------------------------------------------------------- 动作分发 */
  async function handleAction(act, e) {
    const g = currentGraph();
    switch (act) {
      case 'close': close(); break;
      case 'new': {
        const kind = g ? currentTab().kind : 'image';
        const fresh = emptyGraph(); fresh.name = '未命名工作流';
        loadGraphInto(kind, fresh, fresh.name); fitView(); break;
      }
      case 'import': $('#cw-file').click(); break;
      case 'export': if (g) download(safeName(currentTab().name) + '.json', JSON.stringify(toUI(g), null, 2)); break;
      case 'export-api': if (g) download(safeName(currentTab().name) + '.api.json', JSON.stringify(toAPI(g), null, 2)); break;
      case 'save-draft': await saveWorkflow('draft', false); break;
      case 'save-preset': await saveWorkflow('preset', false); break;
      case 'deploy': await deployCurrent(); break;
      case 'queue': await queuePrompt(); break;
      case 'help': tutorial(); break;
      case 'refresh-queue': await refreshQueue(); break;
      case 'interrupt':
        try { await postJSON(CF('interrupt'), {}); toast('已发送中断请求'); }
        catch (err) { toast('中断失败：' + err.message, true); }
        break;
      case 'clear-queue':
        try { await postJSON(CF('queue'), { clear: true }); toast('队列已清空'); await refreshQueue(); }
        catch (err) { toast('清理失败：' + err.message, true); }
        break;
      case 'reload-defs': await loadObjectInfo(true); break;
      case 'reconnect': await refreshStatus(true); break;
      case 'validate': showValidation(); break;
      default: break;
    }
    if (e) e.stopPropagation();
  }
  async function deployCurrent() {
    const g = currentGraph(); if (!g) return;
    const v = validateGraph(g);
    if (v.missing.length) toast('提示：' + v.missing.length + ' 类节点不在当前节点库中（可能是自定义节点），仍可部署', false);
    if (!g.nodes.length) { toast('画布为空，先载入模板或导入工作流', true); return; }
    await saveWorkflow('preset', true);
  }
  function showValidation() {
    const g = currentGraph(); if (!g) return;
    const v = validateGraph(g), api = toAPI(g);
    modal('工作流校验', `<div class="cw-kv"><span>节点 / 连线</span><b>${g.nodes.length} / ${g.links.length}</b></div>
      <div class="cw-kv"><span>可提交节点</span><b>${Object.keys(api).length}</b></div>
      <div class="cw-kv"><span>未识别节点类型</span><b>${v.missing.length ? h(v.missing.join(', ')) : '无'}</b></div>
      <div class="cw-kv"><span>未连接输入</span><b>${v.errors.length}</b></div>
      ${v.errors.length ? `<p>${v.errors.slice(0, 12).map(x => '节点 #' + x.node + '：' + h(x.msg)).join('<br>')}</p>` : '<p>结构与官方 API 格式兼容，可以提交执行。</p>'}`);
  }
  function modal(title, html) {
    const f = $('#cw-float');
    const old = f.querySelector('.cw-modal'); if (old) old.remove();
    const el = document.createElement('div'); el.className = 'cw-modal';
    el.innerHTML = `<div class="cw-modal-card"><h3>${h(title)}</h3>${html}<div class="cw-modal-foot"><button class="cw-btn" data-modal-close>关闭</button></div></div>`;
    f.appendChild(el);
  }
  function tutorial() {
    modal('使用教程 · ComfyUI 工作台', `
      <h4>1 · 选择或导入工作流</h4>
      <p>在「预设工作台」里选内置模板，点「选择并上传」导入官方导出的 <code>workflow.json</code>、API 格式 <code>prompt.json</code>，或带工作流元数据的 ComfyUI 输出 PNG；也可以直接把文件拖到画布上。</p>
      <h4>2 · 像官方一样编辑</h4>
      <p>滚轮缩放，空白/中键拖动画布；右键或双击空白搜索添加节点；从输出圆点拖到输入圆点连线；拖动节点标题移动；右键节点可折叠、静音、绕过、复制。控件值可直接修改，种子旁的「随机」按钮对应官方 control_after_generate。</p>
      <h4>3 · 部署与保存</h4>
      <p>「部署」会把当前图保存为该版块（生图 / 生视频）的默认工作流，表单提交时会自动写入提示词、画幅、时长等参数。「存预设 / 存草稿」分别进入「我的预设」「保存草稿」，登录状态下同步到账号，离线时存浏览器本地。</p>
      <h4>4 · 运行</h4>
      <p>点「运行 (Queue Prompt)」或按 Ctrl+Enter：工作台按官方 <code>graphToPrompt()</code> 转成 API 格式并 POST <code>/prompt</code>，进度由 <code>/ws</code> 推送，结果在「结果」面板通过 <code>/view</code> 展示。也可「导出 API」拿去官方 ComfyUI 或自动化脚本执行。</p>
      <h4>连接 ComfyUI 服务</h4>
      <p>启动 Broker 时加 <code>--comfyui http://127.0.0.1:8188</code>（或环境变量 <code>STARSTACK_COMFYUI</code>）。平台把官方 <code>/object_info</code>、<code>/prompt</code>、<code>/ws</code>、<code>/upload/image</code>、<code>/view</code> 等路由代理到 <code>/comfyui/api/</code>，并复用登录会话鉴权。未连接时仍可用内置节点库离线编辑与导入导出。</p>
      <p style="color:var(--cw-faint)">快捷键：Delete 删除 · Ctrl+C / Ctrl+V 复制粘贴 · Ctrl+D 复制节点 · Ctrl+A 全选 · Ctrl+Enter 运行 · Esc 关闭</p>`);
  }

  /* ---------------------------------------------------------------- 网络层 */
  async function refreshStatus(force) {
    try { W.status = await apiJSON(API('status')); }
    catch (e) { W.status = { configured: false, reachable: false, active: {} }; }
    const was = W.online;
    W.online = !!W.status.reachable;
    if (W.online) {
      if (!W.objInfoLoaded || force) await loadObjectInfo(force);
      connectWS(); refreshQueue(); refreshHistory();
    } else if (was) { toast('ComfyUI 服务已断开，切换到离线编辑模式'); }
    renderFooter(); renderSide(); renderCards();
  }
  async function loadObjectInfo(force) {
    try {
      const info = await apiJSON(CF('object_info'));
      if (info && typeof info === 'object') {
        for (const [k, v] of Object.entries(info)) { W.defs[k] = v; W.inferred.delete(k); }
        W.objInfoLoaded = true;
        if (force) toast('已载入 ' + Object.keys(info).length + ' 类节点定义');
      }
    } catch (e) { if (force) toast('读取 /object_info 失败：' + e.message, true); }
    renderFooter(); renderSide();
  }
  function connectWS() {
    if (!W.online || (W.ws && (W.ws.readyState === 0 || W.ws.readyState === 1))) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try { ws = new WebSocket(proto + '://' + location.host + ROOT + '/comfyui/api/ws?clientId=' + encodeURIComponent(W.clientId)); }
    catch (e) { return; }
    W.ws = ws;
    ws.onmessage = ev => {
      if (typeof ev.data !== 'string') return;
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      handleComfyEvent(m.type, m.data || {});
    };
    ws.onclose = () => { if (W.ws === ws) W.ws = null; clearTimeout(W.wsRetry); if (W.online) W.wsRetry = setTimeout(connectWS, 4000); };
    ws.onerror = () => { /* onclose will retry */ };
  }
  function handleComfyEvent(type, d) {
    if (type === 'status') {
      W.queueRemaining = (d.status && d.status.exec_info && d.status.exec_info.queue_remaining) || (d.exec_info && d.exec_info.queue_remaining) || 0;
      renderFooter(); return;
    }
    if (type === 'execution_start') {
      W.currentPrompt = d.prompt_id; W.progress = { value: 0, max: 0 }; W.runningNode = null;
      const q = W.queue.find(x => x.id === d.prompt_id); if (q) q.state = '执行中';
      renderFooter(); renderSide(); return;
    }
    if (type === 'executing') {
      W.runningNode = d.node ? Number(d.node) : null;
      if (!d.node && d.prompt_id) W.currentPrompt = null;
      renderNodes(); renderFooter(); return;
    }
    if (type === 'progress') {
      W.progress = { value: d.value || 0, max: d.max || 0 };
      renderFooter(); if (W.sideTab === 'queue') renderSide(); return;
    }
    if (type === 'executed') { collectOutputs(d.output || {}, d.prompt_id); return; }
    if (type === 'execution_success') {
      const q = W.queue.find(x => x.id === d.prompt_id); if (q) q.state = '完成';
      W.currentPrompt = null; W.runningNode = null; renderNodes(); renderFooter(); renderSide();
      toast('生成完成，结果已加入「结果」面板');
      pollHistory(d.prompt_id); return;
    }
    if (type === 'execution_error' || type === 'execution_interrupted') {
      const q = W.queue.find(x => x.id === d.prompt_id); if (q) q.state = '失败';
      W.currentPrompt = null; W.runningNode = null; renderNodes(); renderFooter(); renderSide();
      const msg = d.exception_message || d.message || (type === 'execution_interrupted' ? '执行被中断' : '执行出错');
      toast(String(msg).slice(0, 160), true);
      modal('执行错误', `<p>${h(String(msg))}</p>${d.node_id ? `<p>节点 #${h(d.node_id)} · ${h(d.node_type || '')}</p>` : ''}`);
    }
  }
  function collectOutputs(out, promptId) {
    const keys = ['images', 'gifs', 'videos', 'audio', 'animated'];
    for (const k of keys) {
      for (const item of (out[k] || [])) {
        if (!item || !item.filename) continue;
        const rec = { filename: item.filename, subfolder: item.subfolder || '', type: item.type || 'output', prompt_id: promptId };
        if (!W.outputs.some(x => x.filename === rec.filename && x.subfolder === rec.subfolder)) W.outputs.unshift(rec);
      }
    }
    W.outputs = W.outputs.slice(0, 100);
    if (W.sideTab === 'results') renderSide();
  }
  async function refreshQueue() {
    try {
      const q = await apiJSON(CF('queue'));
      W.queueRemaining = ((q.queue_running || []).length) + ((q.queue_pending || []).length);
      for (const item of [...(q.queue_running || []), ...(q.queue_pending || [])]) {
        const id = item[1];
        if (!W.queue.some(x => x.id === id)) W.queue.unshift({ id, state: '排队中' });
      }
      renderFooter(); if (W.sideTab === 'queue') renderSide();
    } catch (e) { /* offline */ }
  }
  async function refreshHistory() {
    try {
      const hist = await apiJSON(CF('history?max_items=12'));
      for (const [id, entry] of Object.entries(hist || {})) {
        for (const o of Object.values(entry.outputs || {})) collectOutputs(o, id);
        if (!W.queue.some(x => x.id === id)) W.queue.unshift({ id, state: '完成' });
      }
      W.queue = W.queue.slice(0, 30);
      if (W.sideTab === 'results') renderSide();
    } catch (e) { /* offline */ }
  }
  async function pollHistory(promptId) {
    if (!promptId) return;
    for (let i = 0; i < 8; i++) {
      try {
        const hist = await apiJSON(CF('history/' + encodeURIComponent(promptId)));
        const entry = hist && hist[promptId];
        if (entry) {
          for (const o of Object.values(entry.outputs || {})) collectOutputs(o, promptId);
          renderSide(); return;
        }
      } catch (e) { return; }
      await new Promise(r => setTimeout(r, 1200));
    }
  }
  async function queuePrompt() {
    const g = currentGraph(); if (!g) return;
    if (!W.online) {
      toast('未连接 ComfyUI 服务：可先「导出 API」到官方工作台运行，或让服务端配置 --comfyui', true);
      renderCards(); return;
    }
    const prompt = toAPI(g);
    if (!Object.keys(prompt).length) { toast('没有可执行的输出节点', true); return; }
    try {
      // ComfyUI 校验失败时返回 400 + {error, node_errors}，必须读原始响应
      // 才能把出错节点高亮出来（postJSON 会在 !ok 时直接抛错）。
      const doFetch = nativeFetch || fetch;
      const response = await doFetch(CF('prompt'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: W.clientId, prompt,
          extra_data: { extra_pnginfo: { workflow: toUI(g) } }
        })
      });
      const res = await response.json().catch(() => ({}));
      if (!response.ok) res.error = res.error || ('HTTP ' + response.status);
      if (res.error) {
        const detail = res.node_errors ? JSON.stringify(res.node_errors).slice(0, 400) : '';
        toast('ComfyUI 拒绝执行：' + res.error, true);
        modal('工作流校验失败', `<p>${h(String(res.error))}</p><p style="word-break:break-all;color:var(--cw-faint)">${h(detail)}</p>`);
        for (const id of Object.keys(res.node_errors || {})) {
          const el = document.querySelector(`.cw-node[data-node="${id}"]`); if (el) el.classList.add('error');
        }
        return;
      }
      W.queue.unshift({ id: res.prompt_id, state: '排队中', name: currentTab().name });
      toast('已加入队列：' + String(res.prompt_id).slice(0, 12));
      W.sideTab = 'queue'; renderSide(); renderFooter();
      setTimeout(refreshQueue, 600);
    } catch (e) { toast('提交失败：' + e.message, true); }
  }

  /* ------------------------------------------------------------ 表单参数注入 */
  function applyParams(g, kind, p) {
    if (!g.nodes.length) return;
    const pos = [], neg = [];
    // 判断正负：连到采样器 negative 输入的是反向提示词，其余为正向提示词
    const negativeLinks = new Set();
    for (const sn of g.nodes.filter(x => /^KSampler/.test(x.type))) {
      for (const l of g.links.filter(x => x.target === sn.id)) {
        const inp = sn.inputs[l.targetSlot];
        if (inp && inp.name === 'negative') negativeLinks.add(l.origin);
      }
    }
    for (const n of g.nodes.filter(x => x.type === 'CLIPTextEncode'))
      (negativeLinks.has(n.id) ? neg : pos).push(n);
    const text = [p.prompt];
    if (p.style) text.push(p.style);
    if (p.motion) text.push(p.motion);
    const put = (n, v) => { const w = n.widgets.find(x => x.name === 'text' || x.name === 'prompt'); if (w) w.value = v; };
    if (pos[0]) put(pos[0], text.filter(Boolean).join('，'));
    if (neg[0] && p.negative) put(neg[0], p.negative);
    if (!pos.length && !neg.length) {
      for (const n of g.nodes) for (const w of n.widgets) {
        if (/^(text|prompt|positive_prompt|prompt_text)$/i.test(w.name) && String(w.value || '').length < 400) { w.value = text.filter(Boolean).join('，'); break; }
      }
    }
    const raw = String(p.size || '');
    // 生图选项形如「1:1 · 1024×1024」，生视频只有比例「16:9」；先取分辨率，
    // 没有分辨率时再按常见比例给一组 8 的倍数尺寸。
    const res = raw.match(/(\d{2,5})\s*[×xX*]\s*(\d{2,5})/);
    let wh = null;
    if (res) wh = { w: Number(res[1]), h: Number(res[2]) };
    else if (/16\s*:\s*9/.test(raw)) wh = { w: 1024, h: 576 };
    else if (/9\s*:\s*16/.test(raw)) wh = { w: 576, h: 1024 };
    else if (/4\s*:\s*3/.test(raw)) wh = { w: 1024, h: 768 };
    else if (/1\s*:\s*1/.test(raw)) wh = { w: 768, h: 768 };
    if (wh) wh = { w: clamp(Math.round(wh.w / 8) * 8, 16, 16384), h: clamp(Math.round(wh.h / 8) * 8, 16, 16384) };
    if (wh) {
      g.nodes.filter(n => /Latent|Empty.*Image/i.test(n.type)).forEach(n => {
        const a = n.widgets.find(x => x.name === 'width'), b = n.widgets.find(x => x.name === 'height');
        if (a) a.value = clamp(wh.w, 16, 16384);
        if (b) b.value = clamp(wh.h, 16, 16384);
      });
    }
    if (kind === 'video') {
      const secs = parseFloat(p.duration) || 5;
      const fps = 8;
      g.nodes.forEach(n => {
        for (const w of n.widgets) {
          if (w.name === 'fps' || w.name === 'frame_rate') w.value = fps;
          if (w.name === 'length') w.value = clamp(Math.round(secs * fps / 4) * 4 + 1, 1, 4096);
          if (w.name === 'batch_size' && /Latent/i.test(n.type)) w.value = clamp(Math.round(secs * fps), 1, 4096);
        }
      });
    }
    // 随机种子：与官方 Queue Prompt 的 randomize 行为一致
    for (const n of g.nodes) for (const w of n.widgets) {
      if (w.control === 'randomize' && /seed/i.test(w.name)) w.value = Math.floor(Math.random() * 4294967295);
      else if (w.control === 'increment' && /seed/i.test(w.name)) w.value = (Number(w.value) || 0) + 1;
    }
    markDirty();
  }

  /* ------------------------------------------------------- 页面内的预设卡片 */
  function cardEl(kind) { return document.querySelector('[data-cw-kind="' + kind + '"]'); }
  function initCards() {
    for (const kind of ['image', 'video']) {
      const card = cardEl(kind); if (!card) continue;
      card.addEventListener('click', e => {
        const tab = e.target.closest('[data-cw-tab]');
        if (tab) { W.cardTab[kind] = tab.dataset.cwTab; renderCards(); return; }
        if (e.target.closest('[data-cw-open]')) { open(kind); return; }
        if (e.target.closest('[data-cw-import]')) {
          const input = card.querySelector('[data-cw-file]'); if (input) input.click(); return;
        }
        if (e.target.closest('[data-cw-save]')) {
          ensureTab(kind);
          W.active = W.tabs.findIndex(t => t.kind === kind);
          saveWorkflow('draft', false, W.kindGraph[kind].name); return;
        }
        if (e.target.closest('[data-cw-help]')) { open(kind); tutorial(); return; }
        if (e.target.closest('.cw-mini')) { open(kind); return; }
        const tpl = e.target.closest('[data-card-tpl]');
        if (tpl) {
          const spec = TEMPLATE_SPECS.find(s => s.id === tpl.dataset.cardTpl); if (!spec) return;
          loadGraphInto(kind, buildTemplate(spec), spec.name);
          toast('已载入模板：' + spec.name); return;
        }
        const item = e.target.closest('[data-card-load],[data-card-deploy]');
        if (item) {
          const list = W.library.filter(x => x.kind === kind && x.scope === W.cardTab[kind]);
          const rec = list[Number(item.dataset.cardLoad ?? item.dataset.cardDeploy)];
          if (!rec) return;
          if (item.dataset.cardDeploy != null) activateSaved(rec); else loadSaved(rec);
        }
      });
      const input = card.querySelector('[data-cw-file]');
      if (input) input.addEventListener('change', e => { if (e.target.files[0]) importFile(e.target.files[0], kind); e.target.value = ''; });
      card.addEventListener('dragover', e => { if (e.target.closest('.cw-mini')) { e.preventDefault(); e.target.closest('.cw-mini').style.outline = '2px dashed #6c5ce7'; } });
      card.addEventListener('dragleave', e => { const m = e.target.closest('.cw-mini'); if (m) m.style.outline = ''; });
      card.addEventListener('drop', e => {
        const m = e.target.closest('.cw-mini');
        if (m) { e.preventDefault(); m.style.outline = ''; if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0], kind); }
      });
    }
    renderCards();
    // 页面加载即探测 ComfyUI 并读取已部署/保存的工作流，卡片无需先打开工作台。
    W.statusChecked = true;
    refreshStatus();
    loadLibrary();
    // 页面停留期间 ComfyUI 可能后启动；工作台关闭时静默刷新连接状态。
    setInterval(() => {
      if (!W.root || !W.root.classList.contains('cw-open')) refreshStatus();
    }, 60000);
  }
  function renderCards() {
    for (const kind of ['image', 'video']) {
      const card = cardEl(kind); if (!card) continue;
      const tab = W.cardTab[kind] || 'template';
      card.querySelectorAll('[data-cw-tab]').forEach(b => b.classList.toggle('on', b.dataset.cwTab === tab));
      const pane = card.querySelector('[data-cw-pane]');
      if (pane) {
        if (tab === 'template') {
          pane.innerHTML = TEMPLATE_SPECS.filter(s => s.kind === kind).map(s => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--hair,#eee)">
              <div style="min-width:0"><div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(s.name)}</div>
              <div style="font-size:10px;color:var(--mute,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(s.desc)}</div></div>
              <button class="ghost tiny" data-card-tpl="${h(s.id)}" style="white-space:nowrap">载入</button></div>`).join('');
        } else {
          const list = W.library.filter(x => x.kind === kind && x.scope === tab);
          pane.innerHTML = list.length ? list.map((x, i) => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--hair,#eee)">
              <div style="min-width:0"><div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(x.name)} ${x.active ? '<span class="cw-chip ok">已部署</span>' : ''}</div>
              <div style="font-size:10px;color:var(--mute,#888)">${x.nodes || 0} 节点 · ${new Date((x.updated_at || 0) * 1000).toLocaleDateString('zh-CN')}</div></div>
              <span style="display:flex;gap:4px;white-space:nowrap"><button class="ghost tiny" data-card-load="${i}">载入</button><button class="ghost tiny" data-card-deploy="${i}">部署</button></span></div>`).join('')
            : '<div class="cw-card-note">暂无' + (tab === 'draft' ? '草稿' : '预设') + '。在工作台里编辑后点「存预设 / 存草稿」即可出现在这里。</div>';
        }
      }
      const svg = card.querySelector('[data-cw-mini] svg');
      const empty = card.querySelector('.cw-mini-empty');
      const g = W.kindGraph[kind] || builtinTemplate(kind);
      if (!W.kindGraph[kind]) W.kindGraph[kind] = g;
      if (svg) drawMini(svg, g);
      if (empty) empty.style.display = g.nodes.length ? 'none' : 'flex';
      const info = card.querySelector('[data-cw-info]');
      if (info) info.textContent = (g.name || '未命名工作流') + ' · ' + g.nodes.length + ' 节点 / ' + g.links.length + ' 连线';
      const chips = card.querySelector('[data-cw-chips]');
      if (chips) {
        const v = validateGraph(g);
        chips.innerHTML = `<span class="cw-chip">${h(kind === 'image' ? '生图' : '生视频')}</span>
          <span class="cw-chip ${W.online ? 'ok' : 'bad'}">${W.online ? 'ComfyUI 已连接' : '离线编辑'}</span>
          ${v.missing.length ? `<span class="cw-chip bad">${v.missing.length} 类未知节点</span>` : '<span class="cw-chip ok">节点校验通过</span>'}`;
      }
      const conn = card.querySelector('[data-cw-conn]');
      if (conn) conn.textContent = W.online ? '● 服务在线' : '○ 离线';
    }
  }
  function drawMini(svg, g) {
    if (!g.nodes.length) { svg.innerHTML = ''; return; }
    const xs = g.nodes.map(n => n.pos[0]), ys = g.nodes.map(n => n.pos[1]);
    const x0 = Math.min(...xs) - 20, y0 = Math.min(...ys) - 20;
    const x1 = Math.max(...g.nodes.map(n => n.pos[0] + n.size[0])) + 20;
    const y1 = Math.max(...g.nodes.map(n => n.pos[1] + Math.max(70, n.size[1]))) + 20;
    const byId = new Map(g.nodes.map(n => [n.id, n]));
    let s = '';
    for (const l of g.links) {
      const a = byId.get(l.origin), b = byId.get(l.target); if (!a || !b) continue;
      s += `<path d="M ${a.pos[0] + a.size[0]} ${a.pos[1] + 24} C ${a.pos[0] + a.size[0] + 70} ${a.pos[1] + 24}, ${b.pos[0] - 70} ${b.pos[1] + 24}, ${b.pos[0]} ${b.pos[1] + 24}" fill="none" stroke="${colorOf(l.type)}" stroke-width="3" opacity=".75"/>`;
    }
    for (const n of g.nodes) {
      const d = getDef(n.type) || {}, c = CAT_COLOR[d.category] || '#3f5170';
      s += `<g><rect x="${n.pos[0]}" y="${n.pos[1]}" width="${n.size[0]}" height="${Math.max(62, Math.min(n.size[1], 110))}" rx="8" fill="#ffffff" stroke="#d9d6f2"/>
        <path d="M ${n.pos[0]} ${n.pos[1] + 8} a8 8 0 0 1 8 -8 h${n.size[0] - 16} a8 8 0 0 1 8 8 v16 h-${n.size[0]} z" fill="${c}"/>
        <text x="${n.pos[0] + 9}" y="${n.pos[1] + 19}" fill="#fff" font-size="10" font-family="sans-serif">${h(String(n.title || n.type).slice(0, 26))}</text>
        <text x="${n.pos[0] + 9}" y="${n.pos[1] + 42}" fill="#7a7896" font-size="9" font-family="sans-serif">${h(n.type.slice(0, 28))}</text>
        <text x="${n.pos[0] + 9}" y="${n.pos[1] + 56}" fill="#9a97b8" font-size="8" font-family="sans-serif">#${n.id} · ${n.widgets.length} widgets</text></g>`;
    }
    svg.setAttribute('viewBox', `${x0} ${y0} ${Math.max(1, x1 - x0)} ${Math.max(1, y1 - y0)}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.innerHTML = s;
  }

  /* ------------------------------------------------------------------ 外部 API */
  function open(kind, opts) {
    buildRoot();
    const t = ensureTab(kind || 'image');
    W.active = W.tabs.indexOf(t);
    W.root.classList.add('cw-open');
    document.body.style.overflow = 'hidden';
    W.sideTab = (opts && opts.side) || W.sideTab;
    W.wfScope = W.wfScope || 'template';
    renderAll();
    requestAnimationFrame(() => { fitView(); drawLinks(); });
    if (!W.statusChecked) { W.statusChecked = true; refreshStatus(); loadLibrary(); }
    else renderFooter();
    renderCards();
  }
  function close() {
    if (!W.built) return;
    W.root.classList.remove('cw-open');
    document.body.style.overflow = '';
    renderCards();
  }
  function generate(kind, params) {
    const g = graphFor(kind);
    applyParams(g, kind, params || {});
    open(kind);
    const note = document.querySelector('#cw-note-' + kind);
    if (W.online) { queuePrompt(); if (note) note.textContent = '已把参数写入工作流并提交到 ComfyUI 队列，可在此查看进度与结果。'; }
    else if (note) note.textContent = '参数已写入工作流；当前未连接 ComfyUI 服务，可在工作台导出 API 格式后到官方 ComfyUI 运行。';
  }
  window.ComfyWorkbench = {
    open, close, generate, tutorial,
    importFile: (file, kind) => importFile(file, kind || 'image'),
    refreshCards: renderCards,
    graphFor, toUI, toAPI,
    loadGraph: (kind, raw, name) => loadGraphInto(kind, parseWorkflow(typeof raw === 'string' ? raw : JSON.stringify(raw), name), name),
    deploy: deployCurrent,
    status: () => ({ online: W.online, nodes: Object.keys(W.defs).length, tabs: W.tabs.length })
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCards);
  else initCards();
})();
