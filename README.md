# 星栈算力 · StarStack

闲置算力共享交易平台。Broker 把任务切片派发给 NAT 后的算力节点，节点回传产物；
Broker 独立重算 SHA-256 校验、无损合并、按量结算，并与单机基线实测对比出真实加速比。

- 项目主页 / 演示 / 下载：<https://home.starstack.run/>
- 源码：<https://github.com/ZJDqtjs/StarStack>
- 实测日志、验收细节与论文素材：[docs/实测与验收记录.md](docs/实测与验收记录.md)
- 部署与 CI/CD 说明：[home/README.md](home/README.md)

> 仓库另含 **React 星舷控制台 + 独立管理控制台**（`web-react/`），见「控制台与客户端」。

## 快速开始

```bash
bash scripts/run-demo.sh        # 起 Broker + 2 节点、生成 60s 测试片并提交任务
# 浏览器打开 http://127.0.0.1:8787/
```

手动启动：

```bash
go build -o bin/starstack-server ./cmd/server     # Windows 请给输出名加 .exe
go build -o bin/starstack-worker ./cmd/worker

./bin/starstack-server --data ./data --addr :8787
./bin/starstack-worker --id dorm-pc --server http://127.0.0.1:8787 --slots 2
```

任务接口需要先登录（控制台注册，或照 `scripts/smoke.sh` 里的 curl 流程）。跨机演示必须给 Broker
传 `--base-url <节点可达的地址>`，否则节点拿不到源片下载地址。

## 验证

| 命令 | 验证内容 |
|---|---|
| `go test ./...` | 调度、结算、工作流、静态资源等单元测试（不需要 ffmpeg） |
| `bash scripts/smoke.sh` | 端到端 11 步：注册 → 认领 → 报价 → 提交 → 分片结算 → 账单 → 越权检查 |
| `bash scripts/fault-test.sh` | 跑到一半杀节点，看分片被租约回收重派 |
| `python scripts/restart-test.py` | 任务在飞时重启 Broker，检查恢复与无重复结算 |
| `node scripts/verify-comfy-workbench.cjs` | ComfyUI 工作台模板与 UI ↔ API 往返 |

## 能做什么

| 链路 | 切片单位 | 要点 |
|---|---|---|
| 视频转码 | 视频秒（IDR 帧对齐） | ffprobe 抽关键帧 → `-ss` 精确 seek → concat `-c copy` 无损拼接 |
| Blender 渲染 | 帧 | 节点回传 PNG 包，Broker 排序后用 ffmpeg 编码成片 |
| PR / FCPXML 时间线 | 视频秒 | 解析剪辑点切片，参数不一致时自动转码兜底 |
| 模型网关 | token | OpenAI 兼容 API，按模型低价路由、计量与 90/10 分成；本分支含 agent 试聊 |
| IPv6 云主机 | 运行秒 | 卖方 Agent 用 QEMU 拉起镜像 + cloud-init，按 IPv6/端口映射接入，按秒结算 |
| 编译打包 | 墙钟分钟 | 上传源码 zip，节点执行构建命令回传 `result.zip`，失败不结算 |

六条链路共用同一套「切片 → 派发 → 校验 → 合并 → 结算」骨架，区别只在切片单位与执行命令。

## 架构与关键选型

| 层 | 选择 | 理由 |
|---|---|---|
| Broker / Agent | Go，单一 codebase | 交叉编译出静态二进制，丢到任意闲置机器就能跑，不装运行时 |
| 通信 | Worker 主动发起的 HTTP 长轮询 | 家庭 / 宿舍机器在 NAT 后没有公网 IP，出站拉任务天然穿透 |
| 执行 | ffmpeg / Blender 子进程 | 复用成熟引擎，系统贡献在分片策略与调度，不在编码器 |
| 状态 | SQLite（`modernc.org/sqlite`，纯 Go 免 CGO） | 账户 / 租约 / 流水要跨重启存活；纯 Go 驱动维持「一个二进制」前提 |
| 内嵌前端 | `go:embed` 单页 HTML | 零构建链，二进制自带控制台与 ComfyUI 工作台 |

三条真正决定正确性的机制：

- **软评分匹配**：硬约束过滤后按 `实测吞吐 × 信誉 × (池均价 ÷ 单价)^权重 ÷ (1 + 占用)` 打分；
  派发即占槽，并把当时报价冻进分片，之后节点改价不影响在飞任务。
- **预扣 → 按量结算 → 退还**：按最贵可行节点保守预扣，每片双 SHA-256 校验一致后按冻结价结算，
  结束退还差额。节点贡献与卖家贡献分两套口径记账。
- **租约回收 + 所有权校验**：25s 无心跳立即回收分片并写入该分片的 Excluded 名单；
  老节点迟到的回传一律 409，不会二次结算。SQLite write-through，重启后在飞分片自动重派。

## 控制台与客户端

| 入口 | 启动 / 地址 | 说明 |
|---|---|---|
| 内嵌控制台 | `:8787/` | `go:embed` 单页，二进制自带，零构建 |
| React 星舷控制台 | `cd web-react && npm i && npm run dev` → `:5174` | 全视图路由 + 总览仪表盘 |
| 管理控制台 | `cd web-react && npm run dev:admin` → `:5175` | 独立 `admin.html`、独立认证，管理面走 `/api/admin/*` |
| Windows 桌面 | `StarStack-Desktop-RN.zip` | `apps/desktop-rn`，RNW 原生渲染（已内嵌 JS bundle），CI 构建 |
| Android | `StarStack-RN.apk` | `apps/mobile-rn`，RN 界面 + Kotlin 前台 Service（同时是算力节点） |
| 鸿蒙 / 小程序 | 见 [apps/README.md](apps/README.md) | 鸿蒙是 ArkWeb 壳（内嵌同一份 dist）；小程序是原生 WXML |

两套 Vite 配置都代理 `/api`、`/download`、`/launch`、`/dl`、`/comfy`、`/v1`，
**默认指向 `http://127.0.0.1:8799`（模拟 Broker）**；连真实 Broker 时覆盖：

```bash
STARSTACK_BROKER=http://127.0.0.1:8787 npm run dev
```

管理控制台口令由 `STARSTACK_ADMIN_PASSWORD` 提供；构建产物在 `web-react/dist-admin/`：

```bash
npm run build:admin
```

> `dev:admin` / `build:admin` 等价于 `npx vite --config vite.admin.config.js` 与
> `npx vite build --config vite.admin.config.js`。若检出里还没有这两个 script，用等价命令即可。

## 公网部署

`--public` 会关掉三样演示便利，因为它们在公网 IP 上都是攻击面：
Broker 本地路径当任务源（任意文件读）、待认领列表（抢别人机器）、自助充值（白送点数）。

| 变量 / 参数 | 用途 |
|---|---|
| `--public` | 切换公网策略档 |
| `STARSTACK_AGENT_TOKEN` / `--agent-token` | Agent 首次注册的共享密钥，走环境变量不进 `ps` |
| `STARSTACK_SIGNUP_INVITE` / `--signup-invite` | 新用户注册邀请码 |
| `STARSTACK_ADMIN_PASSWORD` | 管理控制台口令 |
| `--trust-proxy` | **只有**前面确实有 Nginx / Cloudflare 时才开，否则任何人可伪造 XFF 绕过限流 |

部署件在 `deploy/`：`deploy.sh`（交叉编译 + systemd）、`enable-nginx.sh`（反代，先 `nginx -t`、
失败自动回滚）、`nginx-starstack-domain.conf`（starstack.run 独立域名入口）。

## 实测结论（摘要）

| 指标 | 值 |
|---|---|
| 真实加速比 | **1.45×**（分布式 7.5s / 单机基线 10.9s） |
| 分片并行度 | 3.3× |
| 哈希校验 | 4/4 一致 |
| 拼接产物 | 60.1s，全片解码无错误 |

条件：60s 1080p → 720p、4 分片、libx264 veryfast、Ryzen 7 6800H / RTX 3060 Laptop。
**诚实说明**：所有节点跑在同一台机器上抢同一组 CPU/GPU，加速比不是节点数的线性函数；
1.45× 只证明调度与度量链路打通，不代表跨机收益。完整日志、第二轮验收、11 条已知限制与
毕设扩展路径见 [实测与验收记录](docs/实测与验收记录.md)。

## 目录结构

```
cmd/server, cmd/worker   Broker / 算力节点
internal/hub             调度、结算、鉴权、策略、管理面、go:embed 控制台
internal/ffx, render     切片 / 转码 / 拼接、Blender 与时间线解析
internal/vm, vmhost      IPv6 云主机契约与 QEMU Agent
internal/store           SQLite 持久化
web-react/               React 星舷控制台 + 独立管理控制台
apps/                    RN 安卓 / RNW 桌面 / 鸿蒙壳 / 微信小程序
deploy/, scripts/        部署件与验收脚本
docs/                    对接文档、运营备忘、开题报告、实测归档
```

## 文档索引

- [星舷控制台 · 后端对接与改造](docs/星舷控制台-后端对接与改造.md) — 全量 API 清单、鉴权、改造状态
- [上游供给与运营决策备忘](docs/上游供给与运营决策备忘.md)
- [自营上游接入行动清单](docs/自营上游接入行动清单.md)
- [开题报告](docs/开题报告-星栈算力.md)
- [移动端与小程序](apps/README.md)
- [实测与验收记录](docs/实测与验收记录.md)
