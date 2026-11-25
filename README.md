# dsh-collab — DSH 多人协作研究室

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

## 安装

把本目录放到任意位置，在你的 DSH 里（协作模式 / 创造模式都行）让 agent 执行：

```
plugin_manager action=install_bundle target=<本目录绝对路径>
```

然后**重启一次 DSH**（Host 侧 JS 不热替换），刷新页面即可在输入框下方看到协作面板。

## 用起来

1. 新建会话 → 模式选 **协作模式**。
2. 输入框下方「开启协作」→ 填名字 → **创建协作室**。房间会绑定到当前项目（取最近会话的目录名，可手填）。
3. 想跨网段就点 **公网邀请**，几秒后二维码与链接变成 `https://…trycloudflare.com`。
4. 朋友把邀请链接在自己的 DSH 里打开 → 面板自动带出 relay 与邀请码 → 点「加入」；
   也可以扫码，或粘贴 `relay=… code=…`。
5. 面板里能看到每个成员的会话卡：谁在跑、调哪个工具、最近在做什么、turn、token；还有房间合计。
6. 没有第二个人时点 **本机实验**，进程内拉起 2 个模拟成员，走真实 HTTP 回环，立刻看到多人效果。

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
- quick tunnel 是临时域名，重开就是新地址；要固定域名请自建 named tunnel 并把 `relay` 指过去。

## 许可

MIT。见 [LICENSE](LICENSE)。
