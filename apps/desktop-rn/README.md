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

前置：Node 22、VS2022（Desktop development with C++ + Windows 10/11 SDK）、
`starstack-worker.exe` 放在 exe 同目录（或设置 `STARSTACK_WORKER`）。

## 已完成 / 待办

- ✅ JS/TS 壳、共享页面、Platform 契约、类型检查（`npm run typecheck`）
- ⏳ `windows/` 生成与 C++/WinRT 原生模块（文件对话框、下载、worker 子进程）
- ⏳ MSIX / 单文件分发

## 与旧 `apps/desktop` 的关系

旧 WPF + WebView2 壳已不再作为交付形态；本工程是桌面端的唯一目标。
旧的 worker 管理逻辑（`MainWindow.xaml.cs` 的 `StartWorkerAsync`）保留作原生模块的行为参考。
