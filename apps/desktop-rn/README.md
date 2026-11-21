# 星栈算力 · Windows 桌面端（RNW）

React Native Windows 原生桌面端，**不是 WebView 套壳**。UI、`api/agent/theme/ui/screens`
与 `apps/mobile-rn` 共用；平台能力由 `src/platform-win.tsx` 注入。

## 版本

| 包 | 版本 |
|---|---|
| react-native | 0.84.1 |
| react-native-windows | 0.84.2 |
| react | 19.2.3 |

选 0.84 是为了和鸿蒙 RNOH 0.84.6 共用同一个 RN 版本；Android 仍是 Expo 58 / RN 0.88，
只共享 TS/TSX 源码，不共享 `node_modules`。

## 目录

```
apps/desktop-rn/
  App.tsx                 桌面壳：左侧导航 + 窗口标题栏 + 共享 screens
  src/platform-win.tsx    Platform 实现：文件对话框、下载、starstack-worker.exe
  native/                 原生模块契约与实现要点（在节点 84 生成 windows/ 后接入）
  scripts/init-windows.ps1  在节点 84 生成 windows/ 并提示接入步骤
  metro.config.js         watchFolders: ../mobile-rn；强制用本工程的 React/RN/SVG
```

## 在节点 84 构建

```powershell
cd apps/desktop-rn
powershell -ExecutionPolicy Bypass -File scripts/init-windows.ps1
npx react-native run-windows
```

前置：Node 22、PowerShell 7（`pwsh`）、.NET SDK 8+、VS2022（Desktop development with C++ +
Windows 10/11 SDK）、`starstack-worker.exe` 放在 exe 同目录（或设置 `STARSTACK_WORKER`）。

RNW 0.76+ 的 `react-native-windows-init` 已废弃，脚本改用
`npx react-native init-windows --overwrite --template cpp-app`。该命令在加载时会调用 `pwsh`，
所以缺 PowerShell 7 时 `init-windows` 不会出现在 `npx react-native --help` 里。

## 已完成 / 待办

- ✅ JS/TS 壳、共享页面、Platform 契约、类型检查（`npm run typecheck`）
- ✅ C++/WinRT 原生模块源码：`native/StarStackDesktopModule.{h,cpp}`
  （`GetOpenFileNameW` / WinHTTP 下载 / `starstack-worker.exe` + JobObject / 状态事件）
- ✅ `scripts/apply-native.ps1`：生成 `windows/` 后自动把模块加进 `.vcxproj`
- ✅ Metro 打包（`--platform windows`）通过，产物 1.5 MB 左右
- ⏳ 原生编译（MSVC）——需要完整的 VC 生成工具，见下节实测结论
- ⏳ MSIX / 单文件分发

## 本机实测（2026-11-20，Windows 10 19045）

跑通的链路：

```powershell
npm ci
npm run typecheck                 # 通过
powershell -File scripts/init-windows.ps1   # 生成 windows/（需要 pwsh 7 + .NET SDK 8）
npx react-native bundle --platform windows --dev false `
  --entry-file index.js --bundle-output out/index.windows.bundle --assets-dest out/assets
```

两条坑，别踩：

1. **`init-windows --overwrite` 会覆盖 `metro.config.js`**。RNW 模板会用默认配置覆盖它，
   覆盖后 `watchFolders` 为空，bundle 直接报
   `Unable to resolve module ../mobile-rn/src/screens/Auth`。
   本仓库的 `metro.config.js` 已把模板的 `blockList` / `transformer` 与共享源码配置合并成一份，
   重新 init 后请用 git 恢复它（或不再带 `--overwrite`）。
2. **RNW 0.84.2 的版本门槛是 VS 18.6+（VS 2026）**，而 RNW 自带的包工程（`Common.vcxproj`
   等）声明 `ApplicationType=Windows Store`，需要 VC 的 UWP 生成工具组件。本机只有
   VS 2026 BuildTools 的 v145 工具集、没有 UWP VC 组件，`MSBuild` 报 `MSB8020`；
   VS 2022（v143）在这台 Win10 上装不上 C++ workload。
   另外 `run-windows` 调 vswhere 时不带 `-products *`，看不到只装了 BuildTools 的实例，
   会误报 “No public VS release found”。

可直接用的绕过命令（VS 2026 的 MSBuild + 显式属性）：

```powershell
& "$env:ProgramFiles(x86)\Microsoft Visual Studio\17\BuildTools\MSBuild\Current\Bin\amd64\MSBuild.exe" `
  windows\StarStackDesktop\StarStackDesktop.vcxproj /restore `
  /p:Configuration=Debug /p:Platform=x64 `
  /p:PlatformToolset=v145 /p:PlatformToolsetVersion=145 `
  /p:TargetPlatformVersion=10.0.26100.0 /p:WindowsTargetPlatformVersion=10.0.26100.0
```

结论：**JS 层本机可编译；原生层交给 CI 已经能出包**（见下节）。

## CI 构建（已验证通过）

`.github/workflows/desktop-rn.yml` 在 `windows-latest` 上跑，2026-11-21 首次全绿，
产物 `StarStack-Desktop-RN.zip` 约 21 MB（png/dll 齐全，已剔掉 pdb/ilk/exp）。
它也作为 reusable workflow 被 `release.yml` 的 `build-desktop-rn` job 复用，
打 tag 发版时会一起附到 GitHub Release。

关键一步是给 MSBuild 传这几个属性（第三方 Windows 工程在 runner 上的兼容坑）：

```
--msbuildprops "PlatformToolset=v145,PlatformToolsetVersion=145,
                WindowsTargetPlatformVersion=10.0.26100.0,TargetPlatformVersion=10.0.26100.0,
                WindowsAppSDKVerifyTransitiveDependencies=false"
```

| 属性 | 为什么 |
|---|---|
| `PlatformToolset=v145` + `PlatformToolsetVersion=145` | `react-native-svg` 的 `RNSVG.vcxproj` 硬写 `v143` + `ApplicationType=Windows Store`，runner 没装 v143 的 UWP 生成工具 → `MSB8020` |
| `WindowsTargetPlatformVersion` / `TargetPlatformVersion` = 26100 | `@react-native-async-storage` 的工程钉的是 22621，runner 上只有 26100 → `MSB8036` |
| `WindowsAppSDKVerifyTransitiveDependencies=false` | 该包的 WindowsAppSDK 传递依赖校验直接报 error（官方给的开关） |

另外 `scripts/apply-native.ps1` 现在会给 `StarStackDesktopModule.cpp` 加
`<PrecompiledHeader>NotUsing</PrecompiledHeader>` —— 模板工程开了预编译头，本模块自带 include，
不关会报 `C1010`。

## 与旧 `apps/desktop` 的关系

旧 WPF + WebView2 壳（`apps/desktop`）已于 2026-11-21 删除，本工程是桌面端唯一形态。
它原来的 worker 管理逻辑（`StartWorkerAsync`：拉起 `starstack-worker.exe`、
JobObject 兜底、解析日志）已经搬进 `native/StarStackDesktopModule.cpp`：

| 能力 | WPF 壳 | 现在（RNW） |
|---|---|---|
| 启动/停止本机节点 | `Process` + JobObject | `CreateProcessW` + JobObject（`nodeStart` / `nodeStop`） |
| 节点状态与统计 | 只把日志塞进队列，页面看不到 | stderr 管道解析：相位 / 分片号 / 编码器 / 已完成片数，进程退出带退出码 |
| 选择文件 / 下载产物 | WebView2 原生选择器 + 主进程反代 | `pickFile` / `download`（`GetOpenFileNameW` / WinHTTP + Bearer） |
| 界面 | 内嵌 `web-react/dist`（受 CORS/构建戳约束） | 原生 RN 页面（复用 `mobile-rn/src`），无网页快照问题 |
