# 星栈算力 · 鸿蒙端（RNOH）

React Native OpenHarmony（RNOH）原生鸿蒙端：RN/TS 驱动 ArkUI 原生组件，**不是 ArkWeb 套壳**。
UI 与 `api/agent/theme/ui/screens` 来自 `apps/mobile-rn`；平台能力由 `src/platform-ohos.tsx` 注入。

## 版本

| 包 | 版本 |
|---|---|
| react-native | 0.84.1 |
| @react-native-oh/react-native-harmony | 0.84.6 |
| react | 19.2.3 |
| @react-native-oh/react-native-harmony-cli | 0.84.6 |

## 目录

```
apps/harmony-rn/
  App.tsx                        底部 5 Tab + 页面栈（复用 mobile-rn 的 screens）
  src/platform-ohos.tsx          Platform 实现：NativeModules.StarStackNode
  metro.config.js                RNOH Metro 配置 + watchFolders: ../mobile-rn
  harmony/                       DevEco 工程
    entry/src/main/ets/
      entryability/EntryAbility.ets   RNAbility 子类
      pages/Index.ets                 RNApp 根页面
      PackageProvider.ets             注册 StarStackNodePackage
      rn/StarStackNodePackage.ets     原生包
      turboModules/StarStackNodeModule.ets  JS 可调的 TurboModule
      node/NodeService.ets            ArkTS 长时任务 + hello/claim/report
```

## 构建（节点 84）

前置：Node 22、DevEco Studio（RNOH 0.84 要求较新的 OpenHarmony SDK / API 17+，
以 DevEco 实际提示为准）、HarmonyOS SDK、hdc、签名证书。

```bash
cd apps/harmony-rn
npm install
npm run harmony          # 生成 harmony/entry/src/main/resources/rawfile/hermes_bundle.hbc
cd harmony
ohpm install             # 从 ../node_modules/@react-native-oh/react-native-harmony 取 HAR
# DevEco 打开 apps/harmony-rn/harmony，Sync 后 Run 'entry'
# 或命令行：hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
```

调试态在 DevEco 里直接 Run 即可，`Index.ets` 会优先用 `MetroJSBundleProvider` 连本机 Metro；
发布态用 rawfile 里的 `hermes_bundle.hbc`。

### JS 产物已验证（2026-11-20）

`npm install && npm run harmony` 可在没有 DevEco 的机器上跑通，产出
`harmony/entry/src/main/resources/rawfile/hermes_bundle.hbc`（约 2.1 MB，Hermes 字节码），
`Index.ets` 的发布态 `ResourceJSBundleProvider(..., 'hermes_bundle.hbc')` 就读它。

> RN 0.84 把 `hermesc` 从 `react-native/sdks/hermesc` 移到了独立包 `hermes-compiler`，
> CLI 的默认路径找不到会报 `Couldn't find hermesc at .../react-native/sdks/hermesc/win64-bin/hermesc.exe`。
> `package.json` 的 `harmony` 脚本已显式带 `--hermesc-dir node_modules/hermes-compiler/hermesc`。

**HAP 仍然只能在 DevEco 里编译**：`ohpm install` + `hvigorw assembleHap` 依赖 HarmonyOS SDK
与华为账号签名，纯 npm 环境无法替代。

## ArkTS 节点服务（当前边界）

`NodeService.ets` / `MediaPipeline.ets` 已实现：

- `backgroundTaskManager.startBackgroundRunning(..., DATA_TRANSFER)` 长时任务；
- `/api/worker/hello` 注册（`os=harmony`、`arch=arm64`、设备指纹、`h264_mediacodec`/`hevc_mediacodec`）；
- `/api/claim` 20s 长轮询、下载源片、`AVDemuxer + AVMuxer` 无重编码切分（stream copy）；
- SHA-256、`/api/upload` 回传、`/api/report` 的 `done`/`failed`；
- JS 开关/状态通过 `StarStackNode` TurboModule 与 `StarStackNodeStatus` 事件。

**v0 边界**：切分是 stream copy，不按 Claim 的 `height/q/vcodec` 重编码；
输出参数与源片一致（与 Android 的 fallback 路径相同）。真正重编码需要
`AVCodec` 的 decode/encode 管线，是下一步；`MediaPipeline.ets` 已隔离，替换该文件即可。

**构建**：`AVDemuxer/AVMuxer` 的实际方法签名以 DevEco 的 HarmonyOS SDK 为准；
本机没有 SDK，HAP 编译需要在节点 84 的 DevEco 里完成并回报编译错误。

## 与旧 `apps/harmony` 的关系

旧工程是 ArkWeb `Web` 组件加载 `rawfile/web/index.html` 的套壳；本工程是 RNOH 原生渲染，
旧工程不再作为交付形态。`com.starstack.compute` 这个 bundleName 沿用，升级时注意签名一致。
