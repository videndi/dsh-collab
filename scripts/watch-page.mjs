/**
 * scripts/watch-page.mjs — 独立中继自带的只读看板页面。
 *
 * 给「没装插件的人」用：手机、别的机器、只想围观进度的同事，浏览器打开
 * /dsh-collab/watch?c=<邀请码> 就能看到成员、会话、进展流、成果和消息，
 * 只读、不参与，也不需要安装任何东西。
 */
export function watchHtml(code) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>协作看板 · ${code}</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#0d1117;color:#e6edf3}
header{position:sticky;top:0;backdrop-filter:blur(8px);background:rgba(13,17,23,.86);border-bottom:1px solid #21262d;padding:12px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
h1{font-size:15px;margin:0;font-weight:600}
.badge{font-family:ui-monospace,Menlo,monospace;font-size:13px;letter-spacing:2px;color:#58c4b6;border:1px solid #2a4a46;background:#0f231f;padding:2px 8px;border-radius:6px}
.meta{color:#8b949e;font-size:12px}
main{padding:16px;max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.card{border:1px solid #21262d;border-radius:10px;background:#11161d;padding:12px}
.who{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.dot{width:8px;height:8px;border-radius:50%;background:#3fb950;flex:0 0 auto}
.dot.off{background:#6e7681}
.name{font-weight:600}
.tag{font-size:11px;color:#8b949e;border:1px solid #30363d;border-radius:999px;padding:1px 7px}
.sess{margin-top:8px;padding-top:8px;border-top:1px dashed #21262d}
.srow{display:flex;gap:8px;align-items:center;font-size:12.5px;color:#adbac7;min-width:0}
.ell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.trail{margin:5px 0 0 12px;padding-left:8px;border-left:1px solid #21262d;display:flex;flex-direction:column;gap:3px}
.trow{display:flex;gap:6px;font-size:11.5px;color:#8b949e;min-width:0}
.kind{font-size:10px;border-radius:4px;padding:0 4px;background:#1c2430;color:#9aa7b4;flex:0 0 auto}
.arts{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}
.art{font-size:11px;color:#79c0ff;border:1px solid #1f6feb55;border-radius:999px;padding:1px 8px}
.msgs{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow:auto}
.msg{font-size:13px;word-break:break-word}
.msg b{color:#79c0ff;font-weight:600;margin-right:6px}
.empty{color:#6e7681;font-size:13px}
footer{padding:8px 16px 24px;color:#6e7681;font-size:12px;text-align:center}
</style></head><body>
<header>
  <h1>协作看板</h1>
  <span class="badge">${code || '——'}</span>
  <span class="meta" id="meta">连接中…</span>
</header>
<main>
  <section><div class="meta" style="margin-bottom:8px">成员与进度</div><div id="members" class="empty">加载中…</div></section>
  <section class="card"><div class="meta" style="margin-bottom:8px">协作消息</div><div id="msgs" class="msgs empty">加载中…</div></section>
</main>
<footer>只读看板 · 由 dsh-collab 独立中继提供 · 要参与（发消息 / 分享成果）请在自己的 DSH 里装插件</footer>
<script>
const CODE = ${JSON.stringify(String(code || ''))};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n) => { n = Number(n) || 0; return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); };
const ago = (t) => { const d = Date.now() - (Number(t) || 0); if (!(d >= 0)) return ''; if (d < 60000) return '刚刚'; if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前'; return Math.floor(d / 3600000) + ' 小时前'; };
const esc2 = esc;
function renderMembers(members) {
  if (!members.length) return '还没有成员加入';
  return members.map((m) => {
    const sessions = (m.sessions || []).map((s) => {
      const trail = (s.timeline || []).slice(-4).map((t) =>
        '<div class="trow"><span class="kind">' + (t.kind === 'say' ? '说' : t.kind === 'ask' ? '问' : '做') + '</span>'
        + '<span class="ell" style="flex:1">' + esc2((t.tool ? t.tool + ' ' : '') + (t.text || '')) + '</span>'
        + '<span style="flex:0 0 auto">' + ago(t.at) + '</span></div>').join('');
      const arts = (s.artifacts || []).map((a) =>
        '<span class="art">📄 ' + esc2(a.title || '') + (a.bytes ? ' · ' + a.bytes + 'B' : '') + '</span>').join('');
      return '<div class="sess"><div class="srow"><span class="dot' + (s.status === 'running' ? '' : ' off') + '"></span>'
        + '<span class="ell" style="max-width:150px">' + esc2(s.label || s.id) + '</span>'
        + '<span class="ell" style="flex:1">' + esc2((s.status === 'running' ? '研究中' : '空闲') + (s.tool ? ' · ' + s.tool : '') + (s.note ? ' · ' + s.note : '')) + '</span>'
        + '<span style="flex:0 0 auto">' + fmt((s.tokensIn || 0) + (s.tokensOut || 0)) + ' tok</span></div>'
        + (trail ? '<div class="trail">' + trail + '</div>' : '')
        + (arts ? '<div class="arts">' + arts + '</div>' : '')
        + '</div>';
    }).join('');
    return '<div class="card"><div class="who"><span class="dot' + (m.online ? '' : ' off') + '"></span>'
      + '<span class="name">' + esc2(m.name) + '</span>'
      + '<span class="tag">' + esc2(m.machine || '') + '</span>'
      + '<span class="meta" style="margin-left:auto">' + ago(m.updatedAt) + '</span></div>'
      + (sessions || '<div class="empty">暂无会话</div>') + '</div>';
  }).join('');
}
async function tick() {
  try {
    const res = await fetch('/dsh-collab/relay/board?code=' + encodeURIComponent(CODE), { cache: 'no-store' });
    if (!res.ok) {
      document.getElementById('meta').textContent = res.status === 404 ? '房间不存在（检查邀请码）' : '看板不可用';
      return;
    }
    const data = await res.json();
    document.getElementById('meta').textContent = '房主 ' + (data.host || '-') + ' · ' + data.members.length + ' 人 · 更新于 ' + new Date().toLocaleTimeString();
    document.getElementById('members').className = data.members.length ? '' : 'empty';
    document.getElementById('members').innerHTML = renderMembers(data.members);
    const msgs = data.messages || [];
    const box = document.getElementById('msgs');
    box.className = msgs.length ? 'msgs' : 'msgs empty';
    box.innerHTML = msgs.length
      ? msgs.slice(-40).map((m) => '<div class="msg"><b>' + esc2(m.name) + '</b>' + esc2(m.text) + '</div>').join('')
      : '还没有消息';
  } catch (error) {
    document.getElementById('meta').textContent = '中继不可达：' + (error && error.message ? error.message : error);
  }
}
tick();
setInterval(tick, 2500);
</script></body></html>`
}
