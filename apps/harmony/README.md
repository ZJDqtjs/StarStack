# 星栈算力 · 鸿蒙端（HarmonyOS NEXT）

`entry` 是一个 ArkTS 壳：`Web` 组件加载 `entry/src/main/resources/rawfile/web/` 里内嵌的
React 控制台，API 走 broker 的 HTTP + Bearer。

> **当前定位：只做买方。** 内嵌的是 `web-react/dist`（与桌面 exe 同源，都是唯一 UI 源）。
> 套壳方案**当不了算力节点** —— WebView 页面切到后台会被系统挂起，长轮询与解码都跑不住，
> 安卓那边正是因此才把节点逻辑放进 Kotlin 前台 Service。
> 要让鸿蒙贡献算力，需另写 ArkTS 原生节点（`backgroundTaskManager` 长时任务 + 原生解码），
> 与 RN 的 Kotlin 实现是**两套代码、同一套 Broker 契约**。

## 环境要求

- DevEco Studio **5.x**（HarmonyOS NEXT，API 12 及以上）
- HarmonyOS SDK（API 12+）
- 模拟器或鸿蒙 NEXT 真机
- 签名：DevEco 里登录华为开发者账号后用「自动签名」，或使用自己的证书

> 注意：winget 里的 `Huawei.DevEco` 是 3.x 版本（面向 API 9/10），不能打开本工程；
> HarmonyOS NEXT 请从华为官网下载 DevEco Studio 5.x。

## 打开与运行

1. DevEco Studio → Open → 选择 `apps/harmony`（不是仓库根目录）
2. 等待 Sync（hvigor/ohpm 依赖）完成
3. File → Project Structure → Signing Configs → 勾选自动签名并登录华为账号
4. 选择模拟器或真机 → Run 'entry'

## 更新内嵌 UI

界面与桌面 exe 同源，都取 `web-react` 的构建产物：

```bash
cd web-react && npm run build      # 产物 web-react/dist（带 build.json 构建戳）
cd ../apps && npm run sync:harmony # = web-react/dist -> rawfile/web（统一 LF + 引用校验）
```

> rawfile 是入库文件、`index.html` 引用带内容 hash 的资源名，手工拷贝容易漏同步，
> 不要再手动 `cp -r`。同步后 `rawfile/web/build.json` 里应能看到本次的 commit。

### 鸿蒙端的接口地址

rawfile 里的页面没有同源后端，`location.protocol` 是 `resource:`/`file:`，
所以 `web-react/src/api.js` 会回落到默认 Broker（`https://starstack.run`）；
用户可在「设置 → 服务器地址」改成别的地址，写入 localStorage 后重载生效。

## 测试建议（按方便程度）

| 方式 | 成本 | 适用 |
|---|---|---|
| **真机 + USB 调试** | 一台鸿蒙 NEXT 手机，开开发者模式；DevEco 自动签名 | 最接近真实效果，最推荐 |
| **DevEco 模拟器** | 装 DevEco 5 + SDK + 模拟器镜像（数 GB），登录华为账号 | 没有真机时使用；Web 组件在模拟器里渲染正常 |
| **Previewer 预览** | 已随 DevEco 安装，秒级 | 只能看 ArkUI 骨架，`Web` 组件常显示空白，不适合验收 |
| **浏览器** | 零成本 | 只能验证内嵌的同一份 React 界面（已做过），验证不了 ArkTS 壳 |

当前机器没有 DevEco / HarmonyOS SDK / hdc，所以这份工程的 ArkTS 壳尚未编译验证；
结构、资源引用和内嵌 Web 产物已做静态校验。

## 说明

- bundleName：`com.starstack.compute`
- 允许明文 HTTP（`network_config.json`），方便直连 `http://20.24.210.119:8787`；
  正式发布建议换 HTTPS 域名。
- 若目标设备是 HarmonyOS 4（API 9）而非 NEXT，本工程不适用，需要另建 API 9 模板工程。
