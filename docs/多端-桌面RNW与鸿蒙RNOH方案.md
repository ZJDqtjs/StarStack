# 桌面 RNW 与鸿蒙 RNOH：复用方案与版本矩阵

> 分支：`feature/native-rnw-rnoh`
> 目标：桌面改成 **React Native Windows（RNW）**，鸿蒙改成 **React Native OpenHarmony（RNOH）**，
> 两者都是类原生的 RN 后端，不是 WebView 套壳；UI/业务代码尽量与 `apps/mobile-rn` 共用。

## 一、已核对的版本矩阵（2026-11-16）

| 端 / 包 | 版本 | 对 RN 的约束 |
|---|---|---|
| Android `apps/mobile-rn` | Expo 58 / RN 0.88.1 / React 19.3.0 | Expo 58 固定这一档 |
| `react-native-windows` latest | 0.85.2 | peer `react-native ^0.85.0`、`react ^19.2.3` |
| `react-native-windows` 0.84 | 0.84.2 | peer `react-native 0.84.1`、`react ^19.2.3` |
| `@react-native-oh/react-native-harmony` latest | 0.84.6 | peer `react-native 0.84.1` |
| RNOH 0.86-rc | 0.86.1 | peer `react-native 0.86.3` |

结论：

1. **没有稳定版本同时覆盖 Android 的 RN 0.88 和 RNW/RNOH。** RNW 最新稳定是 0.85，RNOH 最新稳定是 0.84。
2. **桌面与鸿蒙可以钉在同一个 RN 版本：0.84.1 + React 19.2.3**
   （RNW 0.84.2 + RNOH 0.84.6）。这是两边都 stable 的唯一交集。
3. Android 继续留在 Expo 58 / RN 0.88.1，不为了桌面/鸿蒙降级 Expo。
   因此三端共用的是 **TS/TSX 源码**，不是同一个 `node_modules`；每个 App 用自己的 RN 版本编译。

## 二、复用边界

共用（放在 `apps/mobile-rn/src`，桌面/鸿蒙以 Metro `watchFolders` 引入）：

| 目录 | 内容 | 说明 |
|---|---|---|
| `src/api/` | 接口客户端、错误解包、上传 | 只依赖 `fetch` / `FormData` |
| `src/agent.ts` | 星舷助手意图规则 | 纯函数 |
| `src/api/format.ts`、`constants.ts` | 金额/时间/状态文案 | 纯函数 |
| `src/theme.tsx` | 明暗两套星舷色板 | 只依赖 React |
| `src/ui/` | Card / Btn / Chip / Segmented / Sheet / Field 等 | 依赖 `react-native` 核心组件 + `react-native-svg` |
| `src/screens/` | 13 个页面 | 通过 `usePlatform()` 访问平台能力 |

各端自己实现（不共用）：

| 能力 | Android | 桌面 RNW | 鸿蒙 RNOH |
|---|---|---|---|
| 文件选择 | `expo-document-picker` | RNW 文件对话框（原生模块） | ArkTS `picker` TurboModule |
| 下载/另存 | `expo-file-system` + `expo-sharing` | C# 模块（`SaveFileDialog` + HttpClient） | ArkTS 文件 API |
| 常驻节点 | Kotlin 前台 Service | `starstack-worker.exe` 子进程 | ArkTS `backgroundTaskManager` 长时任务 |
| 状态栏 | `react-native` StatusBar | 无（窗口标题栏） | ArkUI 窗口 |
| 安全存储 | AsyncStorage | AsyncStorage / Windows 凭据库 | ArkTS preferences |

## 三、已落地的第一层：平台能力注入

新增：

- `src/platform.tsx`：`Platform` / `PlatformNode` 接口、`PlatformProvider`、`usePlatform()`。
- `src/platform-expo.tsx`：Android 的 Expo + Kotlin 实现。
- `Create.tsx` / `JobDetail.tsx` / `Overview.tsx` / `App.tsx` 不再直接 import Expo 模块。
- `node.launch` 与 `node.hint` 由平台注入，页面不再写死 `android/arm64` 与“Kotlin 前台服务”。

这样桌面与鸿蒙只需提供自己的 `Platform` 实现，页面代码不变。

## 四、桌面 RNW 工程（下一步）

计划目录：`apps/desktop-rn/`

```
apps/desktop-rn/
  package.json          RN 0.84.1 + react-native-windows 0.84.2 + react 19.2.3
  app.json / index.js
  metro.config.js       watchFolders: ../mobile-rn
  App.tsx               桌面壳：左侧导航 + 窗口标题栏
  src/platform-win.ts   Platform 实现（文件对话框、下载、worker.exe）
  windows/              RNW 原生工程（在构建节点 84 生成）
```

关键点：

- `metro.config.js` 的 `watchFolders` 加 `../mobile-rn`，`resolver.nodeModulesPaths` 同时指向
  `apps/desktop-rn/node_modules` 与 `apps/mobile-rn/node_modules` 之外的依赖必须由本工程声明。
- 共享页面 import `react-native-svg`，桌面工程也要装同一主版本。
- `windows/` 目录由 `npx react-native init-windows --overwrite --template cpp-app` 生成
  （RNW 0.76+ 已废弃 `react-native-windows-init`），需要 PowerShell 7、.NET SDK 8+、
  VS2022 + C++ 工作负载 + Windows SDK。`init-windows` 在加载时会调用 `pwsh`，缺它时命令不会出现在
  `npx react-native --help` 中。
- 本地节点走 `starstack-worker.exe`：已从 WPF 的 `StartWorkerAsync` 搬成 RNW TurboModule
  （`native/StarStackDesktopModule.cpp`，CreateProcessW + JobObject + stderr 解析）。

## 五、鸿蒙 RNOH 工程（下一步）

计划目录：`apps/harmony-rn/`

```
apps/harmony-rn/
  package.json          RN 0.84.1 + @react-native-oh/react-native-harmony 0.84.6
  metro.config.js       RNOH 的 Metro 配置 + watchFolders: ../mobile-rn
  App.tsx               鸿蒙壳（底部 Tab 或侧栏）
  src/platform-ohos.ts  Platform 实现（picker / 文件 / 节点桥）
  harmony/              hvigor 工程与 ArkTS 模块（DevEco 5.x 生成）
```

关键点：

- Expo 模块不能用于 RNOH；`expo-document-picker` / `expo-file-system` / `expo-sharing` 全部由
  `Platform` 接口替换成 ArkTS TurboModule。
- 节点服务是第二套原生实现：`backgroundTaskManager` 长时任务 + `AVDemuxer` / `AVMuxer` / `AVCodec`；
  与 Android Kotlin 实现共用 Broker 契约，不共用代码。
- Broker 侧还需要登记 `harmony` 平台（`launchOS` / `policy.launch_harmony` / 调度匹配），否则节点注册了也接不到活。
- 构建需要 DevEco Studio 5.x + HarmonyOS SDK + hvigor + 签名证书。

## 六、实施状态（2026-11-20 实测）

| 链路 | 状态 | 说明 |
|---|---|---|
| desktop-rn：依赖 + 类型检查 | ✅ 通过 | `npm ci` / `npm run typecheck` |
| desktop-rn：`windows/` 原生工程 | ✅ 已生成 | `init-windows --template cpp-app`，`apply-native.ps1` 已注入原生模块 |
| desktop-rn：Metro 打包（windows） | ✅ 通过 | 修复 `metro.config.js` 被模板覆盖导致 `watchFolders` 丢失的问题 |
| desktop-rn：MSVC 原生编译 | ✅ CI 通过（2026-11-21） | `.github/workflows/desktop-rn.yml`（windows-latest）出 `StarStack-Desktop-RN.zip`（21 MB）；本机 Win10 19045 仍不可行（VS 2026 装不齐 UWP VC 组件） |
| harmony-rn：依赖 + 类型检查 | ✅ 通过 | `npm ci` / `npm run typecheck` |
| harmony-rn：HBC bundle | ✅ 通过 | `npm run harmony` → `rawfile/hermes_bundle.hbc`（2.1 MB） |
| harmony-rn：HAP 编译 | ⛔ 本机不可行 | 必须 DevEco Studio 5.x + HarmonyOS SDK + 华为签名 |

三条必须记住的坑：

1. `init-windows --overwrite` 会覆盖 `metro.config.js`（丢 `watchFolders`），bundle 立刻报
   `Unable to resolve ../mobile-rn/src/screens/Auth`。仓库的 `metro.config.js` 已合并 RNW 模板的
   `blockList` / `transformer` 与共享源码配置；init 之后用 git 恢复。
2. RNW 的 `run-windows` 调 vswhere 不带 `-products *`，只装 BuildTools 的实例会被忽略，
   报 “No public VS release found”。直接用 MSBuild 编 `.vcxproj` 可绕开。
3. RN 0.84 的 `hermesc` 在 `hermes-compiler` 包里，`bundle-harmony` 必须带
   `--hermesc-dir node_modules/hermes-compiler/hermesc`。

## 六、构建节点 84 需要装的东西

| 用途 | 工具 |
|---|---|
| Go Broker/Worker | Go（当前 1.26.5 已可用） |
| Android RN 打包 | Node 22（RN 0.88 要求）、JDK 17、Android SDK / NDK |
| 桌面 RNW | Node 22、VS2022（Desktop development with C++）、Windows 10/11 SDK |
| 鸿蒙 RNOH | Node 22、DevEco Studio 5.x、HarmonyOS SDK、hvigor |
| web-react | Node 22、npm |

> Android 0.88 的 engine 要求 Node `^22.13.0 || ^24.3.0 || >=26`；本机当前 Node 20 只能做类型检查，
> 正式打包必须在节点 84 用 Node 22。

## 七、执行顺序与当前状态

1. ✅ 平台能力注入层（`platform.tsx` / `platform-expo.tsx`），三端 `tsc --noEmit` 通过。
2. ✅ 桌面 JS/TS 壳：`apps/desktop-rn`（RN 0.84.1 + RNW 0.84.2），
   `App.tsx` 左侧导航 + 共享 screens，`src/platform-win.tsx` 定义原生模块契约。
   `windows/` 与 C++/WinRT 模块由 `scripts/init-windows.ps1` 在节点 84 生成/接入。
3. ✅ 鸿蒙 JS/TS + DevEco 工程：`apps/harmony-rn`（RN 0.84.1 + RNOH 0.84.6），
   `harmony/` 来自 RNOH CLI 0.84.6 的官方模板，`EntryAbility` / `RNApp` / `StarStackNodePackage`
   已就位；HAP 需在 DevEco 里 Sync + 签名后构建。
4. ✅ ArkTS 节点：`backgroundTaskManager` 长时任务、hello / claim / report，
   `AVDemuxer + AVMuxer` stream-copy 切分、SHA-256、upload 与 done 回报；
   已声明 `h264_mediacodec` / `hevc_mediacodec`。
   v0 不按 `height/q` 重编码（与 Android fallback 同边界），`AVCodec` 重编码是下一步。
5. ✅ Broker 登记 `harmony`：`launchOS` / `launchPath` / `canEncode` 已支持，
   单测 `TestCanEncodeFamilyOnlyOpensForMobile` / `TestLaunchAcceptsMobilePlatforms` 通过。
6. ⏳ 两端原生模块编译：桌面 `windows/`（VS2022 + C++）、鸿蒙 HAP（DevEco + SDK）。
7. ⏳ 打包与发布流程接入 CI。

> RNOH 的 `@react-native-oh/template` 在 npm 上不存在（CLI `init` 默认会 404）。
> 本工程改用 CLI 包内自带的 `harmony` 模板 + `@react-native-oh/react-native-harmony` 包内的
> `react_native_openharmony.har`，文件与官方 init 输出同源。

本地已验证：

- `apps/harmony-rn` 的 `npm run harmony:debug` 成功产出
  `harmony/entry/src/main/resources/rawfile/bundle.harmony.js`（5 个 asset），说明共享 screens
  在 RNOH Metro 下可解析；`npm run harmony` 需要 RN 包内的 `hermesc`，当前本机没有，留给节点 84。
- `apps/desktop-rn` 三端类型检查通过；`init-windows` 需要 `pwsh`/`.NET SDK`，本机两者都没有，
  所以 `windows/` 只能在节点 84 生成（脚本已改为 RNW 0.76+ 的正确命令）。
