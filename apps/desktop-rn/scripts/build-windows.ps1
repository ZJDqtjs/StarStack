$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
  Write-Host '== 1/4 安装 JS 依赖 =='
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }

  Write-Host '== 2/4 生成 windows/ 并接入原生模块 =='
  & (Join-Path $PSScriptRoot 'init-windows.ps1')

  Write-Host '== 3/4 RNW 构建（x64 Debug）=='
  npx react-native run-windows --no-launch --arch x64 --logging
  if ($LASTEXITCODE -ne 0) { throw 'run-windows 失败' }

  Write-Host '== 4/4 收集产物 =='
  $exe = Get-ChildItem (Join-Path (Get-Location) 'windows') -Recurse -Filter StarStackDesktop.exe |
    Where-Object { $_.FullName -notmatch '\\obj\\' } |
    Select-Object -First 1
  if (-not $exe) { throw '找不到 StarStackDesktop.exe' }

  $out = Join-Path (Get-Location) 'out'
  New-Item -ItemType Directory -Force $out | Out-Null
  Copy-Item $exe.FullName (Join-Path $out 'StarStackDesktop.exe') -Force

  $worker = Join-Path (Get-Location) '..\..\bin\starstack-worker.exe'
  if (-not (Test-Path $worker)) {
    Push-Location (Join-Path (Get-Location) '..\..')
    try {
      $env:GOOS = 'windows'
      $env:GOARCH = 'amd64'
      go build -trimpath -ldflags '-s -w' -o (Join-Path $out 'starstack-worker.exe') .\cmd\worker
      if ($LASTEXITCODE -ne 0) { throw 'starstack-worker 构建失败' }
    }
    finally {
      Remove-Item Env:\GOOS -ErrorAction SilentlyContinue
      Remove-Item Env:\GOARCH -ErrorAction SilentlyContinue
      Pop-Location
    }
  }
  else {
    Copy-Item $worker (Join-Path $out 'starstack-worker.exe') -Force
  }

  Write-Host "完成：$out"
}
finally {
  Pop-Location
}
