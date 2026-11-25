/**
 * scripts/status-page.mjs — 中继自检页：把「该填哪个 relay 地址」按网络分别列出来。
 *
 * 教训：公网隧道域名在部分网络会被 RST（ERR_CONNECTION_RESET），
 * 所以页面上同时给出局域网 / Tailscale / 公网三条候选，让使用者自己挑能通的那条。
 */
export function statusHtml(payload) {
  const { host, rooms, updatedAt, currentVia, addresses } = payload
  const rows = rooms.length
    ? rooms
        .map(
          (room) =>
            `<div class="row"><div><div class="code">${room.code}</div><div class="meta">房主 ${escapeHtml(room.host || '-')} · ${room.members} 人在线</div></div>
             <div class="ops"><a class="btn" href="/dsh-collab/watch?c=${room.code}">打开看板</a>
             <a class="btn ghost" href="/dsh-collab/join?c=${room.code}">加入说明</a></div></div>`,
        )
        .join('')
    : '<div class="empty">还没有房间。在房主面板里点「创建协作室」，或让中继用邀请码建房。</div>'
  const addrRows = addresses
    .map(
      (item) =>
        `<div class="addr"><div class="badge2">${escapeHtml(item.label)}</div>
         <div style="min-width:0"><div class="v" style="margin:0">${escapeHtml(item.url)}</div>
         <div class="meta">${escapeHtml(item.note || '')}</div></div></div>`,
    )
    .join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>dsh-collab 中继自检</title>
<style>
:root{color-scheme:dark}
body{margin:0;font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#0d1117;color:#e6edf3;display:flex;justify-content:center;padding:26px 16px}
.wrap{width:100%;max-width:760px}
h1{font-size:19px;margin:0 0 4px}
.sub{color:#8b949e;font-size:13px;margin:0 0 18px}
.card{border:1px solid #21262d;border-radius:12px;background:#11161d;padding:16px;margin-bottom:14px}
.k{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8b949e;margin-bottom:8px}
.v{margin:0;padding:9px 11px;border:1px solid #30363d;border-radius:8px;background:#0d1117;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all}
.ok{color:#3fb950;font-weight:600}
.row{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:10px 0;border-top:1px dashed #21262d}
.row:first-of-type{border-top:none}
.code{font-family:ui-monospace,Menlo,monospace;font-size:20px;letter-spacing:4px;color:#58c4b6}
.meta{font-size:12px;color:#8b949e}
.ops{display:flex;gap:8px}
.btn{font-size:12px;text-decoration:none;color:#e6edf3;border:1px solid #1f6feb;border-radius:7px;padding:6px 12px;background:#0d1c33}
.btn.ghost{border-color:#30363d;background:transparent;color:#adbac7}
.empty{color:#8b949e;font-size:13px}
.addr{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px dashed #21262d}
.addr:first-of-type{border-top:none}
.badge2{flex:0 0 auto;font-size:11px;border:1px solid #30363d;border-radius:999px;padding:2px 8px;color:#adbac7;background:#161b22}
ol{margin:8px 0 0;padding-left:20px;color:#c7cfd9;font-size:13.5px}
ol li{margin:5px 0}
code{background:#1c2430;padding:1px 5px;border-radius:4px;font-size:12.5px}
footer{color:#6e7681;font-size:12px;margin-top:8px}
</style></head><body><div class="wrap">
<h1>中继自检 <span class="ok">● 正常</span></h1>
<p class="sub">中继在跑。你现在是通过 <code>${escapeHtml(currentVia || '-')}</code> 打开这一页的 —— 说明这条通道对你是通的。</p>

<div class="card">
  <div class="k">Relay 地址 / 按你们的网络挑一条（填进「加入别人的协作室」）</div>
  ${addrRows}
</div>

<div class="card">
  <div class="k">在跑的协作室</div>
  ${rows}
</div>

<div class="card">
  <div class="k">怎么用</div>
  <ol>
    <li>自己的 DSH：新建会话 → 模式选「协作模式」（其它模式也行）</li>
    <li>输入框下方「开启协作」→「加入别人的协作室」</li>
    <li>Relay 填上面任意一条能通的地址，邀请码填房间的 6 位码，点「加入」</li>
    <li>不装插件只想围观：点房间的「打开看板」</li>
  </ol>
  <div class="meta" style="margin-top:10px">提示：如果某条地址打不开，换另一条。同一 WiFi 用「局域网」，跨网络用「Tailscale」或「公网隧道」。</div>
</div>
<footer>dsh-collab 独立中继 · 主机 ${escapeHtml(host || '-')} · ${new Date(Number(updatedAt) || Date.now()).toLocaleString()}</footer>
</div></body></html>`
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
}
