/**
 * scripts/tunnel-check.mjs — 公网链路实测（需要外网）。
 *
 *   node scripts/tunnel-check.mjs
 *
 * 做的事：用实验台起一个房主实例 → 开 quick tunnel（cloudflared）→ 拿到
 * https://xxx.trycloudflare.com → 用**公网地址**当 relay 加入、上报、拉快照，
 * 证明「不在同一网段也能协作」。跑完自动关隧道与实例。
 *
 * 如果这台机器没有外网，本脚本会明确失败在「拿到公网地址」这一步，其余功能
 * 仍然可以用 scripts/lab.mjs 完整验证。
 */
import { createCollabHost } from './harness.mjs'
import { encodeMatrix } from '../qr.js'
import { decodeMatrix } from './qr-decode.mjs'

const results = []
async function step(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true })
    console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`)
  } catch (error) {
    results.push({ name, ok: false, detail: String(error && error.message ? error.message : error) })
    console.log(`  FAIL  ${name} — ${error && error.message ? error.message : error}`)
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m)
}
async function json(base, path, init) {
  const response = await fetch(base + path, init)
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text.slice(0, 200) }
  }
  return { status: response.status, body, text }
}
const post = (base, path, value) =>
  json(base, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value || {}) })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('== 公网隧道实测（需要外网）==')
  const host = await createCollabHost()
  const peer = await createCollabHost()
  console.log(`  房主实例 ${host.origin}   成员实例 ${peer.origin}`)
  try {
    let tunnelUrl = ''
    await step('探测 cloudflared 可执行文件', async () => {
      const { status, body } = await json(host.origin, '/dsh-collab/api/tunnel/probe')
      assert(status === 200, `状态 ${status}`)
      assert(body.bin, '没找到 cloudflared（可设 DSH_COLLAB_CLOUDFLARED 指向二进制）')
      return body.bin
    })

    await step('房主创建协作室', async () => {
      const { status, body } = await post(host.origin, '/dsh-collab/api/create', { name: '公网房主' })
      assert(status === 200, `状态 ${status}`)
      assert(body.invite && body.invite.code, '没有邀请码')
      return `code=${body.invite.code} 项目=${body.project && body.project.name}`
    })

    await step('开启公网隧道（cloudflared quick tunnel）', async () => {
      const { status, body } = await post(host.origin, '/dsh-collab/api/tunnel/start', {})
      assert(status === 200 && body.ok, `失败：${JSON.stringify(body.error || body).slice(0, 160)}`)
      tunnelUrl = body.tunnel.url
      assert(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(tunnelUrl), `地址不合法：${tunnelUrl}`)
      return tunnelUrl
    })
    if (!tunnelUrl) {
      console.log('  结论：这台机器没能开隧道（网络或二进制问题），协作本身请用 npm run lab 验证。')
      return
    }

    await step('邀请链接与二维码都改指公网地址', async () => {
      const { body } = await json(host.origin, '/dsh-collab/api/state')
      assert(body.invite.channel === 'tunnel', `channel=${body.invite.channel}`)
      assert(body.invite.primaryUrl.startsWith(tunnelUrl), `primaryUrl=${body.invite.primaryUrl}`)
      const decoded = decodeMatrix(encodeMatrix(body.invite.primaryUrl, 'M'))
      assert(decoded.text === body.invite.primaryUrl, '二维码内容不一致')
      return `${body.invite.primaryUrl.length} 字节`
    })

    await step('公网 relay 健康检查（真·跨网段入口）', async () => {
      const { status, body } = await json(tunnelUrl, '/dsh-collab/relay/health')
      assert(status === 200, `状态 ${status}`)
      assert(body.ok === true, '健康检查未通过')
      return `room=${body.room}`
    })

    await step('用公网地址 join / report / snapshot', async () => {
      const state = await json(host.origin, '/dsh-collab/api/state')
      const code = state.body.code
      const publicRelay = `${tunnelUrl}/dsh-collab/relay`
      const join = await post(publicRelay, '/join', { code, name: '公网成员', machine: 'REMOTE' })
      assert(join.status === 200, `join ${join.status} ${JSON.stringify(join.body).slice(0, 120)}`)
      const token = join.body.token
      const report = await post(publicRelay, '/report', {
        token,
        sessions: [{ id: 'remote-1', label: 'remote-repo', status: 'running', tool: 'bash', note: '从公网加入', turn: 1, tokensIn: 800, tokensOut: 120, at: Date.now() }],
      })
      assert(report.status === 200, `report ${report.status}`)
      const snap = await json(publicRelay, `/snapshot?token=${token}`)
      const member = snap.body.members.find((m) => m.name === '公网成员')
      assert(member && member.sessions[0].tool === 'bash', '公网成员进度没进来')
      return `成员 ${snap.body.members.length} 个`
    })

    await step('成员实例用公网地址加入并同步', async () => {
      const state = await json(host.origin, '/dsh-collab/api/state')
      const joined = await post(peer.origin, '/dsh-collab/api/join', {
        relay: `${tunnelUrl}/dsh-collab/relay`,
        code: state.body.code,
        name: '公网成员2',
      })
      assert(joined.status === 200, `join ${joined.status}`)
      await wait(2400)
      const hostState = await json(host.origin, '/dsh-collab/api/state')
      const names = hostState.body.members.map((m) => m.name)
      assert(names.includes('公网成员2'), `房主侧成员：${names.join(',')}`)
      return names.join(' / ')
    })

    await step('关闭隧道后公网入口立即失效', async () => {
      const stopped = await post(host.origin, '/dsh-collab/api/tunnel/stop', {})
      assert(stopped.status === 200, `状态 ${stopped.status}`)
      let reachable = true
      try {
        const probe = await fetch(`${tunnelUrl}/dsh-collab/relay/health`, { signal: AbortSignal.timeout(6000) })
        reachable = probe.ok
      } catch {
        reachable = false
      }
      assert(!reachable, '隧道关了但公网仍可访问')
      return '公网入口已关闭'
    })
  } finally {
    await host.close()
    await peer.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
  if (failed.length) {
    console.log('失败项：')
    for (const item of failed) console.log(`  · ${item.name} — ${item.detail}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('隧道实测脚本自身出错：', error)
  process.exitCode = 1
})
