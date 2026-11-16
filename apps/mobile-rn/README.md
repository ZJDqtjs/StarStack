# 星栈算力 · Android 原生端（RN + Kotlin 混血）

把「需求方控制台」和「供给方算力节点」放在一个原生 App 里。**不是 WebView 套壳**：
UI 是 React Native 的真原生 View；常驻算力跑在 Kotlin 前台 Service 里，不依赖 JS 运行时。

## 为什么是混血

单靠 RN 做不了常驻节点：Android 会挂起后台的 JS 上下文，长轮询和转码会被系统掐断。
所以职责这样切：

| 层 | 技术 | 跑在哪 |
|---|---|---|
| UI（登录、总览、节点管理） | React Native + Expo SDK 58 | JS 线程 |
| 常驻循环（注册 / 长轮询 / 下载 / 切分 / 回传） | Kotlin 协程 + OkHttp | 前台 Service |
| 设备能力探测 | Kotlin（MediaCodecList / ActivityManager） | 前台 Service |
| 分片执行 | MediaExtractor + MediaMuxer（v0） | 前台 Service |

JS 只调 `start / stop / status` 三个方法，订阅 `onNodeStatus` 事件。

## 目录

```
apps/mobile-rn/
  App.tsx                    根组件：启动引导 + 底部导航
  src/api/                   协议层（从 apps/shared/api.js 迁移，端点一致）
    client.ts                createApi：路径 / payload / 错误解包
    transport.ts             RN fetch，带超时与 FormData 上传
    format.ts, constants.ts  金额/时间格式化、状态文案
  src/session.ts             AsyncStorage 会话 + 内存镜像（createApi 要同步读）
  src/platform.tsx           平台能力注入层：pickFile / downloadArtifact / node（页面不直接依赖 Expo）
  src/platform-expo.tsx      Android 实现：Expo 文件选择/下载/分享 + Kotlin 前台 Service
  src/theme.tsx              星舷设计系统：明/暗双色板 + useStyles（对齐 web-react/styles.css）
  src/ui/icon.tsx            24×24 线性图标（路径与 web-react 同一套，react-native-svg）
  src/ui/index.tsx           Card / Btn / Chip / Segmented / Sheet / Page / Toast 等
  src/ctx.tsx                登录态、机器/任务快照、导航栈、prefill
  src/screens/               Overview / Create / Market / Jobs / JobDetail / Me / Wallet
                             Nodes / Messages / Forum / ApiView / AgentChat / Sell / Settings / Auth
  src/agent.ts               星舷助手意图规则（与 shared/agent.js、web-react 同源，按本端路由注入）
  src/native/nodeService.ts  原生模块桥 + 状态订阅
  modules/starstack-node/    Expo 本地模块（Kotlin）
    android/src/main/java/com/starstack/node/
      NodeModule.kt          Expo Module：start / stop / status / 事件
      NodeService.kt         前台 Service + 通知栏 + 状态快照
      NodeRunner.kt          注册 → claim 长轮询 → 下载 → 切分 → 上传
      NodeApi.kt             /api/worker/hello、/api/claim、/api/report、/api/upload
      DeviceCaps.kt          os/arch/cpus/mem/encoders/runtimes + 设备指纹哈希
      SegmentCutter.kt       MediaExtractor + MediaMuxer 按区间切分
```

## 界面结构（2026-11 改版）

底部 5 个主 Tab + 页面栈，图标与配色直接复用 `web-react` 的星舷设计系统：

| Tab | 内容 |
|---|---|
| 总览 | 余额/进行中/在线节点/累计贡献、快捷入口、本机节点开关、最近任务与流水 |
| 创作 | 视频转码 / Blender 渲染 / 编译打包（含估算预扣），市场「立即使用」可带场景预填 |
| 市场 | 服务挂牌（搜索 + 分类 + 详情 + 立即使用 / 联系卖家）、云主机（租用/续费/停机）、算力池 |
| 任务 | 进行中 / 已完成 / 全部；详情含分片列表、通讯记录、下载产物与取消 |
| 我的 | 账户概览、钱包账单、我的发布、买卖会话、节点、论坛、模型 API（试聊/密钥/上游/用量）、设置 |

模型 API 的「试聊」是星舷助手：`AgentChat.tsx` 支持历史会话（`ss-agent-chats-v1`，与网页端
同一份本地结构）、自然语言指令（导航 / 预填创作 / 市场搜索 / 充值 / 建密钥 / 查余额、任务、节点），
识别不了回落 `/api/models/try` 模型对话；长对话按服务端 12 条 / 8000 字上限自动裁剪。

次要页面（钱包、节点、消息、论坛、模型 API、发布、设置、任务详情）以页面栈推入，安卓返回键先退栈。

设计约定：颜色只在 `src/theme.tsx` 的 `LIGHT` / `DARK` 里定义，新增颜色先去
`web-react/src/styles.css` 加变量再同步过来；屏幕样式统一写 `makeStyles(c)` + `useStyles()`，
不要在组件里硬编码十六进制色值，否则深色主题会漏掉。

静态预览稿见 `docs/mobile-ui-preview.html`（六个机位，可切深浅色），只作视觉参照，实际界面是原生 View。

## 跑起来

```bash
cd apps/mobile-rn
npm install
npx expo prebuild --platform android     # 生成 android/（已被 .gitignore 忽略）
npx expo run:android                      # 需要本机 JDK 17 + Android SDK
```

只想看 UI：`npm start` 用 Expo Go 打开也能跑，但**节点开关会提示没有原生模块**——这是预期行为，
自定义原生代码不在 Expo Go 里。

登录后可改服务器地址；本地联调填 `http://<局域网IP>:8787`。

## 构建注意事项（都踩过）

- **Gradle 发行版走腾讯镜像**：`services.gradle.org` 在国内会中途 reset（实测下到 40% 断流）。
  `plugins/with-gradle-mirror.js` 会在每次 prebuild 后自动改 `gradle-wrapper.properties`，
  不要手改，改了也会被 prebuild 覆盖。
- **只编真机 ABI**：`android/gradle.properties` 里 `reactNativeArchitectures=arm64-v8a`。
  不限制的话 CMake 要编 4 个 ABI，多花十几分钟。
- **首次构建要装 NDK**（RN 新架构的 C++，约 1GB），装完走缓存；别以为是卡死。
- **明文 HTTP**：连本地 `http://<局域网IP>:8787` 需要 `usesCleartextTraffic`，
  由 `expo-build-properties` 写进 manifest（Android 9+ 默认禁止明文）。
- **新增了原生依赖 `react-native-svg`**（图标）：改完 `package.json` 必须重新
  `npx expo prebuild --platform android`，否则原生侧没有 autolink，运行时会白屏报
  `requireNativeComponent: RNSVGSvgViewAndroid was not found`。

## 跨端复用（桌面 RNW / 鸿蒙 RNOH）

页面与 `api/agent/theme/ui` 不直接依赖 Expo：文件选择、下载分享、常驻节点都通过
`src/platform.tsx` 的 `usePlatform()` 注入。Android 的实现是 `platform-expo.tsx`；
桌面 RNW 与鸿蒙 RNOH 各自提供 `Platform` 实现后即可复用同一套 screens。
版本矩阵、工程目录与节点 84 的工具链要求见
[`docs/多端-桌面RNW与鸿蒙RNOH方案.md`](../../docs/多端-桌面RNW与鸿蒙RNOH方案.md)。

## 节点启动流程

`/api/worker/hello` 认的是 `X-Launch-Code` / `X-Agent-Token` / `X-Node-Secret`，
**不认用户 session token**。所以 App 的启动顺序是：

1. 用户已登录（session token）→ `POST /api/nodes/launch`（`os=android, arch=arm64`）换一次性启动码
2. 把 `code` 和 `node_id` 交给原生 Service
3. 原生侧 `hello` 带 `X-Launch-Code`，拿到 `secret` 后缓存，后续用 `X-Node-Secret`

Broker 侧已登记 android 平台：`mintLaunch` 不会再把它改回 windows。
`/launch/<code>/android/arm64` 不提供下载脚本（返回一句提示），因为节点逻辑就在 App 里。

## v0 的能力边界（别当成已经完成）

- **只接 `transcode`**：Blender / 时间线 / 云主机 / 编译打包在手机上不现实，收到会直接回报失败原因。
- **只做无重编码切分**（stream copy）：保证分片参数与源片一致，先把协议链路跑通。
  真正的参数改写（按 `Claim.vcodec/height/q` 用 MediaCodec 重编码）还没接。
- **产物是 mp4**：`MediaMuxer` 只支持 mp4/webm，没有 mkv。Broker 合并前会用 `-c copy`
  把非 mkv 分片重封装成 mkv 再 concat（`ffx.RemuxMKV`），重封装失败才退回整片重编码。
  真正按 `Claim.vcodec/height/q` 改写参数仍然需要 MediaCodec 重编码或 ffmpeg-kit。
- **前台 Service 常驻通知**是系统要求，不能去掉。建议插电 + Wi-Fi 时运行，注意热降频与耗电。

## Broker 侧改动（已在本分支落地）

| 位置 | 改动 |
|---|---|
| `internal/hub/launch.go` | `launchOS` / `launchPath` 登记 `android`；脚本端点对 android 返回明确提示 |
| `internal/hub/hub.go` `canEncode` | Android 的 `h264_mediacodec` / `hevc_mediacodec` 可承接同家族任务；**桌面节点仍精确匹配** |
| `internal/hub/hub.go` `merge` | 非 mkv 分片先 `ffx.RemuxMKV` 统一容器，`concat` 失败再 `ConcatEncode` 兜底 |
| `internal/ffx/ffx.go` | 新增 `RemuxMKV`（`-c copy` 重封装，不动编码帧） |
| `internal/hub/android_node_test.go` | 回归测试：只有移动端能跨编码器家族，桌面不能互相顶替 |

## 与现有 `apps/mobile` 的关系

`apps/mobile` 是 Capacitor 套壳版（React + Vite + WebView），**已废弃**（2026-11-15）：
`apps/capacitor.config.ts` 的 `webDir` 已改指 `web-react/dist`，release.yml 不再构建 Capacitor APK。
手机端唯一形态是本工程（RN + Kotlin 前台 Service，同时是常驻算力节点）。
两者共用同一套后端协议与 `apps/shared/` 的接口约定。
