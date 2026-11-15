#!/usr/bin/env node
/**
 * 多端契约检查（按 L0 能力清单，不按视图数量）。
 *
 * 前提（2026-11-15 修订）：
 *   - web-react 是唯一全功能控制台；
 *   - 手机端（Android）用 apps/mobile-rn（RN + Kotlin 前台 Service，同时是算力节点），
 *     鸿蒙同理不再走 Capacitor 时代那套；
 *   - apps/mobile + apps/android(Capacitor) 已废弃，但 exe 与鸿蒙壳仍在内嵌它的产物。
 *
 * 本脚本守三件事：
 *   1. L0 交易主链（登录/余额/提交/进度/下载/账单）在所有「在用端」上不能断。
 *   2. 废弃 UI 不能继续给交付形态供血（exe 内嵌路径、鸿蒙 rawfile、Capacitor 工程、发布流水线）。
 *   3. 各端产物必须带构建戳，否则无法判断壳里的网页是哪一版。
 *
 * 用法：
 *   node scripts/verify-console-sync.cjs
 *   node scripts/verify-console-sync.cjs --strict   # 警告也判失败
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

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
  {
    id: 'mobile',
    name: 'apps/mobile',
    roots: ['apps/mobile/src/views', 'apps/mobile/src/App.tsx'],
    status: 'deprecated',
    role: '已废弃（Capacitor 时代产物，无交付形态引用）',
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

// ── 2. 废弃 UI 是否仍在给交付形态供血 ──────────────────────────
function checkDeprecatedBleed() {
  const csproj = read('apps/desktop/StarStack.Desktop.csproj')
  const embedsWebReact = csproj.includes('web-react\\dist') || csproj.includes('web-react/dist')
  if (csproj.includes('..\\mobile\\dist') || csproj.includes('../mobile/dist')) {
    problems.push(
      'desktop 仍内嵌 ..\\mobile\\dist —— 那是已废弃的 UI。exe 必须内嵌 web-react/dist。'
    )
  } else if (!embedsWebReact) {
    problems.push('desktop csproj 既没内嵌 mobile/dist 也没内嵌 web-react/dist：exe 的界面来源不明')
  }
  if (!csproj.includes('build.json')) {
    problems.push('desktop csproj 缺少 build.json 门禁，旧产物会被静默打进 exe')
  }

  if (exists('apps/capacitor.config.ts')) {
    const cap = read('apps/capacitor.config.ts')
    if (cap.includes("webDir: 'mobile/dist'")) {
      warnings.push(
        'capacitor.config.ts 仍指向 mobile/dist。Capacitor 已废弃：要么删掉该工程，' +
          '要么把 webDir 改到 web-react/dist，否则误跑 apk 脚本会产出废弃界面。'
      )
    }
  }

  if (exists('apps/scripts/sync-harmony.cjs')) {
    const sh = read('apps/scripts/sync-harmony.cjs')
    if (sh.includes("'mobile', 'dist'")) {
      problems.push(
        'sync-harmony.cjs 仍从 mobile/dist 同步到鸿蒙 rawfile —— 鸿蒙会拿到废弃界面。' +
          '应改为 web-react/dist 后重跑 npm run sync:harmony。'
      )
    } else if (!sh.includes("'web-react', 'dist'")) {
      problems.push('sync-harmony.cjs 的同步源既不是 mobile/dist 也不是 web-react/dist，请确认')
    }
  }

  if (exists('.github/workflows/release.yml')) {
    const rel = read('.github/workflows/release.yml')
    if (rel.includes('assembleDebug') || rel.includes('apk.sh')) {
      warnings.push(
        'release.yml 仍在构建 Capacitor APK 并随 Release 发布 —— 这是废弃的安卓包，' +
          '与 RN 的 APK 同名，用户会下错。'
      )
    }
    if (!rel.includes('web-react-dist')) {
      warnings.push('release.yml 没有构建 web-react 产物（web-react-dist），exe 会拿不到内嵌网页')
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

function checkEmbeddedDist() {
  if (!exists('apps/desktop/StarStack.Desktop.csproj')) return
  const csproj = read('apps/desktop/StarStack.Desktop.csproj')
  if (!csproj.includes('web-react\\dist') && !csproj.includes('web-react/dist')) return
  if (!exists('web-react/dist')) return // CI 在构建前跑本脚本，产物正常不存在
  if (!exists('web-react/dist/build.json')) {
    problems.push('exe 要内嵌的 web-react/dist 没有 build.json：旧产物，构建会被门禁拦下')
    return
  }
  const stamp = JSON.parse(read('web-react/dist/build.json'))
  let head = ''
  try {
    head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {}
  if (head && stamp.sha !== head) {
    warnings.push(`exe 要内嵌的 web-react/dist 构建于 ${stamp.sha}，当前 HEAD 是 ${head}（旧产物）`)
  }
}

checkDeprecatedBleed()
checkBuildStamp('apps/vite.config.ts')
checkBuildStamp('web-react/vite.config.js')
checkEmbeddedDist()

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
console.log('* 已废弃：不再被任何交付形态内嵌，保留仅作历史对照')
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
