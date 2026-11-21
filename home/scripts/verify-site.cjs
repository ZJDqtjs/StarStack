/* 欢迎页静态校验（CI 门禁，零依赖）
 * 1. HTML / CSS 引用的本地资源必须存在
 * 2. 页面下载清单必须和 release.yml 实际编译出的资产完全一致
 * 3. JS 里引用的静态 DOM id 必须能在 HTML 中找到
 * 4. 不允许 http:// 明文资源引用（混合内容）
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const pub = path.join(root, 'home', 'public');
const errors = [];
const warn = (msg) => errors.push(msg);
const read = (p) => fs.readFileSync(p, 'utf8');

const html = read(path.join(pub, 'index.html'));
const css = read(path.join(pub, 'styles.css'));
const js = read(path.join(pub, 'app.js'));
const releaseYml = read(path.join(root, '.github', 'workflows', 'release.yml'));
// 桌面端的构建步骤在独立的可复用工作流里（release.yml 只负责调用它），
// 所以产物名的检查要连这份文件一起看。
const rnwPath = path.join(root, '.github', 'workflows', 'desktop-rn.yml');
const rnwYml = fs.existsSync(rnwPath) ? read(rnwPath) : '';
const releaseAndRnw = releaseYml + '\n' + rnwYml;

// 1. 本地资源
const localRefs = new Set();
for (const m of html.matchAll(/(?:src|href)="(\.\/[^"#?]+)"/g)) localRefs.add(m[1]);
for (const m of css.matchAll(/url\(["']?(\.\/[^"')]+)["']?\)/g)) localRefs.add(m[1]);
for (const ref of localRefs) {
  const target = path.join(pub, ref.replace(/^\.\//, ''));
  if (!fs.existsSync(target)) warn(`引用了不存在的本地资源：${ref}`);
}
for (const required of ['index.html', 'styles.css', 'app.js', 'favicon.svg']) {
  if (!fs.existsSync(path.join(pub, required))) warn(`缺少站点文件：${required}`);
}

// 2. 下载清单 <-> Release 产物（四个客户端 + 六平台节点 + Broker + 校验和）
const platforms = [
  ['linux', 'amd64'], ['linux', 'arm64'],
  ['windows', 'amd64'], ['windows', 'arm64'],
  ['darwin', 'amd64'], ['darwin', 'arm64']
];
const clientAssets = [
  // 桌面端只发 RNW 原生包：旧的 WPF 套壳 StarStack.Desktop.exe 已停止发布，
  // 见 .github/workflows/release.yml 第 2 节。
  'StarStack-Desktop-RN.zip',
  // 安卓包名用 RN 版本：Capacitor 那套（旧 StarStack.apk）已废弃停发。
  'StarStack-RN.apk',
  'starstack-miniapp-source.zip',
  'starstack-harmony-source.zip'
];
const expected = new Set([
  'starstack-server-linux-amd64',
  'SHA256SUMS.txt',
  ...clientAssets,
  ...platforms.map(([os, arch]) =>
    `starstack-worker-${os}-${arch}${os === 'windows' ? '.exe' : ''}`)
]);
const listed = [...js.matchAll(/file:\s*'([^']+)'/g)].map((m) => m[1]);
const listedSet = new Set(listed);
if (listed.length !== listedSet.size) warn('app.js 的 ASSETS 清单里有重复文件名');
for (const name of expected) {
  if (!listedSet.has(name)) warn(`app.js 下载清单缺少 CI 产物：${name}`);
}
for (const name of listedSet) {
  if (!expected.has(name)) warn(`app.js 下载清单里有 CI 不会产出的文件：${name}`);
}

// release.yml 必须真的构建这些产物
//
// StarStack-RN.apk 曾经不由 CI 产出（只在本地 `npx expo run:android` 出包），
// 结果下载页那张卡片永远是 404 —— 现在 build-android job 在 CI 里跑
// Expo prebuild + assembleRelease，这里一并收紧成硬性要求。
const builtClientAssets = clientAssets;
for (const [os, arch] of platforms) {
  if (!releaseYml.includes(`${os}/${arch}`)) warn(`release.yml 缺少编译目标 ${os}/${arch}`);
}
for (const token of [
  'starstack-worker-${os}-${arch}${ext}',
  'starstack-server-linux-amd64',
  ...builtClientAssets,
  '> SHA256SUMS.txt',
  // 桌面端走 reusable workflow（desktop-rn.yml），artifact 名是 assets-desktop-rn
  'assets-desktop-rn', 'assets-android', 'assets-sources', 'dist/dl/*'
]) {
  if (!releaseAndRnw.includes(token)) warn(`release.yml / desktop-rn.yml 缺少预期片段：${token}`);
}
if (!releaseYml.includes('desktop-rn.yml')) {
  warn('release.yml 没有复用 .github/workflows/desktop-rn.yml：桌面端产物不会进 Release');
}

// 筛选 tab 的 data-group 必须能对应到实际资产分组，否则点了没反应
const groups = new Set([...js.matchAll(/group:\s*'([^']+)'/g)].map((m) => m[1]));
const tabs = [...html.matchAll(/data-group="([^"]+)"/g)].map((m) => m[1]);
for (const tab of tabs) {
  if (tab !== 'all' && !groups.has(tab)) warn(`下载筛选按钮 data-group="${tab}" 没有对应资产`);
}
for (const group of groups) {
  if (!tabs.includes(group)) warn(`资产分组 "${group}" 缺少对应的筛选按钮`);
}

// 3. 静态 DOM id
const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const jsIds = new Set();
for (const m of js.matchAll(/document\.getElementById\('([^']+)'\)/g)) jsIds.add(m[1]);
for (const m of js.matchAll(/\bel\('([^']+)'\)/g)) jsIds.add(m[1]);
for (const id of jsIds) {
  if (!htmlIds.has(id)) warn(`app.js 引用了 HTML 中不存在的 id：${id}`);
}

// 4. 明文资源
for (const m of html.matchAll(/(?:src|href)="(http:\/\/[^"]+)"/g)) warn(`存在明文 http 资源引用：${m[1]}`);

if (errors.length) {
  console.error('欢迎页校验失败：');
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log(`欢迎页校验通过：${localRefs.size} 个本地资源、${listed.length} 个下载资产、${jsIds.size} 个 DOM id 均一致。`);
