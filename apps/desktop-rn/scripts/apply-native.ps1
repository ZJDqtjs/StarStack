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

  # 窗口标题：模板写死成 "StarStackDesktop"，任务栏上看着像工程名。
  # 只换 Title，ComponentName 必须保持与 app.json 的 name 一致，不能动。
  $cpp = Join-Path $dir 'StarStackDesktop.cpp'
  if (Test-Path $cpp) {
    $code = [IO.File]::ReadAllText($cpp)
    if ($code -match 'appWindow\.Title\(L"StarStackDesktop"\)') {
      $code = $code.Replace('appWindow.Title(L"StarStackDesktop")', 'appWindow.Title(L"星栈算力")')
      # 带 BOM 写回，MSVC 才能正确识别中文字面量
      [IO.File]::WriteAllText($cpp, $code, [Text.UTF8Encoding]::new($true))
      Write-Host '窗口标题已改为「星栈算力」'
    }
  }

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
