import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 独立管理控制台：新端口 :5175、新页面 admin.html、独立 admin token 认证。
// 与用户控制台 (:5174) 完全分离；/api 代理到 Broker，管理面走 /api/admin/*。
const broker = process.env.STARSTACK_BROKER || 'http://127.0.0.1:8799'
const proxy = {}
for (const p of ['/api', '/download', '/launch', '/dl', '/comfy', '/v1']) {
  proxy[p] = { target: broker, changeOrigin: true }
}
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'admin-root-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/' || req.url === '/index.html') { res.statusCode = 302; res.setHeader('Location', '/admin.html'); res.end(); return }
          next()
        })
      },
    },
  ],
  build: { outDir: 'dist-admin', emptyOutDir: true, rollupOptions: { input: 'admin.html' } },
  server: { host: true, port: 5175, proxy },
})