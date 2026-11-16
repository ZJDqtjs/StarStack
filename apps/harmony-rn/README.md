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

## ArkTS 节点服务（当前边界）

`NodeService.ets` 已实现：

- `backgroundTaskManager.startBackgroundRunning(..., DATA_TRANSFER)` 长时任务；
- `/api/worker/hello` 注册（`os=harmony`、`arch=arm64`、设备指纹）；
- `/api/claim` 20s 长轮询、`/api/report` 失败回报；
- JS 开关/状态通过 `StarStackNode` TurboModule 与 `StarStackNodeStatus` 事件。

**尚未实现**：`AVDemuxer` / `AVMuxer` / `AVCodec` 的分片执行。因此 hello 里
`encoders: []`，Broker 不会把转码分片派给鸿蒙节点——宁可空闲，也不接跑不了的活。
下一步接媒体管线后，再把 `h264_mediacodec` / `hevc_mediacodec` 声明进去。

## 与旧 `apps/harmony` 的关系

旧工程是 ArkWeb `Web` 组件加载 `rawfile/web/index.html` 的套壳；本工程是 RNOH 原生渲染，
旧工程不再作为交付形态。`com.starstack.compute` 这个 bundleName 沿用，升级时注意签名一致。
