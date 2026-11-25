# dsh-collab relay（独立中继）

一个只做"房间与进度中转"的小服务：**不调模型、不需要账号、不需要登录**。
把它放在一台常开的机器上（VPS / NAS / 队友的电脑），团队随时都能进房间，房主开不开机都不影响。

## 跑起来（3 条命令）

```bash
# 需要 Node 18+（推荐 20/22/24）
node scripts/relay-server.mjs --port 8790 --host 0.0.0.0 --rooms 32
```

启动后它自己会打印：

```
dsh-collab relay 已启动：http://127.0.0.1:8790/dsh-collab/relay
```

给团队用的地址就是 `http://<这台机器的IP或域名>:8790/dsh-collab/relay`。

## 校验

```bash
curl http://<机器>:8790/dsh-collab/relay/health
# {"ok":true,"rooms":0,"host":"...","relay":"http://<机器>:8790/dsh-collab/relay"}
```

浏览器打开下面这个，能看到"该填哪个地址、有哪些房间"：

```
http://<机器>:8790/dsh-collab/status
```

## 数据落在哪

房间与消息写在 `data/rooms.json`（可用 `RELAY_DATA_DIR` 改到别处，例如 `/var/lib/dsh-collab`）。
重启后房间自动恢复；闲置超过 `--idle-hours`（默认 12）的房间会被清掉。

**迁移机器**只需拷贝这个文件。

## 常见部署

- **systemd**：见 `deploy/dsh-collab-relay.service`
- **带 https 域名**：见 `deploy/Caddyfile`（Caddy 自动签证书）
- **只开端口**：云厂商安全组放行 8790 即可，客户端填 `http://IP:8790/dsh-collab/relay`
