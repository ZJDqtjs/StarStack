/* ComfyUI 工作台的纯逻辑回归检查（无需浏览器 / 无需 ComfyUI 服务）。
 * 用最小 DOM stub 载入内嵌脚本，验证内置模板、UI↔API 往返与 API 导入。
 * 运行：node scripts/verify-comfy-workbench.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const file = path.join(__dirname, '..', 'internal', 'hub', 'web', 'assets', 'comfy.js');
const noop = () => {};
const fakeEl = () => ({
  style: {}, dataset: {}, innerHTML: '', textContent: '', value: '', className: '',
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  appendChild: noop, removeChild: noop, remove: noop,
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener: noop, setAttribute: noop, focus: noop, setSelectionRange: noop, click: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600 })
});
const body = Object.assign(fakeEl(), { style: {} });
const sandbox = {
  console, setTimeout, clearTimeout, URL, TextDecoder, TextEncoder,
  Blob: class {}, navigator: {},
  document: {
    currentScript: { src: 'http://local/assets/comfy.js' },
    readyState: 'loading',
    addEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: fakeEl, body, documentElement: { dataset: {} }
  },
  location: { pathname: '/', protocol: 'http:', host: 'local' },
  localStorage: { getItem: () => null, setItem: noop },
  fetch: async () => ({ ok: true, text: async () => '{}' }),
  CSS: { escape: s => String(s) }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });

const CW = sandbox.window.ComfyWorkbench;
assert(CW, 'ComfyWorkbench 未导出');

function checkPrompt(kind, prompt, label) {
  assert(Object.keys(prompt).length > 0, label + '：没有可执行节点');
  for (const [id, node] of Object.entries(prompt)) {
    assert(node.class_type, label + '：节点 ' + id + ' 缺少 class_type');
    for (const [key, v] of Object.entries(node.inputs)) {
      if (Array.isArray(v)) {
        assert(prompt[v[0]], `${label}：节点 ${id}.${key} 指向不存在的节点 ${v[0]}`);
        assert.strictEqual(typeof v[0], 'string', label + '：节点引用必须是字符串 id');
      }
    }
  }
}

for (const kind of ['image', 'video']) {
  const g = CW.graphFor(kind);
  assert(g.nodes.length >= 6 && g.links.length >= 8, kind + '：默认模板不完整');
  const api = CW.toAPI(g);
  checkPrompt(kind, api, kind + ' 默认模板');
  const ui = CW.toUI(g);
  assert(Array.isArray(ui.nodes) && Array.isArray(ui.links), kind + '：UI 格式结构错误');
  assert.strictEqual(ui.nodes.length, g.nodes.length, kind + '：UI 节点数不一致');
  assert.strictEqual(ui.links.length, g.links.length, kind + '：UI 连线数不一致');

  // UI 导出 → 重新导入 → API 导出，结果必须与原来完全一致
  CW.loadGraph(kind, ui, '往返测试');
  const back = CW.toAPI(CW.graphFor(kind));
  assert.deepStrictEqual(back, api, kind + '：UI 往返后 API 提示词发生了变化');

  // API 格式导入（官方 "Export (API Format)" 的文件）
  CW.loadGraph(kind, api, 'API 导入测试');
  const imported = CW.toAPI(CW.graphFor(kind));
  checkPrompt(kind, imported, kind + ' API 导入');
  assert.strictEqual(Object.keys(imported).length, Object.keys(api).length,
    kind + '：API 导入丢失节点');
  console.log(`[ok] ${kind}: ${g.nodes.length} 节点 / ${g.links.length} 连线，` +
    `${Object.keys(api).length} 个可执行节点，UI/API 往返一致`);
}

// 带 workflow 包装的 UI 格式（PNG 元数据 / 分享链接常见形态）
CW.loadGraph('image', { workflow: CW.toUI(CW.graphFor('video')), prompt: {} }, 'wrapper');
assert(CW.graphFor('image').nodes.length >= 6, 'workflow 包装解析失败');

// 外部真实工作流样本：deploy/comfy-split 的 UI 与 API 格式
const split = path.join(__dirname, '..', 'deploy', 'comfy-split');
for (const f of ['main_h3_latent.json', 'last_prompt.json']) {
  const p = path.join(split, f);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, 'utf8');
  const raw = JSON.parse(text);
  const expected = raw.links ? raw.links.length
    : Object.values(raw).reduce((n, node) => n + Object.values((node && node.inputs) || {})
      .filter(v => Array.isArray(v) && v.length === 2 && Number.isInteger(v[1])).length, 0);
  CW.loadGraph('video', text, f);
  const g = CW.graphFor('video');
  const api = CW.toAPI(g);
  assert(g.nodes.length > 0, f + '：未解析出节点');
  assert.strictEqual(g.links.length, expected, `${f}：连线丢失（应为 ${expected}，实际 ${g.links.length}）`);
  checkPrompt('video', api, f);
  console.log(`[ok] ${f}: ${g.nodes.length} 节点 / ${g.links.length} 连线 → ${Object.keys(api).length} 个可执行节点`);
}

console.log('ComfyUI 工作台逻辑检查全部通过');
