# dsh-collab — DSH 多人协作研究室

中文 | [English](README.en.md)

> 给 [DeepSeek Harness](https://github.com/deepseek-ai) 加一个**协作模式**：把朋友邀请进你的项目，
> 每个人在自己的机器、自己的账号、自己的 token 上跑研究，所有人的会话进度、当前工具调用、
> token 用量和协作消息实时汇总到同一块面板。
>
> 跨网段不用同一条 LAN —— 一键开 Cloudflare quick tunnel，邀请链接/二维码直接可用，不暴露 DSH 界面本身。

英文摘要：A collaboration plugin for DeepSeek Harness. Pick the **Collaboration** preset for a new session,
create a room bound to your project, invite teammates with a link or QR code (LAN or public tunnel),
and watch every member's live session progress, tool activity and token usage — each on their own account.

## 为什么是「各花各的 token」

协作不共享账号、不代理推理。插件只同步**摘要**（会话标题、当前工具名、最近一句输入、turn 数、
token 计数），模型调用永远发生在各人自己的机器上，用各人自己的 provider/凭据计费。
房主不需要替别人付钱，别人也看不到你的对话正文。

## 三种到达方式

| 场景 | 拿到什么 | 需要什么 |
|---|---|---|
| 同一台机器（试玩/实验） | `http://127.0.0.1:<port>/…` | 什么也不需要，面板里一键「本机实验」就行 |
| 同一局域网 | `http://<你的局域网 IP>:<port>/…`，自动探测并替换 `127.0.0.1` | 双方在同一网段 |
| **任意网络（跨网段）** | `https://<随机名>.trycloudflare.com/…` | 能出网的机器；点「公网邀请」即可，不需要 VPS、不需要端口映射 |

公网隧道只暴露插件自己起的小服务（`/dsh-collab/relay/*` 与邀请落地页），**不暴露 DSH 的 Web UI**。
隧道随 DSH 关闭而失效。

## 一个客厅 + 各自的工作区

把协作想成一套房子：

| 区域 | 谁能看 | 内容 |
|---|---|---|
| **客厅（房间）** | 房间里的所有人 | 成员、各自在做什么、交付的成果文件、协作消息 |
| **我的工作区** | 只有你自己 | 你在这个会话里的问答全过程 |

- **问答分离**：默认**不**把你模型的输出片段发给房间，只共享"做了什么 + 交付了什么"。
  需要互相看输出时，面板上一个开关就能打开（`共享输出片段`），随时也能关掉。
- **资料共享**：`write` / `edit` / `present` 交付的文件、以及你手动「分享成果」的文件，房间成员可以点开看正文（≤32KB）。
- 房子本身（房间）住在中继上：**谁退出都不影响别人**，每个人的问答始终只在自己的机器上。

## 像加微信一样进房间：只要房间号

中继地址全团队只需要填一次（面板「第 0 步」），之后：

1. 面板里输入 **房间号**（6 位，例如 `YBEUE8`）→ 点「查找」；
2. 插件会去中继上"搜"这个房间，显示 **房主 + 在线人数**（先确认是不是这个屋）；
3. 点「进入客厅」→ 就进去了。

创建房间的人把房间号发出去（6 个字符，手抄也不会错），其他人只输号。房间号可以自己指定（`POST /relay/join` 带 `create:true` 时用你给的 code 建房）。

**关于"没有网络要求"**：中继必须有一个双方都能访问的地址，这是物理限制，无法绕过。但它只需要存在一次，且不必是公网域名——局域网 IP、Tailscale 内网地址都可以，成员端不需要做任何网络配置。

### 拓扑：谁在当中继

| 拓扑 | 谁必须在线 | 邀请链接 | 适合 |
|---|---|---|---|
| 插件内置 relay（默认） | 房主的 DSH 进程 | 临时：回环 / 局域网 IP / trycloudflare | 临时拉几个人一起看 |
| **独立 relay**（团队推荐） | 一台跑 `relay-server.mjs` 的机器 | 固定：你给它配的域名（Tailscale Funnel / nginx） | 长期团队看板；谁退出都不影响别人 |
| 无 relay（个人看板） | 只有你自己的 DSH | 不需要 | 只想看自己的进度 |

独立 relay 只做房间与进度中转：**不调模型、不需要登录任何账号**。所以「我没登录账号 / 我关掉 DSH」不会连累队友。

```bash
node scripts/relay-server.mjs --port 8787 --host 127.0.0.1
# 需要公网固定地址时（Tailscale 示例）：
tailscale funnel 8787        # 得到 https://<机器>.<tailnet>.ts.net
```

然后在面板「加入别人的协作室」里填 `https://<机器>.<tailnet>.ts.net/dsh-collab/relay` + 邀请码。
房间不存在时会在 relay 上直接建（默认 create），所以团队里谁都能第一个开房。

### 只读看板（不装插件也能看）

独立 relay 自带一个网页看板：`https://<relay 域名>/dsh-collab/watch?c=<邀请码>`。
手机、别的机器、不想装插件的同事，浏览器打开就能每 2.5 秒刷新看：成员、会话、做/说/问进展流、
成果文件名、协作消息。**只读**——发消息、分享成果、让自己的进度可见，仍需在自己 DSH 里装插件。

### 固定地址（邀请链接不再每次都变）

面板里「固定地址」填一个能访问到 `/dsh-collab/relay` 的 URL，点「保存地址」，邀请链接与二维码就固定用它；
「检测」会现场请求 `/relay/health` 验证是否真的通。反向代理只转发 `/dsh-collab/` 前缀时，DSH 界面不会外泄。

## 安装

```bash
git clone https://github.com/videndi/dsh-collab.git
```

然后在你自己的 DSH 里（协作模式 / 创造模式都行）让 agent 执行，target 用刚克隆下来的目录：

```
plugin_manager action=install_bundle target=<克隆目录的绝对路径>
```

最后**重启一次 DSH**（Host 侧 JS 不热替换），刷新页面，输入框下方就会出现协作条。

> 朋友那边同样一份代码、同样一条命令，各人用各人的账号，token 各算各的。

## 用起来

1. 新建会话 → 模式选 **协作模式**。
2. 输入框下方「开启协作」→ 填名字 → **创建协作室**。房间会绑定到当前项目（取最近会话的目录名，可手填）。
3. 想跨网段就点 **公网邀请**，几秒后二维码与链接变成 `https://…trycloudflare.com`。
4. 朋友把邀请链接在自己的 DSH 里打开 → 面板自动带出 relay 与邀请码 → 点「加入」；
   也可以扫码，或粘贴 `relay=… code=…`。
5. 面板里能看到每个成员的会话卡：谁在跑、调哪个工具、最近在做什么、turn、token；还有房间合计。
6. 没有第二个人时点 **本机实验**，进程内拉起 2 个模拟成员，走真实 HTTP 回环，立刻看到多人效果。

## 互相观看进度与成果

成员卡下面不是只有一行状态，而是两条能互相看的东西：

**进展流**（自动，不需要模型配合）——从 `session/event` 折出来，每人的会话下面显示最近几条：

| 标记 | 含义 | 内容 |
|---|---|---|
| 做 | 工具调用 | 工具名 + 参数摘要（命令、文件路径、grep 模式、搜索词…） |
| 说 | 模型这一步的输出 | 文本片段（截断 280 字） |
| 问 | 用户输入 | 截断 200 字 |

**成果**（文件级）——这些会被自动登记成队友可点开的产物：

- `write` / `edit` 落盘的文件
- `present` 交付的文件
- 面板里「分享成果」手填的本机路径

≤32KB 的文本会把正文一起同步，队友点一下就能看到你写出来的报告/代码；更大的文件只同步路径与大小。
正文只对**同一房间的成员**可见，而且只限被登记的那几个文件；不搬运对话历史、不读别的东西。

> 跨机器时文件本身不会自动同步：每个人都操作自己机器上的副本，面板里的产物是「他那边那份」的内容快照。

## 自检与实验（都不依赖 DSH 进程）

```bash
npm run lab             # 自建多人实验：房主 + 成员两个实例都在本机回环，13 项断言
node scripts/tunnel-check.mjs   # 公网链路实测（需要外网）：真开隧道、用公网地址加入
npm run selftest        # 体检运行中的 DSH（默认 127.0.0.1:53796）
```

- `lab.mjs` 用假 Cordis 上下文把 `apply(ctx)` 跑在真实 `node:http` 上，所以不需要重启 DSH 就能验证改动；
  同时它也是协议的回归测试（历史缺陷「插件卸载后路由残留导致 duplicate prefix route」就是它的用例）。
- `qr.js` 是自带的离线二维码编码器（byte 模式、版本 1–40、L/M/Q/H、掩码择优），
  `scripts/qr-decode.mjs` 是独立反向解码器（读格式位 → BCH 校验 → 反掩码 → 逆 zigzag → 反交织 → RS 校验），
  两者不共享代码路径，往返一致才算过。

## 结构

| 文件 | 作用 |
|---|---|
| `index.js` | Host：`webServer` 上的 `/dsh-collab`（状态、邀请、relay、落地页、本机实验、公网隧道）；监听 `session/event` 折出进度卡 |
| `qr.js` | 离线二维码编码器，输出 SVG path |
| `client.js` | Web UI：`conversation.composer.dock` 里的状态栏与面板 |
| `cordis.patch.yml` | 声明 Host 行与**协作模式** preset（工具面等同创造模式 + 多人协作人设） |
| `scripts/harness.mjs` | 假 Cordis 上下文 + 真实 http server 实验台 |
| `scripts/lab.mjs` | 自建多人实验（13 项） |
| `scripts/tunnel-check.mjs` | 公网隧道实测（8 项） |
| `scripts/selftest.mjs` | 二维码往返 + 运行中 DSH 体检 |
| `scripts/qr-decode.mjs` | 二维码反向解码校验 |

协议很短：房主 `/dsh-collab/relay/{join,report,message,snapshot,health}`，成员每 2 秒 `report` 一次并拉
`snapshot`；房主把本机进度与所有成员进度合并后推给浏览器（同源轮询 + SSE）。

## 已知限制

- 房间与成员进度**在内存里**，DSH 重启即清空（协作室是「一起干活期间」的东西）。
- 进度只保留最近 6 小时有活动、最多 40 个会话；只同步摘要，不搬运对话正文。
- 邀请码是房间校验、不是强鉴权。公网隧道地址 + 邀请码一起泄漏，等于房间可被加入——别贴到公开渠道。
- 文件不跨机器同步：每个人操作自己机器上的副本；面板里显示各自的项目路径，避免"以为改的是同一份"。
- quick tunnel 是临时域名，重开就是新地址。要固定地址：用独立 relay + Tailscale Funnel / nginx，或在面板里填「固定地址」。
- 每个人是独立的：各自开各自的会话与看板，各自的账号与 token。relay 只是共享层，某个人没登录、掉线、关掉 DSH，都不会影响其他人。

## 许可

MIT。见 [LICENSE](LICENSE)。
