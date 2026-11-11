param(
  [switch]$SelfContained,
  [string]$OutDir = (Join-Path $PSScriptRoot '..\dist-desktop\win-x64')
)

$ErrorActionPreference = 'Stop'
if (-not [System.IO.Path]::IsPathRooted($OutDir)) {
  $OutDir = Join-Path $PSScriptRoot $OutDir
}
$OutDir = [System.IO.Path]::GetFullPath($OutDir)
Push-Location $PSScriptRoot
try {
  Write-Host '== 1/3 构建网页资源（apps/mobile/dist）=='
  npm --prefix .. run build
  if ($LASTEXITCODE -ne 0) { throw '网页资源构建失败' }

  if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }

  Write-Host '== 2/3 发布桌面端 =='
  # Framework-dependent by default: the target needs the .NET 8 Desktop Runtime
  # (this machine already has it). Add -SelfContained for a machine without it.
  dotnet publish StarStack.Desktop.csproj -c Release -r win-x64 --self-contained:$SelfContained -o $OutDir
  if ($LASTEXITCODE -ne 0) { throw 'dotnet publish 失败' }

  # Optional: when this machine has Go, ship the worker next to the app so the
  # first local run needs no fetch at all. Single-file builds (build.cmd, the
  # platform path) fetch it from the broker once and cache it by checksum.
  Write-Host '== 3/3 构建本机节点程序（可选）=='
  if (Get-Command go -ErrorAction SilentlyContinue) {
    Push-Location (Join-Path $PSScriptRoot '..\..')
    try {
      $env:GOOS = 'windows'
      $env:GOARCH = 'amd64'
      go build -trimpath -ldflags '-s -w' -o (Join-Path $OutDir 'starstack-worker.exe') .\cmd\worker
      if ($LASTEXITCODE -ne 0) { throw 'starstack-worker 构建失败' }
    }
    finally {
      Remove-Item Env:\GOOS -ErrorAction SilentlyContinue
      Remove-Item Env:\GOARCH -ErrorAction SilentlyContinue
      Pop-Location
    }
  }
  else {
    Write-Host '未找到 go，跳过打包 worker；桌面端首次本机运行时会从平台自动获取。'
  }

  Write-Host "完成：$OutDir"
  Write-Host '安装：powershell -ExecutionPolicy Bypass -File .\install.ps1'
}
finally {
  Pop-Location
}
