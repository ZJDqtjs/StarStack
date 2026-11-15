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
  src/ui/                    基础组件（Card / Btn / Field / Badge / Stat）
  src/screens/               Auth / Overview / Nodes
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

## 节点启动流程（注意这里绕了一道弯）

`/api/worker/hello` 认的是 `X-Launch-Code` / `X-Agent-Token` / `X-Node-Secret`，
**不认用户 session token**。所以 App 的启动顺序是：

1. 用户已登录（session token）→ `POST /api/nodes/launch` 换一次性启动码
2. 把 `code` 和 `node_id` 交给原生 Service
3. 原生侧 `hello` 带 `X-Launch-Code`，拿到 `secret` 后缓存，后续用 `X-Node-Secret`

`launchNode` 里 `os`/`arch` 暂时传 `windows/amd64`：Broker 的 `/launch/<code>/<os>/<arch>`
目前只认 `windows|linux|darwin`，但 `admitAgent` 只校验启动码本身、不比对平台，
而 hello 上报的仍是真实的 `android/arm64`。等 Broker 放开 android 后改回即可。

## v0 的能力边界（别当成已经完成）

- **只接 `transcode`**：Blender / 时间线 / 云主机 / 编译打包在手机上不现实，收到会直接回报失败原因。
- **只做无重编码切分**（stream copy）：保证分片参数与源片一致，先把协议链路跑通。
  真正的参数改写（按 `Claim.vcodec/height/q` 用 MediaCodec 重编码）还没接。
- **产物是 mp4，Broker 目前按 mkv 合并**：`MediaMuxer` 只支持 mp4/webm，没有 mkv。
  两条出路：接 ffmpeg-kit 输出 mkv，或让 Broker 对 android 分片做一次重封装。
- **前台 Service 常驻通知**是系统要求，不能去掉。建议插电 + Wi-Fi 时运行，注意热降频与耗电。

## Broker 侧待改（跑通之后再做）

| 位置 | 改动 |
|---|---|
| `internal/hub/launch.go` | `launchPath` 与 OS 校验放开 `android`；分发物从裸二进制换成 APK 说明 |
| `internal/ffx/ffx.go` | 编码器探测加 `h264_mediacodec` 等映射；`hardwareEncoderFamily` 放行移动硬编 |
| `internal/hub/policy.go` / 调度 | `Req.Arch` 支持 `android/arm64`；只给移动节点派转码分片 |
| 合并逻辑 | 允许 mp4 分片，或在合并前重封装成统一容器 |

## 与现有 `apps/mobile` 的关系

`apps/mobile` 是 Capacitor 套壳版（React + Vite + WebView），功能完整、已经在用。
这个 RN 端是并行新增的，**不改动旧端**；等原生端能力追平后再决定是否替换。
两者共用同一套后端协议与 `apps/shared/` 的接口约定。
