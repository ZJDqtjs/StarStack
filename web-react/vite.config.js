import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 预览时把同源 /api 等请求代理到本地 Broker（默认模拟 Broker 8799）。
// 生产构建产物为静态资源，可内嵌或独立部署；base 用相对路径以兼容反代子路径。
const broker = process.env.STARSTACK_BROKER || 'http://127.0.0.1:8799'
const proxy = {}
for (const p of ['/api', '/download', '/launch', '/dl', '/comfy', '/v1']) {
  proxy[p] = { target: broker, changeOrigin: true }
}
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { host: true, port: 5174, proxy },
})