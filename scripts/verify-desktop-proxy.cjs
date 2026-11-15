// 端到端验证桌面端反代：把 broker.txt 指向本地假 Broker，启动桌面端，
// 看 WebView 里的页面有没有把 /api 请求送到这儿来。
//
// 前置：先在 apps/desktop 构建一次
//   dotnet build StarStack.Desktop.csproj -c Release
//
// 注意：开发机上必须用 `dotnet <dll>` 启动。bin/ 里那个 exe 是 apphost，
// SDK 装在非标准路径时它找不到 Microsoft.WindowsDesktop.App 会直接退出
// （0x80008096）。分发的单文件自包含包没有这个问题。
// 可用 STARSTACK_DOTNET 指定 SDK 目录。
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')

const PORT = 18888
const SDK = process.env.STARSTACK_DOTNET || 'C:\\Users\\Administrator\\AppData\\Local\\starstack-sdk'
const DOTNET = path.join(SDK, 'dotnet.exe')
const DLL = path.join(__dirname, '..', 'apps', 'desktop', 'bin', 'Release', 'net8.0-windows', 'StarStack.Desktop.dll')

const seen = []
const srv = http.createServer((req, res) => {
  seen.push(`${req.method} ${req.url}  auth=${req.headers.authorization ? 'Bearer' : '-'}`)
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify({ signed_in: false, policy: { pending: false, public: false } }))
})

const brokerFile = path.join(process.env.LOCALAPPDATA || '', 'StarStack', 'broker.txt')
const hadFile = fs.existsSync(brokerFile)
const backup = hadFile ? fs.readFileSync(brokerFile, 'utf8') : null

function cleanup() {
  try {
    if (hadFile) fs.writeFileSync(brokerFile, backup)
    else if (fs.existsSync(brokerFile)) fs.unlinkSync(brokerFile)
  } catch (e) {}
}

srv.listen(PORT, '127.0.0.1', () => {
  fs.mkdirSync(path.dirname(brokerFile), { recursive: true })
  fs.writeFileSync(brokerFile, 'http://127.0.0.1:' + PORT)

  if (!fs.existsSync(DLL)) {
    console.log('[FAIL] 找不到 dll：' + DLL)
    srv.close(); cleanup(); process.exit(1)
  }

  const env = { ...process.env, DOTNET_ROOT: SDK }
  const child = spawn(DOTNET, [DLL], { stdio: 'ignore', detached: false, env })

  setTimeout(() => {
    console.log('=== 反代收到的请求 ===')
    console.log(seen.length ? seen.join('\n') : '(无请求 —— 反代没生效)')
    console.log('')
    if (seen.some(s => s.includes('/api/state') || s.includes('/api/me'))) {
      console.log('[OK] 页面请求已被主进程转发到 Broker（/api/state 等命中）')
    } else {
      console.log('[FAIL] 没看到 /api/state 或 /api/me，反代或页面加载有问题')
    }
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }) } catch (e) { child.kill() }
    srv.close()
    cleanup()
    process.exit(0)
  }, 12000)
})
