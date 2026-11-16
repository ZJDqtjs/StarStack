$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
  Write-Host '== 1/4 安装 JS 依赖 =='
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }

  Write-Host '== 2/4 打 JS bundle =='
  npm run harmony
  if ($LASTEXITCODE -ne 0) { throw 'bundle-harmony 失败' }

  Write-Host '== 3/4 ohpm + hvigor =='
  Push-Location (Join-Path (Get-Location) 'harmony')
  try {
    ohpm install
    if ($LASTEXITCODE -ne 0) { throw 'ohpm install 失败' }
    hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'hvigorw assembleHap 失败' }
  }
  finally {
    Pop-Location
  }

  Write-Host '== 4/4 收集 HAP =='
  $hap = Get-ChildItem (Join-Path (Get-Location) 'harmony\entry\build') -Recurse -Filter *.hap |
    Select-Object -First 1
  if (-not $hap) { throw '找不到 HAP（检查 DevEco 签名配置）' }
  $out = Join-Path (Get-Location) 'out'
  New-Item -ItemType Directory -Force $out | Out-Null
  Copy-Item $hap.FullName (Join-Path $out 'StarStackHarmony.hap') -Force
  Write-Host "完成：$out"
}
finally {
  Pop-Location
}
