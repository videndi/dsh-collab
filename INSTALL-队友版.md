# 给队友：dsh-collab 安装说明（5 步）

> 这是一个 DSH 插件，**必须装**才能在自己那边看到协作面板与队友进度。
> 不装只能用浏览器打开邀请落地页看说明，看不到任何人的进度。

## 1. 解压

把这个 zip 解压到任意目录，例如 `D:\dsh-collab`。
解压后该目录里应该能直接看到 `package.json`、`index.js`、`cordis.patch.yml`。

## 2. 装进你的 DSH

打开你的 DeepSeek Harness，新建会话（标准模式/创造模式都行），把下面这句发给它：

```
plugin_manager action=install_bundle target=<上一步的绝对路径>
```

例如：

```
plugin_manager action=install_bundle target=D:\dsh-collab
```

它会跑一次安装，最后返回 `application: applied` 就成功了。

## 3. 重启 DSH

Host 侧代码不热替换，必须重启一次（关掉窗口重开即可）。
重启后刷新页面。

## 4. 加入房间

输入框下方会出现「协作室 · 未开启」→ 点「开启协作」，在「加入别人的协作室」里填：

| 字段 | 值 |
|---|---|
| Relay 地址 | 房主给你的 `https://…/dsh-collab/relay` |
| 邀请码 | 房主给你的 6 位码 |

点「加入」。也可以把房主发的邀请链接整段粘贴进「粘贴邀请链接或二维码文本」，点「识别」再点「加入」。

加入后会被记住，以后重启 DSH 会自动回到这个房间。

## 5. 用法

- 面板里能看到每个成员：谁在跑、调哪个工具、最近在做什么、花了多少 token；
- 每人的会话下面有「做 / 说 / 问」进展流，点「📄 文件名」能看队友交付的文件正文；
- 「分享成果」贴一个本机路径，就能把文件推到房间里给队友看；
- 各自的模型调用、各自的账号、各自的 token —— 谁也不影响谁。

## 常见问题

**面板没出现**：插件没装成功（看 `plugin_manager action=list_plugins` 里有没有 `dsh-collab`），或没重启 DSH。

**加入报 403 / wrong invite code**：邀请码不对（大小写不敏感，但别漏字符），或 relay 地址少了 `/dsh-collab/relay`。

**加入报连不上**：先在自己浏览器打开 `https://…/dsh-collab/relay/health`，能看到 `{"ok":true,...}` 才说明 relay 通。

**想自己单独用（不进房间）**：不点加入就行，面板的「本机看板」照样显示你自己的进度。
