import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The broker the dev server proxies to. Point it at a local server with
// STARSTACK_BROKER=http://127.0.0.1:8787 when you want to test offline.
const broker = process.env.STARSTACK_BROKER || 'http://20.24.210.119:8787'

// 桌面 exe / APK / 鸿蒙壳内嵌的是「构建期快照」，不是远程页面。
// 所以每份产物必须自带一枚构建戳：出问题时先看这枚戳对不对，
// 而不是靠回忆「上次是不是忘了重新 build」。同一份戳也写进
// dist/build.json，桌面端「关于」会把它读出来显示。
function resolveSha(): string {
  const fromCi = (process.env.GITHUB_SHA || '').slice(0, 7)
  if (fromCi) return fromCi
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'nogit'
  }
}

const STAMP = {
  pkg: 'apps/mobile',
  sha: resolveSha(),
  time: new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z',
}

function stampPlugin() {
  return {
    name: 'starstack-build-stamp',
    apply: 'build' as const,
    writeBundle(options: { dir?: string }) {
      if (!options.dir) return
      writeFileSync(join(options.dir, 'build.json'), JSON.stringify(STAMP, null, 2) + '\n')
    },
  }
}

export default defineConfig({
  root: fileURLToPath(new URL('./mobile', import.meta.url)),
  base: './',
  define: { __BUILD__: JSON.stringify(STAMP) },
  plugins: [react(), stampPlugin()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': { target: broker, changeOrigin: true } },
  },
})
