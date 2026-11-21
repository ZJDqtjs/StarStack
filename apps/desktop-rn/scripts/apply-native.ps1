$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
  $win = Join-Path (Get-Location) 'windows'
  if (-not (Test-Path $win)) {
    throw 'windows/ 还没生成：先运行 scripts/init-windows.ps1'
  }

  $vcx = Get-ChildItem $win -Recurse -Filter *.vcxproj |
    Where-Object { $_.Name -notmatch 'Package' } |
    Select-Object -First 1
  if (-not $vcx) { throw 'windows/ 下找不到 .vcxproj' }

  $dir = $vcx.Directory.FullName
  Copy-Item (Join-Path (Get-Location) 'native/StarStackDesktopModule.h') $dir -Force
  Copy-Item (Join-Path (Get-Location) 'native/StarStackDesktopModule.cpp') $dir -Force

  $xml = [IO.File]::ReadAllText($vcx.FullName)
  # 模板工程开了预编译头（Use），而本模块自己带 include，不引 pch.h；
  # 不显式 NotUsing 会报 C1010: unexpected end of file while looking for precompiled header。
  if ($xml -notmatch 'StarStackDesktopModule\.cpp') {
    $xml = $xml.Replace(
      '<ClCompile Include="AutolinkedNativeModules.g.cpp" />',
      '<ClCompile Include="AutolinkedNativeModules.g.cpp" />' + "`r`n" +
      '    <ClCompile Include="StarStackDesktopModule.cpp">' + "`r`n" +
      '      <PrecompiledHeader>NotUsing</PrecompiledHeader>' + "`r`n" +
      '    </ClCompile>'
    )
  }
  else {
    # 已经加过（自闭合写法）：补齐预编译头设置
    $xml = $xml.Replace(
      '<ClCompile Include="StarStackDesktopModule.cpp" />',
      '<ClCompile Include="StarStackDesktopModule.cpp">' + "`r`n" +
      '      <PrecompiledHeader>NotUsing</PrecompiledHeader>' + "`r`n" +
      '    </ClCompile>'
    )
  }
  if ($xml -notmatch 'StarStackDesktopModule\.h') {
    $xml = $xml.Replace(
      '<ClInclude Include="AutolinkedNativeModules.g.h" />',
      '<ClInclude Include="AutolinkedNativeModules.g.h" />' + "`r`n" +
      '    <ClInclude Include="StarStackDesktopModule.h" />'
    )
  }
  $xml = $xml.Replace(
    'shell32.lib;user32.lib;windowsapp.lib;',
    'shell32.lib;user32.lib;windowsapp.lib;winhttp.lib;comdlg32.lib;'
  )
  [IO.File]::WriteAllText($vcx.FullName, $xml, [Text.UTF8Encoding]::new($false))

  Write-Host "原生模块已写入 $dir"
  # App.cpp 模板已经用 CompReactPackageProvider + AddAttributedModules 注册工程内模块，
  # 所以新增 .h/.cpp 后不需要再改 App.cpp。
}
finally {
  Pop-Location
}
