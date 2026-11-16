$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
  $raw = (node -v).Trim()
  $major = [int](($raw.TrimStart('v').Split('.'))[0])
  if ($major -lt 22) {
    throw "RN 0.84 / RNW 0.84 需要 Node 22+，当前是 $raw。请在构建节点 84 上切换到 Node 22。"
  }

  Write-Host '== 1/2 安装 JS 依赖 =='
  if (-not (Test-Path 'node_modules')) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }
  }

  Write-Host '== 2/2 生成 windows/（RNW 0.84.2）=='
  # RNW 的 init CLI 最新稳定是 0.85.x，但 --version 决定真正的 RNW 包版本。
  npx react-native-windows-init@0.85.1 --version 0.84.2 --language cpp --overwrite --telemetry false
  if ($LASTEXITCODE -ne 0) { throw 'react-native-windows-init 失败' }

  Write-Host ''
  Write-Host 'windows/ 已生成。接下来：'
  Write-Host '1. 把 native/README.md 里的 StarStackDesktop 模块加到 windows/StarStackDesktop/；'
  Write-Host '2. 在 PackageProviders 里注册该模块；'
  Write-Host '3. 把 starstack-worker.exe 放到 exe 同目录（或设置 STARSTACK_WORKER 指向它）；'
  Write-Host '4. npx react-native run-windows'
}
finally {
  Pop-Location
}
