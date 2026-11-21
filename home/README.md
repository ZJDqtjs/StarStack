# home.starstack.run · 欢迎页

项目介绍、SVG 调度演示、下载入口的纯静态站点。零构建、零运行时依赖，
通过 GitHub Actions 部署到 **Cloudflare Workers Static Assets**。

```
home/
  public/            静态站点产物（Wrangler 的 assets.directory）
    index.html
    styles.css
    app.js            下载清单渲染 + SVG 调度动画
    favicon.svg
    .assetsignore
  scripts/
    verify-site.cjs   CI 门禁：资源存在性 / 下载清单一致性 / DOM id / 混合内容
  wrangler.jsonc
  README.md          本文件
```

## 为什么放 Workers，以及为什么不把安装包也放进去

Cloudflare 官方现在把 **Workers Static Assets** 列为新静态站点的推荐路径（Pages 仍在运行，
但新特性与优化都集中在 Workers）。纯静态站不需要 `main` 入口，也就不会执行 Worker 脚本：
静态资源请求**免费且无限**，不计入 Workers 免费版 100,000 次/天 的请求配额，
免费版 10ms CPU 限制同样不适用。与现有 Azure + Nginx 上的 Broker 完全解耦，
欢迎页挂了不影响控制台，控制台的 Basic Auth 也不会被绕过。

但**下载文件不放 Workers**：

| 限制（Workers 免费版） | 值 | 对本项目的影响 |
|---|---|---|
| 单个静态资源文件 | **25 MiB**（付费版同样是 25 MiB） | 桌面端自包含单文件 70–90 MB 直接超标；Go worker 二进制也贴着红线 |
| 每版本静态资源文件数 | 20,000 | 欢迎页只有 5 个文件，毫无压力 |
| 静态资源请求 | 免费、无限 | 不计入 Workers 配额 |
| Worker 脚本大小 / CPU | 64 MiB / 10ms | 本站无脚本，不适用 |

所以：**页面在 Workers，安装包在 GitHub Releases**（公开仓库单文件上限 2 GiB、自带 CDN），
页面只放链接。这是这个欢迎页最重要的架构决定，别哪天顺手把 exe 拖进 `public/`。

## 本地预览

```bash
cd home/public
python -m http.server 8080
# 打开 http://127.0.0.1:8080/
```

下载卡片会请求 `api.github.com` 读取最新 Release。本地 `http://` 下 GitHub API 的 CORS
是放行的；被限流或断网时会自动降级为固定直链，页面不会白屏。

手动部署（首次或调试用）：

```bash
cd home
CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=xxx npx --yes wrangler@latest deploy
```

## 一次性配置（已全部完成）

> **2026-11-15 全链路打通：** Worker `starstack-home` 已部署，`home.starstack.run` 已绑定且返回 200；
> `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID` 都已写入仓库 Secrets；
> GitHub Actions 的 `push main` 和 `workflow_dispatch` 均实测成功执行 `wrangler deploy`
> （日志出现 `Uploaded starstack-home`）。
> 现在改完页面文案 push 到 `main` 就会自动上线，不用本地 wrangler，也不用手点 Dashboard。

### 1. GitHub Secrets（已配置，此处留档）

Token 在 <https://dash.cloudflare.com/profile/api-tokens> 用 **Edit Cloudflare Workers** 模板创建：

| 权限 | 用途 |
|---|---|
| `Account / Workers Scripts / Edit` | `wrangler deploy` 必需 |
| `Account / Account Settings / Read` | 模板自带 |
| `Zone / Workers Routes / Edit` 或 `DNS / Edit` | 仅当要让 Wrangler 自己管理 custom domain 才需要；当前配置不需要 |

需要复核或换 token 时，一条命令把部署、域名、Secrets 全部重跑一遍：

```bash
CLOUDFLARE_API_TOKEN=xxx bash home/scripts/setup-cloudflare.sh
```

**别把 `wrangler login` 的 OAuth token 写进 Secrets。** 它带 `expiration_time`（本次授权只有 1 小时），
且 `POST /user/tokens` 与账户级 token 端点对 OAuth 会话都返回 403，派生不出长期 token。
写进去的表现是"今天能部署，一小时后开始报 401"。

设计上的降级行为（留档）：两个 Secret 没配齐时，CI 的部署步骤会**跳过并给出 warning**，
Go 测试和站点校验照常跑，不会把仓库刷成一片红。`wrangler.jsonc` 里刻意没有写
`routes` / `custom_domain`，因此 Token 不需要 Zone / DNS 写权限；
实测最小权限模板在 DNS 记录读取上返回 403，脚本会静默兜住，不影响部署与域名（已绑定时幂等跳过）。

### 2. 自定义域（已完成，此处留档）

`deploy/nginx-mc-subdomain.conf` 的注释写明 `*.starstack.run` 泛解析已由 Cloudflare 覆盖。
实测 `home.starstack.run` 绑定前**没有精确 DNS 记录**，泛解析不冲突；custom domain 是精确匹配，
优先级高于泛解析。原区域 SSL 模式保持 **Full / Full (strict)** 即可。

绑定用的是 API（不是 Dashboard 手点）：

```bash
PUT https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/domains
{ "hostname": "home.starstack.run", "service": "starstack-home",
  "enabled": true, "zone_id": "$ZONE_ID", "zone_name": "starstack.run" }
```

复核：`curl -I https://home.starstack.run/` → 200。证书由 Cloudflare 自动签发，无需自己申请。
想让 Wrangler 每次部署都自己管理域名，给 Token 补 `Zone:Read` + `DNS:Edit`，
再按 `wrangler.jsonc` 顶部注释把 `routes` 段加回去。

## 流水线

| 工作流 | 触发 | 做什么 |
|---|---|---|
| `ci.yml` | push 到 `main` / `dev`、PR 到 `main`、手动 | `gofmt` 检查、`go vet ./...`、`go test ./...`、欢迎页 JS 语法 + `verify-site.cjs`；`main` 上额外部署欢迎页 |
| `release.yml` | push `v*` 标签、手动填 tag | 四条构建线并行：Go 六平台节点 + Broker / Windows RNW 桌面包 / Android APK / 小程序+鸿蒙源码包 → 汇总生成 `SHA256SUMS.txt` → 创建 GitHub Release → 刷新欢迎页 |
| `desktop-rn.yml` | PR / push（`apps/desktop-rn/**` 变更）、手动 | 在 `windows-latest` 上 init-windows + MSBuild 编 RNW 0.84 桌面端，产出 `StarStack-Desktop-RN.zip`；被 `release.yml` 以 reusable workflow 复用 |

`verify-site.cjs` 专门防一类事故：**页面下载清单与 CI 实际产出的文件名漂移**。
它要求 `app.js` 的 `ASSETS`（12 个文件）与 `release.yml` 的构建目标完全一致，
连筛选 tab 的 `data-group` 都要能对上实际分组，改一边忘改另一边会直接让 CI 失败。

### 四端产物与构建条件

| 端 | Release 资产 | 形态 | 怎么构建 |
|---|---|---|---|
| Windows 桌面 | `StarStack-Desktop-RN.zip` | 压缩包（RNW 原生端，约 21 MB，已内嵌 JS bundle） | `desktop-rn.yml`：`windows-latest` 上 `init-windows` + `run-windows --release`；旧的 WPF 套壳 `StarStack.Desktop.exe` 已停止发布 |
| Android | `StarStack-RN.apk` | 安装包（release，内嵌 JS bundle） | `apps/mobile-rn` 跑 `expo prebuild` + `gradlew :app:assembleRelease`（JDK 17 + Android SDK/NDK） |
| 微信小程序 | `starstack-miniapp-source.zip` | **源码包** | 直接打包 `apps/miniapp`；`appid` 是 `touristappid` 测试号，需用微信开发者工具「导入项目」 |
| HarmonyOS NEXT | `starstack-harmony-source.zip` | **源码包** | 打包 `apps/harmony`（ArkTS 壳 + 已内嵌的 `rawfile/web`）与 `apps/harmony-rn`（RNOH）；CI 会先跑 `npm run harmony` 预生成 `hermes_bundle.hbc` 一起打进去，HAP 本身仍需 DevEco Studio 5.x + 华为账号签名 |
| 算力节点 | 6 个 `starstack-worker-*` + `starstack-server-linux-amd64` | Go 静态二进制 | 纯交叉编译，最快最稳 |

小程序和鸿蒙刻意标成**源码包**：微信里不存在「下载安装小程序」这回事，鸿蒙 HAP 也必须在
DevEco 里签名。页面 `download-legend` 把这两条限制写在明处，不给伪安装包。

`build-desktop-rn` / `build-android` 带 `continue-on-error` 与超时，
**只有 Go 门禁失败才会阻断发布** —— 工具链下载挂了时，Release 仍然带着 Go 产物发出去，
页面把缺失的那张卡标成「该版本未包含」，不会出现死链。

### 首次上线完整步骤

```bash
# 1. 配好上面两个 Secrets，提交本次改动
git add home .github README.md && git commit -m "新增 home.starstack.run 欢迎页与 CI/CD"
git push origin main                 # CI 校验 + 部署 Worker

# 2. 在 Dashboard 绑定 home.starstack.run（一次性）

# 3. 打标签触发编译发布
git tag v0.1.0 && git push origin v0.1.0
```

也可以在 Actions 页面手动运行 `Release`，填一个 tag，不必打 git 标签。

## 下载区的工作机制

- 下载区按 **Windows 桌面 / Android / 微信小程序 / HarmonyOS / 算力节点** 五组筛选，
  共 12 个资产；源码包按钮显示「下载源码」，不会让人误以为能直接装到手机上。
- 每个卡片的链接是 `https://github.com/ZJDqtjs/StarStack/releases/latest/download/<file>`。
  这是 GitHub 的重定向直链，**不需要 API、不需要 JS**，首个 Release 上线后自动生效。
- `app.js` 再异步读一次 GitHub Releases API 做增强：显示版本号、发布日期、文件大小，
  并换成带版本的真实下载地址。
- 三种降级状态：
  - **尚无 Release**（API 404）→ 显示黄色提示条，给出 Releases 页面与当前线上 Broker `/dl/` 的兜底链接；
  - **API 限流 / 网络失败** → 保留可用的直链，标注"版本信息未知"；
  - **某资产不在该版本里** → 单张卡片标"该版本未包含"，不会整片区域空白。

## 验收清单

- [ ] `https://home.starstack.run/` 返回 200，控制台无 JS 报错
- [ ] 演示区进入视口后自动播放；勾选「故障注入」能看到 node-b 掉线与分片重派
- [ ] 移动端（窄屏）单列布局，SVG 不横向溢出
- [ ] 五个筛选 tab 都能筛出对应卡片，没有点了没反应的按钮
- [ ] 打 `v*` 标签后，Release 里有 12 个文件：6 个 worker + 1 个 server + 4 个客户端包 + `SHA256SUMS.txt`
- [ ] 四个客户端卡片显示该 tag 与文件大小，点一个链接能正常下载
- [ ] 小程序 / 鸿蒙卡片文案明确写着「源码包」与所需工具
- [ ] `sha256sum -c SHA256SUMS.txt` 通过（覆盖全部二进制、安装包与源码包）
- [ ] `https://home.starstack.run/README.md` 应为 404（文档不进静态产物）

## 常见问题

**改了页面文案，要重新打标签吗？** 不用。push 到 `main` 就会重新部署；
下载区版本号是访客浏览器实时读 GitHub API 的，与页面部署无关。

**某次 Release 少了桌面包或 APK 怎么办？** 说明 `build-desktop-rn` / `build-android` 这两条重工具链
任务失败了（多在下载 .NET 8 / Android SDK 或 Gradle 依赖时超时）。Go 产物和源码包照常发布，
页面会把缺的卡标成「该版本未包含」。到 Actions 里点 Retry 重跑失败任务，或按 `apps/README.md`
本地构建后手动上传资产即可——`SHA256SUMS.txt` 是汇总时统一生成的，手动补传的话记得一起更新。

**为什么小程序和鸿蒙没有安装包？** 小程序只能在微信里通过开发者工具导入源码或扫码体验版，
仓库 `project.config.json` 用的是 `touristappid` 测试号；鸿蒙 HAP 需要 DevEco Studio 5.x（API 12+）
和华为账号自动签名，仓库 `apps/harmony/README.md` 明确写了本机没有 DevEco、ArkTS 壳尚未编译验证。
给一个不存在的「安装包」按钮，比老实给源码包糟糕得多。

**为什么主站是 `starstack.run`，不是 `starstack.com`？** 仓库里 Nginx 配置、客户端默认地址
全部是 `starstack.run`。若 `.com` 另有规划，改 `wrangler.jsonc` 的域名绑定和 `index.html` 的
`og:url` 即可，页面代码里没有硬编码域名（除了兜底的 `/dl/` 链接）。
