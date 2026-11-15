# 星栈算力 · 移动端与小程序

同一套后端接口的两个客户端：

- `mobile/` — React + Vite + Capacitor 的安卓 App，覆盖控制台全部 9 个视图。
- `miniapp/` — 原生微信小程序，覆盖需求方的 5 个页面 + 登录 + 星舷助手。
- `harmony/` — HarmonyOS NEXT（API 12+）ArkTS 壳，Web 组件加载同一份 React 构建产物。
- `desktop/` — WPF + WebView2 桌面端，内嵌同一份 React 构建产物，带本机运行节点的消息桥。
- `shared/` — 两个客户端共用的接口客户端、类型约定、状态文案、格式化函数与 Agent 意图引擎。

后端已支持 `Authorization: Bearer <session token>`（登录响应里新增 `token` 字段）与 `/api/*` 的 CORS 预检，浏览器 Cookie 会话保持原样。

## 与 web 端（web-react / 内嵌控制台）的同步基线

多端与星舷控制台保持同一功能契约（`feature/admin-console` 起）：

- **模型 API = 四 Tab**：试聊（Agent 聊天）/ 密钥与模型（含每日限额与今日已用）/ 上游接入 / 用量对账（仅平台账户 200，普通账户降级提示）。
- **Agent 聊天**：意图规则三端同源——`shared/agent.js` 与 `web-react/src/agent.js`、`internal/hub/web/assets/agent.js` 逐条对齐（改规则三处必须同步，跨端以 `shared/agent.js` 为准）。识别不了的输入回落 `POST /api/models/try`，上下文裁剪同后端限制（12 条 / 单条 2000 字 / 合计 8000 字 / 末条 user）。
- **历史对话**：`localStorage['ss-agent-chats-v1']`（小程序为 `wx.setStorageSync` 同名键）与数据结构 `{v,activeId,sessions[{id,title,model,msgs,createdAt,updatedAt}]}` 与两版网页控制台完全一致；上限 50 会话 / 200 消息，配额溢出按更新时间丢弃最旧会话。
- **轮询节奏**：登录态 `/api/state` 每 1s + `/api/contribution` 每 5s（与 web store 一致；`ETag/304` 由浏览器/WebView 透明命中，无需前端改动）。
- **分页与搜索**：`shared/api.js` 的 `ledger/jobs/forumPosts/offers/conversations` 支持**可选** `limit/offset/q` 参数（不传时响应与旧契约完全一致）；视图当前仍走默认全量，需要大数据量列表时按端接入。
- 刻意不做（小程序遥控器定位）：生图/生视频 ComfyUI 工作台、服务挂牌发布与买卖会话、云电脑、节点一键接入；移动端 Agent 命中这些意图时给出诚实的降级提示卡片。

### 构建戳：判断「谁落后了」的唯一依据

exe 与鸿蒙 rawfile 内嵌的都是**构建期快照**（`EmbeddedResource` / rawfile），
web 改了不会自动流过去，而且不会报错。所以每份产物自带一枚戳：

- `web-react/vite.config.js` 与 `apps/vite.config.ts` 用 vite `define` 注入 `__BUILD__`（pkg / sha / time），
  同时落盘 `dist/build.json`。
- 桌面端「关于」直接读内嵌的 `web/build.json`，显示这枚 exe 里装的是哪一版网页；
  web 端在「设置 → 关于构建」。两处戳对不上 = 壳里的网页落后了。
- `apps/desktop/StarStack.Desktop.csproj` 的 `EnsureWebBuildStamp` target 会拦下没有 `build.json`
  的旧产物：旧网页无法被静默打进 exe。

> **exe 与鸿蒙都取 `web-react/dist`**（唯一 UI 源）。`apps/mobile` 是 Capacitor 时代的旧界面，
> 已废弃，不再被任何交付形态内嵌；`apps/android` 与 `capacitor.config.ts` 仅作历史保留。

校验命令：`npm --prefix apps run verify:sync`（CI 里是 `多端控制台同步检查` job）。
它按 **L0 交易主链**（登录/余额/提交/进度/下载/账单）逐端打分，并检查废弃 UI 有没有
继续给交付形态供血（csproj 内嵌路径、鸿蒙 rawfile 来源、Capacitor 工程、发布流水线）。

## 目录

```
apps/
  shared/            api.js / constants.js / format.js / agent.js（ESM，两端共用）
  mobile/src/        React 页面：Auth, Submit, Jobs, Market, Vm, Nodes, ApiView(+AgentChat), Bill, Forum, Me
  mobile/dist/       构建产物，被打进 APK 的本地资源
  miniapp/           原生小程序；utils/core.js 由 shared/ 打包生成
  android/           Capacitor 生成的安卓工程
  harmony/           ArkTS 壳，rawfile/web 内嵌同一份 dist
  desktop/           WPF + WebView2，csproj 编译期把 dist 嵌入 exe
  scripts/           verify-miniapp.cjs（Node 侧校验小程序）、sync-harmony.cjs（同步鸿蒙产物）
```

## 安卓

```bash
cd apps
npm install

# 浏览器里调 UI（Vite 代理到 STARSTACK_BROKER，默认公网演练环境）
STARSTACK_BROKER=http://127.0.0.1:8787 npm run dev   # http://127.0.0.1:5173

# 构建网页产物并同步进原生工程
npm run build
npx cap sync android

# 打 debug APK（需要 JDK 17 与 Android SDK）
cd android && ./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk

# 或者一键：./android/apk.ps1（Windows）/ ./android/apk.sh（Linux/macOS）
# 两个脚本现在都会先 npm run build + npx cap sync android 再跑 gradle，
# 杜绝把上一次残留的旧 assets 打进 APK；无 npm 的纯构建节点退回用仓库产物并打印提示。
```

装到设备/模拟器：

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.starstack.compute/.MainActivity
```

- APK 内是本地资源，不依赖远程网页；默认连 `https://starstack.run`，可在登录页或「我的 → 服务器地址」改。
- `capacitor.config.ts` 里 `androidScheme: 'http'` + `cleartext: true`，否则 `https://localhost` 的页面会被混合内容规则拦住明文请求；`localhost` 仍是安全上下文，剪贴板等 API 可用。
- Gradle 分发包在 `android/gradle/wrapper/gradle-wrapper.properties` 指向腾讯镜像（`services.gradle.org` 在部分网络下会重置连接）；换回官方源删掉该行即可。
- 文件上传走 WebView 的原生选择器，大文件没有分片续传，移动端建议只传小样。

## 小程序

1. 用微信开发者工具「导入项目」，目录选 `apps/miniapp`，AppID 可用测试号（`project.config.json` 里是 `touristappid`）。
2. 详情 → 本地设置 → 勾选「不校验合法域名、web-view、TLS 版本以及 HTTPS 证书」，即可直连 HTTP 演示环境。
3. 登录页可改服务器地址；账号与网页控制台通用。

覆盖范围（小程序是需求方的「遥控器」，不是全功能端）：

| 页面 | 能力 |
|---|---|
| 提交 | 视频转码（选视频自动读时长）与 Blender 帧区间渲染；单文件上传、带进度 |
| 任务 | 任务卡、分片进度、哈希校验、结算；下载链接复制到剪贴板 |
| 市场 | 按编码能力聚合 + 在线节点（只读） |
| 账单 | 流水、节点收益、自助充值（部署允许时） |
| 我的 | 余额、我的节点（只读）、高级选项、服务器地址、退出 |
| 助手 | 星舷 Agent 聊天（「我的」页进入）：一句话查任务/余额/节点、充值、创建密钥、跳转任意页；识别不了回落模型对话；历史与网页端同一存储结构 |

刻意不做：云电脑（无 WebRTC/键鼠）、模型上游登记（长表单）、论坛（多图/视频）、节点改价与一键接入（需要下载并运行本机脚本）、生图/生视频工作台（ComfyUI，命中时助手会明确告知去网页端）。

正式版上线前必须：域名备案 + HTTPS + 在微信后台配置 request 合法域名；`http://20.24.210.119:8787` 只能用于开发与体验版。

`utils/core.js` 是 `shared/` 的 CommonJS 打包产物，改完 `shared/` 后重新生成；
`harmony/.../rawfile/web` 是入库的 React 构建产物，改完 `mobile/` 后要同步。一条命令全做：

```bash
npm run sync:all     # = vite build + sync:core + sync:harmony
```

## 校验

```bash
# 页面注册（8 页四件套齐全）、WXML 表达式、模块加载，并用 Node 模拟 wx.* 跑通登录/估算/上传/账单
STARSTACK_SAMPLE=/path/to/sample.mp4 STARSTACK_BROKER=http://127.0.0.1:8787 \
  node scripts/verify-miniapp.cjs

cd apps && npx tsc --noEmit && npm run build
```

## 编译打包（共享算力任务）

平台新增 `build` 任务类型：买方上传源码 zip，节点解压后执行命令，产物打包成 `result.zip` 回传，按实际墙钟分钟结算（1 分钟下限），失败不结算。

- 提交：控制台「提交任务 → 编译打包」，或 `POST /api/jobs/build`（multipart：file / command / output / timeout / req）。
- 能力匹配：节点必须以 `--allow-build` 启动并上报 `build` 运行时，调度器只会把编译任务派给这类节点；转码/渲染仍按编码器与运行时匹配。
- 三方同意，各管一段（别再混成一张名单）：
  - **部署**：broker 带 `--allow-build` 才提供编译任务；不带时 mint 启动码会直接拒绝「接受编译任务」的请求。
  - **机主**：网页「我的节点」创建节点时勾选「接受编译任务」（等价手工加 `--allow-build`），决定**这台机器**愿不愿意跑别人的命令；不勾就是纯转码/渲染节点。
  - **买方**：`--build-users a,b`（或 `STARSTACK_BUILD_USERS`）决定谁能提交源码。名单为空 = 没人能提交（`POST /api/jobs/build` 返回 403），但节点照样可以声明愿意接。
- 缺环境自动补齐：同意编译的启动包会同时带 `--auto-provision`（安装 .NET SDK 等）；任务脚本也可自行引导安装（参考本次桌面端 `build.cmd` 安装 .NET SDK 到 `%LOCALAPPDATA%\starstack-sdk`）。
- 产物：`GET /download/<job-id>`，zip 内含 `build.log`。

本次桌面端就是用这条链路构建的：源码包 → 1145 节点 → `dotnet publish` → `result.zip` → 在本机安装。

### 桌面端产物形态

`desktop/build.cmd` 现在发布**自包含单文件**：

```
dotnet publish StarStack.Desktop.csproj -c Release -r win-x64 \
  --self-contained true -p:PublishSingleFile=true \
  -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true
```

产物目录里只有一个 `StarStack.Desktop.exe`（约 70–90 MB），**双击即可运行**，不需要预装 .NET 运行时，也不需要先解压一堆 DLL。`install.bat` / `install.ps1` 只在需要开始菜单快捷方式和固定安装目录时使用，属于备选。

## Linux 支持

| 能力 | Linux | 说明 |
|---|---|---|
| 节点 Agent | ✅ | 静态二进制 `starstack-node`；节点包含 `start.sh`，解压后 `sh start.sh` 即加入 |
| 一键接入启动脚本 | ✅ | 控制台会按目标系统生成 `.sh` |
| 编译任务（build） | ✅ | worker 用 `sh -c` 执行命令；解压后会自动给 `.sh` 加执行位 |
| Android 打包 | ✅ | `apps/android/apk.sh`：缺 JDK 17 / Android SDK 时自动下载到 `out/`，Gradle 走腾讯镜像 |
| Web/小程序 | ✅ | Node/Vite 与微信开发者工具无关平台 |
| Windows 桌面端 | ❌ | WPF + WebView2 只能 Windows 构建；如需 Linux 桌面端，应改 Avalonia（另起项目） |

Linux 上跑 Android 的编译任务：

```bash
# 源码包根目录放 apk.sh（从 apps/android/apk.sh 复制），任务命令填:
./apk.sh          # 解压时已自动 chmod +x；也可写 sh apk.sh
# 输出目录 out 会得到 StarStack.apk
```

前置条件：`curl`、`unzip`、`tar`、网络可访问 dl.google.com / api.adoptium.net / 腾讯 Gradle 镜像。
