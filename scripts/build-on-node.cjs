#!/usr/bin/env node
/**
 * 把多端源码打成 zip，提交 /api/jobs/build，指定构建节点（默认 84），
 * 轮询任务完成后下载 result.zip 并解压。
 *
 * 用法（在 starstack 根目录）：
 *   $env:STARSTACK_BROKER='https://starstack.run'
 *   $env:STARSTACK_USER='<账号>'
 *   $env:STARSTACK_PASSWORD='<口令>'
 *   node scripts/build-on-node.cjs desktop
 *   node scripts/build-on-node.cjs harmony
 *
 * 可选：STARSTACK_NODE_ID（默认 84）、STARSTACK_TIMEOUT（默认 3600 秒）。
 * 账号需要 broker 的 --allow-build 白名单；节点 84 必须在线且接受编译任务。
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const KIND = (process.argv[2] || '').trim()
const BROKER = (process.env.STARSTACK_BROKER || 'https://starstack.run').replace(/\/+$/, '')
const USER = process.env.STARSTACK_USER || ''
const PASS = process.env.STARSTACK_PASSWORD || ''
const NODE_ID = process.env.STARSTACK_NODE_ID || '84'
const TIMEOUT = process.env.STARSTACK_TIMEOUT || '3600'

const BUILDS = {
  desktop: {
    command: 'powershell -NoProfile -ExecutionPolicy Bypass -File apps/desktop-rn/scripts/build-windows.ps1',
    output: 'apps/desktop-rn/out',
  },
  harmony: {
    command: 'powershell -NoProfile -ExecutionPolicy Bypass -File apps/harmony-rn/scripts/build-harmony.ps1',
    output: 'apps/harmony-rn/out',
  },
}

function fail(msg) {
  console.error('[build] ' + msg)
  process.exit(1)
}

if (!BUILDS[KIND]) fail('用法：node scripts/build-on-node.cjs desktop|harmony')
if (!USER || !PASS) {
  fail('需要 STARSTACK_USER / STARSTACK_PASSWORD（或先设置环境变量）；构建账号必须在 --allow-build 白名单里')
}

async function api(pathName, opts = {}, token) {
  const headers = new Headers(opts.headers || {})
  if (token) headers.set('Authorization', 'Bearer ' + token)
  const res = await fetch(BROKER + pathName, { ...opts, headers })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // 非 JSON：交给调用方按 text 处理
  }
  if (!res.ok) throw new Error((data && data.error) || text || 'HTTP ' + res.status)
  return data
}

function zipSources() {
  const out = path.join(ROOT, 'build-output')
  fs.mkdirSync(out, { recursive: true })
  const zip = path.join(out, 'starstack-multiclient-src.zip')
  if (fs.existsSync(zip)) fs.rmSync(zip, { force: true })
  console.log('[build] 打包源码（排除 node_modules/windows/oh_modules/build/dist）…')
  execFileSync(
    'tar',
    [
      '-a',
      '-c',
      '-f',
      zip,
      '--exclude=node_modules',
      '--exclude=windows',
      '--exclude=oh_modules',
      '--exclude=build',
      '--exclude=dist',
      '--exclude=.git',
      'apps',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  )
  return zip
}

async function main() {
  console.log('[build] broker=' + BROKER + ' node=' + NODE_ID + ' kind=' + KIND)
  const login = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: USER, password: PASS }),
  })
  const token = login.token
  if (!token) fail('登录响应里没有 token')

  const state = await api('/api/state', {}, token)
  const node = (state.workers || []).find((w) => String(w.id) === String(NODE_ID))
  if (!node) {
    fail(`账号看不到节点 ${NODE_ID}；确认节点存在且属于该账号（或在市场里可见）`)
  }
  console.log('[build] 节点 ' + NODE_ID + ' online=' + !!node.online + ' os=' + (node.os || '?') + ' active=' + (node.active || 0) + '/' + (node.slots || 0))
  if (!node.online) fail('节点 ' + NODE_ID + ' 不在线')

  const zip = zipSources()
  const spec = BUILDS[KIND]
  const fd = new FormData()
  fd.set('file', new Blob([fs.readFileSync(zip)]), 'sources.zip')
  fd.set('command', spec.command)
  fd.set('output', spec.output)
  fd.set('timeout', TIMEOUT)
  fd.set('req', JSON.stringify({ node_id: String(NODE_ID) }))

  const sub = await api('/api/jobs/build', { method: 'POST', body: fd }, token)
  const jobId = sub.id
  console.log('[build] 已提交 job=' + jobId + ' 预扣=' + sub.hold + ' 点')

  let job = null
  for (;;) {
    await new Promise((r) => setTimeout(r, 8000))
    const d = await api('/api/jobs', {}, token)
    job = (d.jobs || []).find((j) => j.id === jobId)
    if (!job) continue
    const done = (job.segs || []).filter((s) => s.status === 'done').length
    console.log('[build] ' + job.status + ' · ' + done + '/' + (job.segs || []).length + (job.note ? ' · ' + job.note : ''))
    if (['done', 'failed', 'cancelled'].includes(job.status)) break
  }

  if (job.status !== 'done') {
    try {
      const logs = await api('/api/jobs/' + encodeURIComponent(jobId) + '/logs', {}, token)
      console.error(JSON.stringify(logs, null, 2).slice(0, 8000))
    } catch {
      // 日志不可读时只保留状态
    }
    fail('构建任务 ' + job.status + '：' + (job.err || job.note || ''))
  }

  const res = await fetch(BROKER + '/download/' + encodeURIComponent(jobId), {
    headers: { Authorization: 'Bearer ' + token },
  })
  if (!res.ok) fail('下载产物失败 HTTP ' + res.status)
  const outDir = path.join(ROOT, 'build-output', KIND + '-' + jobId)
  fs.mkdirSync(outDir, { recursive: true })
  const resultZip = path.join(ROOT, 'build-output', KIND + '-' + jobId + '.zip')
  fs.writeFileSync(resultZip, Buffer.from(await res.arrayBuffer()))
  console.log('[build] 产物：' + resultZip)
  execFileSync('tar', ['-xf', resultZip, '-C', outDir], { stdio: 'inherit' })
  console.log('[build] 解压：' + outDir)
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)))
