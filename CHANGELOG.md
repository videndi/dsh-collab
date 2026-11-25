# 0.3.0

- 新增**公网隧道**：面板一键开 Cloudflare quick tunnel，把 relay 暴露成临时 https 域名，
  跨网段/跨网络都能加入；隧道只指向插件自己的小服务，不暴露 DSH Web UI。
- 拿到域名后会轮询 `/relay/health` 等到边缘真的通再报「已开启」，避免朋友点链接时 502。
- 房间绑定**项目**（取最近会话目录名，可手填），面板显示项目名与目录。
- cloudflared 二进制自动探测（`DSH_COLLAB_CLOUDFLARED` → profile / DSH_HOME / `~/.dsh` / 可执行文件旁）。
- 新增 `scripts/tunnel-check.mjs`：公网链路 8 项实测。

# 0.2.0

- 邀请升级为**链接 + 二维码**：`qr.js` 离线编码器（无 npm 依赖、无外部服务），
  自带独立解码器 `scripts/qr-decode.mjs` 做往返与 RS 校验。
- 新增邀请落地页 `GET /dsh-collab/join?c=CODE`，朋友没装插件也看得懂怎么连。
- 新增「本机实验」：进程内拉起模拟成员，走真实 HTTP 回环，没有第二台机器也能验证多人同步。
- 新增实验台 `scripts/harness.mjs` + `scripts/lab.mjs`（13 项断言），不依赖 DSH 进程。
- 修复：路由 disposer 未挂到 `ctx.effect`，插件卸载后 `/dsh-collab` 路由残留，
  重新装载会报 `duplicate prefix route`。

# 0.1.0

- 首个版本：协作模式 preset、房间 relay、会话进度桥（`session/event`）、成员卡与协作消息、
  输入框下方的协作面板。
