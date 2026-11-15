import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// 预览时把同源 /api 等请求代理到本地 Broker（默认模拟 Broker 8799）。
// 生产构建产物为静态资源，可内嵌或独立部署；base 用相对路径以兼容反代子路径。
const broker = process.env.STARSTACK_BROKER || 'http://127.0.0.1:8799'
const proxy = {}
for (const p of ['/api', '/download', '/launch', '/dl', '/comfy', '/v1']) {
  proxy[p] = { target: broker, changeOrigin: true }
}

// 与 apps/ 共用同一套构建戳约定：commit + 构建时间写进产物并落盘 build.json，
// 这样「web 走到哪一版、桌面/安卓内嵌的是哪一版」可以直接对比。
function resolveSha() {
  const fromCi = (process.env.GITHUB_SHA || '').slice(0, 7)
  if (fromCi) return fromCi
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'nogit'
  }
}

const STAMP = {
  pkg: 'web-react',
  sha: resolveSha(),
  time: new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z',
}

function stampPlugin() {
  return {
    name: 'starstack-build-stamp',
    apply: 'build',
    writeBundle(options) {
      if (!options.dir) return
      writeFileSync(join(options.dir, 'build.json'), JSON.stringify(STAMP, null, 2) + '\n')
    },
  }
}

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(STAMP) },
  plugins: [react(), stampPlugin()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { host: true, port: 5174, proxy },
})
