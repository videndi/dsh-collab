/**
 * scripts/status-page.mjs — 中继自检页：打开就能看到「relay 地址 + 房间码 + 各房间看板」。
 *
 * 目的：不再靠人嘴对嘴复制地址。房主把 /dsh-collab/status 这个链接发出去，
 * 对方打开后照页面上的两行字填进自己的 DSH 即可。
 */
export function statusHtml(payload) {
  const { relay, host, rooms, updatedAt } = payload
  const rows = rooms.length
    ? rooms
        .map(
          (room) =>
            `<div class="row"><div><div class="code">${room.code}</div><div class="meta">房主 ${escapeHtml(room.host || '-')} · ${room.members} 人在线</div></div>
             <div class="ops"><a class="btn" href="/dsh-collab/watch?c=${room.code}">打开看板</a>
             <a class="btn ghost" href="/dsh-collab/join?c=${room.code}">加入说明</a></div></div>`,
        )
        .join('')
    : '<div class="empty">还没有房间。在房主的面板里点「创建协作室」，或直接用下面的邀请码让中继建房。</div>'
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>dsh-collab 中继自检</title>
<style>
:root{color-scheme:dark}
body{margin:0;font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#0d1117;color:#e6edf3;display:flex;justify-content:center;padding:28px 16px}
.wrap{width:100%;max-width:720px}
h1{font-size:19px;margin:0 0 4px}
.sub{color:#8b949e;font-size:13px;margin:0 0 18px}
.card{border:1px solid #21262d;border-radius:12px;background:#11161d;padding:16px;margin-bottom:14px}
.k{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8b949e}
.v{margin:6px 0 0;padding:10px 12px;border:1px solid #30363d;border-radius:8px;background:#0d1117;
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
ol{margin:8px 0 0;padding-left:20px;color:#c7cfd9;font-size:13.5px}
ol li{margin:5px 0}
code{background:#1c2430;padding:1px 5px;border-radius:4px;font-size:12.5px}
footer{color:#6e7681;font-size:12px;margin-top:8px}
</style></head><body><div class="wrap">
<h1>中继自检 <span class="ok">● 正常</span></h1>
<p class="sub">这台中继在跑，公网可达。下面两行是要填进自己 DSH 的东西。</p>

<div class="card">
  <div class="k">Relay 地址（填进「加入别人的协作室」）</div>
  <div class="v" id="relay">${escapeHtml(relay)}</div>
  <div class="k" style="margin-top:12px">在跑的协作室</div>
  ${rows}
</div>

<div class="card">
  <div class="k">怎么用</div>
  <ol>
    <li>自己的 DSH 新建会话 → 模式选「协作模式」（或任意模式都行）</li>
    <li>输入框下方「开启协作」→「加入别人的协作室」</li>
    <li>Relay 填上面的地址，邀请码填房间里的 6 位码，点「加入」</li>
    <li>不装插件只想围观：点对应房间的「打开看板」</li>
  </ol>
</div>
<footer>dsh-collab 独立中继 · 主机 ${escapeHtml(host || '-')} · ${new Date(Number(updatedAt) || Date.now()).toLocaleString()}</footer>
</div></body></html>`
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
}
