#!/usr/bin/env node
/**
 * 多端契约检查（按 L0 能力清单，不按视图数量）。
 *
 * 前提（2026-11-21 修订）：
 *   - web-react 是唯一全功能控制台；
 *   - 手机端（Android）用 apps/mobile-rn（RN + Kotlin 前台 Service，同时是算力节点）；
 *   - 桌面端用 apps/desktop-rn（RNW 原生）；鸿蒙用 apps/harmony（ArkWeb 壳，内嵌
 *     web-react/dist）；Capacitor 时代那套（apps/mobile、apps/android）与 WPF 套壳
 *     （apps/desktop）都已从仓库删除，只在 git 历史里。
 *
 * 本脚本守两件事：
 *   1. L0 交易主链（登录/余额/提交/进度/下载/账单）在所有「在用端」上不能断。
 *   2. 还内嵌网页的端（鸿蒙壳）必须仍从 web-react/dist 取，构建戳不能丢。
 *
 * 用法：
 *   node scripts/verify-console-sync.cjs
 *   node scripts/verify-console-sync.cjs --strict   # 警告也判失败
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const STRICT = process.argv.includes('--strict')

const problems = []
const warnings = []

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

// ── L0 交易主链定义 ──────────────────────────────────────────────
// 判定依据是「UI 层真的调了什么」，不是「API 层定义了什么」：
// 能力只有出现在界面上，用户才算用得到。
const L0 = [
  {
    key: 'auth',
    label: '登录/注册',
    hit: (t) => t.some((x) => x.startsWith('/api/auth') || x === 'login' || x === 'register'),
  },
  {
    key: 'balance',
    label: '余额/账户',
    // state() 也会带回 me（RN 的 App.tsx 就走这条路），不能只认 me()
    hit: (t) => t.some((x) => x === '/api/me' || x === 'me' || x === '/api/state' || x === 'state'),
  },
  {
    key: 'submit',
    label: '提交任务',
    hit: (t) =>
      t.some(
        (x) =>
          x === '/api/jobs/render' ||
          x === '/api/jobs/build' ||
          /^(submitTranscode|submitRender|submitBuild)$/.test(x)
      ),
  },
  {
    key: 'track',
    label: '任务进度',
    // 封装层通常长成 api.jobs()，方法名同样算数
    hit: (t) => t.some((x) => x === '/api/jobs' || x === 'jobs'),
  },
  {
    key: 'download',
    label: '下载产物',
    hit: (t) => t.some((x) => x.startsWith('/download/') || x === 'downloadUrl'),
  },
  {
    key: 'bill',
    label: '账单流水',
    hit: (t) => t.some((x) => x === '/api/ledger' || x === 'ledger'),
  },
]

// ── 端清单 ──────────────────────────────────────────────────────
const CLIENTS = [
  {
    id: 'web',
    name: 'web-react',
    roots: ['web-react/src/views', 'web-react/src/App.jsx', 'web-react/src/store.jsx'],
    status: 'active',
    role: '全功能控制台（含 L1/L3）',
  },
  {
    id: 'rn',
    name: 'RN 安卓',
    roots: ['apps/mobile-rn/src/screens', 'apps/mobile-rn/App.tsx'],
    status: 'active',
    role: '手机端唯一形态 + 常驻算力节点',
  },
  {
    id: 'miniapp',
    name: '微信小程序',
    roots: ['apps/miniapp/pages'],
    status: 'active',
    role: '遥控器（L0 子集）',
  },
  {
    id: 'embed',
    name: '内嵌单页',
    roots: ['internal/hub/web/index.html'],
    status: 'active',
    role: 'Broker 自带自检页',
  },
]

const TOKEN_RE = /\/api\/[a-zA-Z0-9_/-]+|\/download\/[a-zA-Z0-9_-]*/g
const CALL_RE = /(?:api|core|node|Api)\.([a-zA-Z]+)/g

function walk(dir, out) {
  if (!fs.existsSync(dir)) return
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.(js|jsx|ts|tsx|html)$/.test(ent.name)) out.push(p)
  }
}

function tokensOf(client) {
  const files = []
  for (const root of client.roots) {
    const abs = path.join(ROOT, root)
    if (!fs.existsSync(abs)) continue
    if (fs.statSync(abs).isDirectory()) walk(abs, files)
    else files.push(abs)
  }
  const set = new Set()
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(TOKEN_RE)) set.add(m[0])
    for (const m of src.matchAll(CALL_RE)) set.add(m[1])
  }
  return set
}

// ── 1. L0 矩阵 ─────────────────────────────────────────────────
const matrix = CLIENTS.map((c) => {
  const tokens = tokensOf(c)
  const cells = L0.map((item) => item.hit([...tokens]))
  return { client: c, cells, covered: cells.filter(Boolean).length }
})

// ── 2. 交付形态的界面来源是否唯一 ──────────────────────────────
// 桌面端已经是 RNW 原生（不再内嵌网页），仓库里唯一还内嵌 web-react/dist 的是
// 鸿蒙 ArkWeb 壳；那条同步链必须仍然指向 web-react。
function checkDeprecatedBleed() {
  if (exists('apps/scripts/sync-harmony.cjs')) {
    const sh = read('apps/scripts/sync-harmony.cjs')
    if (!sh.includes("'web-react', 'dist'")) {
      problems.push('sync-harmony.cjs 的同步源不是 web-react/dist，鸿蒙壳会拿到来源不明的界面')
    }
  }

  // 桌面端现在只发 RNW 原生包（apps/desktop-rn）；release.yml 必须真的调用那份工作流，
  // 否则下载页会把桌面那张卡标成「该版本未包含」。
  if (exists('.github/workflows/release.yml')) {
    const rel = read('.github/workflows/release.yml')
    if (!rel.includes('desktop-rn.yml')) {
      problems.push('release.yml 没有复用 .github/workflows/desktop-rn.yml：桌面端产物不会进 Release')
    }
  }

  const rawStamp = 'apps/harmony/entry/src/main/resources/rawfile/web/build.json'
  if (exists('apps/harmony/entry/src/main/resources/rawfile/web') && !exists(rawStamp)) {
    warnings.push('鸿蒙 rawfile/web 没有 build.json：里面是改造前的旧产物，重跑 sync:harmony 才会带戳')
  }
}

// ── 3. 构建戳契约 ───────────────────────────────────────────────
function checkBuildStamp(rel) {
  if (!exists(rel)) {
    problems.push(`${rel} 不存在，无法确认构建戳注入`)
    return
  }
  const src = read(rel)
  const hasDefine = src.includes('__BUILD__')
  const hasJson = src.includes('build.json')
  if (!hasDefine || !hasJson) {
    problems.push(
      `${rel} 缺少构建戳：define __BUILD__ ${hasDefine ? '' : '[缺失]'}、落盘 build.json ${hasJson ? '' : '[缺失]'}`
    )
  }
}

checkDeprecatedBleed()
checkBuildStamp('web-react/vite.config.js')

// ── 输出 ───────────────────────────────────────────────────────
const pad = (s, n) => {
  const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)
  return s + ' '.repeat(Math.max(1, n - w))
}

console.log('多端 L0 契约检查')
console.log('='.repeat(66))
console.log(pad('端', 24) + L0.map((l) => pad(l.label, 9)).join('') + '结论')
console.log('-'.repeat(66))
for (const row of matrix) {
  const mark = (ok) => (ok ? '●' : '○')
  const suffix = row.covered === L0.length ? '通过' : `缺 ${L0.length - row.covered} 项`
  console.log(
    pad(row.client.name + (row.client.status === 'deprecated' ? ' *' : ''), 24) +
      row.cells.map((c) => pad(mark(c), 9)).join('') +
      suffix
  )
}
console.log('-'.repeat(66))
console.log('')

for (const w of warnings) console.log(`[WARN] ${w}`)
for (const p of problems) console.log(`[FAIL] ${p}`)

const broken = matrix.filter((r) => r.client.status === 'active' && r.covered < L0.length)
if (!broken.length) {
  console.log('[OK] 所有在用端的 L0 交易主链完整。')
} else {
  for (const r of broken) {
    const miss = L0.filter((l, i) => !r.cells[i]).map((l) => l.label)
    console.log(`[GAP ] ${r.client.name} 缺：${miss.join('、')}`)
  }
}

if (problems.length) process.exit(1)
if (STRICT && warnings.length) {
  console.log('')
  console.log('[FAIL] --strict：警告视为失败。')
  process.exit(1)
}
