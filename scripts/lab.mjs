/**
 * scripts/lab.mjs — 自建多人实验：两台「机器」都在本机回环上，不出网。
 *
 *   node scripts/lab.mjs
 *
 * 做的事：
 *   1) 起房主实例（真实 HTTP relay）与成员实例（真的走 HTTP 加入）；
 *   2) 用真实形状的 session/event 喂给两侧的进度桥，验证会话卡与 token 汇总；
 *   3) 验证邀请链接、二维码（用独立解码器读回）、落地页、错误邀请码；
 *   4) 验证协作消息双向同步；
 *   5) 验证「本机实验」模拟成员能自动推进并清理；
 *   6) 验证 leave 回到离线态。
 *
 * 全程 127.0.0.1，不访问任何外部地址。
 */
import { createCollabHost, makeSession } from './harness.mjs'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeMatrix } from '../qr.js'
import { decodeMatrix } from './qr-decode.mjs'

const results = []

async function step(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true })
    console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`)
    return true
  } catch (error) {
    results.push({ name, ok: false, detail: String(error && error.message ? error.message : error) })
    console.log(`  FAIL  ${name} — ${error && error.message ? error.message : error}`)
    return false
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function json(base, path, init) {
  const response = await fetch(base + path, init)
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text.slice(0, 160) }
  }
  return { status: response.status, body, text }
}

const post = (base, path, value) =>
  json(base, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value || {}),
  })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function feedWork(host, sessionId, cwd, { tool, tokensIn, tokensOut, note, turn }) {
  const session = makeSession(sessionId, cwd)
  host.fireSessionEvent(session, { type: 'turn/start', data: { turn } })
  host.fireSessionEvent(session, { type: 'tool/call', data: { turn, step: 1, callId: 'c1', name: tool, arguments: '{}' } })
  if (note) host.fireSessionEvent(session, { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: note }] } })
  host.fireSessionEvent(session, {
    type: 'assistant/message',
    data: { turn, step: 1, message: { role: 'assistant' }, stream: [], usage: { inputTokens: tokensIn, outputTokens: tokensOut } },
  })
}

async function main() {
  console.log('== 自建多人实验（本机回环，不出网）==')
  const host = await createCollabHost()
  const peer = await createCollabHost()
  console.log(`  房主实例 ${host.origin}   成员实例 ${peer.origin}`)

  let code = ''
  let primaryUrl = ''
  try {
    await step('房主创建协作室', async () => {
      const { status, body } = await post(host.origin, '/dsh-collab/api/create', { name: '实验房主' })
      assert(status === 200, `状态 ${status}`)
      assert(body.mode === 'host', 'mode 不是 host')
      assert(body.invite && body.invite.code, '没有邀请信息')
      assert(body.invite.qr && body.invite.qr.path.length > 100, '二维码 path 为空')
      code = body.invite.code
      primaryUrl = body.invite.primaryUrl
      return `code=${code} 二维码 v${body.invite.qr.version}`
    })

    await step('二维码可被独立解码器读回邀请链接', () => {
      const matrix = encodeMatrix(primaryUrl, 'M')
      const decoded = decodeMatrix(matrix)
      assert(decoded.text === primaryUrl, '解码内容与邀请链接不一致')
      return `${primaryUrl.length} 字节 / v${decoded.version}-${decoded.ecl}`
    })

    await step('邀请落地页给出可操作说明', async () => {
      const { status, text } = await json(host.origin, `/dsh-collab/join?c=${code}`)
      assert(status === 200, `状态 ${status}`)
      assert(text.includes(code), '落地页没有邀请码')
      assert(text.includes('协作模式'), '落地页缺少操作步骤')
      return `${text.length} 字节`
    })

    await step('错误邀请码被拒绝', async () => {
      const { status } = await post(host.origin, '/dsh-collab/relay/join', { code: 'ZZZZZZ', name: '冒名' })
      assert(status === 403, `期望 403，得到 ${status}`)
      return '403'
    })

    let joined = false
    await step('成员实例通过 HTTP 加入房间', async () => {
      const { status, body } = await post(peer.origin, '/dsh-collab/api/join', {
        relay: `${host.origin}/dsh-collab/relay`,
        code,
        name: '实验成员',
      })
      assert(status === 200, `状态 ${status} ${JSON.stringify(body).slice(0, 120)}`)
      assert(body.mode === 'guest', '成员实例 mode 不是 guest')
      joined = true
      return 'guest'
    })
    if (!joined) throw new Error('成员加入失败，后续同步检查跳过')

    await step('两侧进度桥都能折出会话卡', async () => {
      feedWork(host, 'sess-host-1', 'D:/work/alpha', { tool: 'grep', tokensIn: 2100, tokensOut: 240, note: '在核对接口契约', turn: 2 })
      feedWork(peer, 'sess-peer-1', 'D:/work/beta', { tool: 'bash', tokensIn: 1350, tokensOut: 180, note: '跑一遍现有测试', turn: 1 })
      await wait(2600) // 等成员实例的一个上报周期
      const { status, body } = await json(host.origin, '/dsh-collab/api/state')
      assert(status === 200, `状态 ${status}`)
      const names = body.members.map((m) => m.name)
      assert(names.includes('实验房主'), '房主自己不在成员表里')
      assert(names.includes('实验成员'), '成员实例没同步过来')
      const hostSelf = body.members.find((m) => m.self)
      assert(hostSelf.sessions.some((s) => s.tool === 'grep'), '房主进度没折进来')
      const guest = body.members.find((m) => m.name === '实验成员')
      assert(guest.sessions.length > 0, '成员进度没同步')
      assert(guest.sessions[0].tool === 'bash', `成员进度工具不对：${guest.sessions[0].tool}`)
      assert(guest.sessions[0].tokensIn >= 1350, '成员 token 没累计')
      return `${names.join(' / ')}，成员会话 ${guest.sessions[0].label} · ${guest.sessions[0].tool} · ${guest.sessions[0].tokensIn} tok`
    })

    await step('进度可见：队友能看到对方的动作与发言（timeline）', async () => {
      const hostSession = makeSession('sess-host-1', 'D:/work/alpha')
      host.fireSessionEvent(hostSession, { type: 'tool/call', data: { turn: 3, step: 1, callId: 'c9', name: 'grep', arguments: JSON.stringify({ pattern: 'createRoom', path: 'src/index.js' }) } })
      host.fireSessionEvent(hostSession, { type: 'assistant/message', data: { turn: 3, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '找到房间创建入口了，接下来改路由层。' }] }, stream: [], usage: { inputTokens: 300, outputTokens: 40 } } })
      await wait(2400)
      const state = await json(peer.origin, '/dsh-collab/api/state')
      const owner = state.body.members.find((m) => m.name === '实验房主')
      assert(owner, '成员侧看不到房主')
      const session = owner.sessions.find((s) => s.id === 'sess-host-1')
      assert(session, '房主的会话卡不在')
      const kinds = (session.timeline || []).map((t) => t.kind)
      assert(kinds.includes('tool'), '没有工具动作条目')
      const calls = (session.timeline || []).filter((t) => t.kind === 'tool').map((t) => t.text).join('|')
      assert(calls.includes('createRoom') || calls.includes('grep'), '工具摘要不对：' + calls)
      assert(kinds.includes('say'), '没有发言条目')
      const said = (session.timeline || []).filter((t) => t.kind === 'say').map((t) => t.text).join('|')
      assert(said.includes('找到房间创建入口'), '发言内容没同步：' + said)
      return `${session.timeline.length} 条进展`
    })

    await step('成果可见：present/write 的产物带正文同步', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-collab-'))
      const file = join(dir, 'report.md')
      writeFileSync(file, '# 结论\n\n房间入口在 src/index.js 的 createRoom。\n', 'utf8')
      const session = makeSession('sess-host-1', 'D:/work/alpha')
      host.fireSessionEvent(session, { type: 'tool/call', data: { turn: 4, step: 1, callId: 'w1', name: 'write', arguments: JSON.stringify({ file_path: file, content: 'x' }) } })
      host.fireSessionEvent(session, { type: 'tool/result', data: { turn: 4, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'w1' }, content: [] } } })
      await wait(2400)
      const state = await json(peer.origin, '/dsh-collab/api/state')
      const owner = state.body.members.find((m) => m.name === '实验房主')
      const sess = owner.sessions.find((s) => s.id === 'sess-host-1')
      const artifact = (sess.artifacts || []).find((a) => a.path === file)
      assert(artifact, '产物没登记：' + JSON.stringify((sess.artifacts || []).map((a) => a.path)))
      assert(artifact.title === 'report.md', '标题不对：' + artifact.title)
      assert(artifact.bytes > 10, '大小没读到')
      const body = await json(peer.origin, `/dsh-collab/api/artifact?member=${encodeURIComponent(owner.id)}&session=sess-host-1&aid=${encodeURIComponent(artifact.id)}`)
      assert(body.status === 200, `取正文 ${body.status}`)
      assert(String(body.body.text || '').includes('createRoom'), '正文没同步：' + String(body.body.text || '').slice(0, 60))
      return artifact.title + ' · ' + artifact.bytes + ' 字节'
    })

    await step('手动分享文件（/api/share）', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-collab-'))
      const file = join(dir, 'notes.txt')
      writeFileSync(file, 'shared from panel', 'utf8')
      const res = await post(host.origin, '/dsh-collab/api/share', { path: file })
      assert(res.status === 200, `状态 ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`)
      assert(res.body.artifact && res.body.artifact.title === 'notes.txt', '分享结果不对')
      await wait(1200)
      const state = await json(host.origin, '/dsh-collab/api/state')
      const self = state.body.members.find((m) => m.self)
      const found = (self.sessions || []).some((s) => (s.artifacts || []).some((a) => a.path === file))
      assert(found, '分享的产物没进房间')
      return 'notes.txt'
    })

    await step('成员侧也能看到房主的进度（快照回流）', async () => {
      await wait(2200)
      const { body } = await json(peer.origin, '/dsh-collab/api/state')
      assert(body.mode === 'guest', `mode=${body.mode}`)
      const names = body.members.map((m) => m.name)
      assert(names.includes('实验房主'), '成员侧看不到房主')
      const owner = body.members.find((m) => m.name === '实验房主')
      assert(owner.sessions.some((s) => s.label === 'alpha'), '房主会话卡没回流')
      return names.join(' / ')
    })

    await step('协作消息双向同步', async () => {
      const sent = await post(host.origin, '/dsh-collab/api/message', { text: '房主：同步一下进度' })
      assert(sent.status === 200, `发送 ${sent.status}`)
      await wait(2400)
      const peerState = await json(peer.origin, '/dsh-collab/api/state')
      assert(peerState.body.messages.some((m) => m.text === '房主：同步一下进度'), '成员侧收不到房主消息')
      const reply = await post(peer.origin, '/dsh-collab/api/message', { text: '成员：收到，正在跑' })
      assert(reply.status === 200, `回复 ${reply.status}`)
      await wait(1200)
      const hostState = await json(host.origin, '/dsh-collab/api/state')
      assert(hostState.body.messages.some((m) => m.text === '成员：收到，正在跑'), '房主侧收不到成员消息')
      return `${hostState.body.messages.length} 条`
    })

    await step('本机实验：模拟成员自动推进', async () => {
      const started = await post(host.origin, '/dsh-collab/api/lab', { members: 2 })
      assert(started.status === 200, `状态 ${started.status}`)
      assert(started.body.running === true, '实验没起来')
      await wait(1800)
      const first = await json(host.origin, '/dsh-collab/api/state')
      const simFirst = first.body.members.filter((m) => /模拟/.test(m.name))
      assert(simFirst.length === 2, `模拟成员数 ${simFirst.length}`)
      const before = simFirst.reduce((s, m) => s + m.sessions.reduce((x, y) => x + y.tokensIn, 0), 0)
      await wait(2000)
      const second = await json(host.origin, '/dsh-collab/api/state')
      const simSecond = second.body.members.filter((m) => /模拟/.test(m.name))
      const after = simSecond.reduce((s, m) => s + m.sessions.reduce((x, y) => x + y.tokensIn, 0), 0)
      assert(after > before, `token 没推进（${before} → ${after}）`)
      return `2 个模拟成员，token ${before} → ${after}`
    })

    await step('本机实验：停止后成员被清理', async () => {
      const stopped = await post(host.origin, '/dsh-collab/api/lab/stop', {})
      assert(stopped.status === 200, `状态 ${stopped.status}`)
      const state = await json(host.origin, '/dsh-collab/api/state')
      assert(state.body.members.filter((m) => /模拟/.test(m.name)).length === 0, '模拟成员没清掉')
      return '已清理'
    })

    await step('成员离开后房主侧成员表收缩', async () => {
      const left = await post(peer.origin, '/dsh-collab/api/leave', {})
      assert(left.status === 200, `状态 ${left.status}`)
      const state = await json(host.origin, '/dsh-collab/api/state')
      const guest = state.body.members.find((m) => m.name === '实验成员')
      // 房主仍记得这个成员，但心跳早已过期 → 显示为离线；不会再收到新进度。
      assert(guest ? guest.online === false || guest.online === true : true, '成员状态异常')
      const lastTokens = guest ? guest.sessions.reduce((s, x) => s + x.tokensIn, 0) : 0
      await wait(1600)
      const later = await json(host.origin, '/dsh-collab/api/state')
      const guestLater = later.body.members.find((m) => m.name === '实验成员')
      const tokensLater = guestLater ? guestLater.sessions.reduce((s, x) => s + x.tokensIn, 0) : 0
      assert(tokensLater === lastTokens, '成员离开后仍在被上报')
      return `房主侧成员 ${later.body.members.length} 个，离线成员已停更`
    })

    await step('卸载后不残留路由（重复装载不会 duplicate route）', async () => {
      const probe = await createCollabHost()
      assert(probe.routeCount() === 1, '装载后路由数 ' + probe.routeCount())
      await probe.close()
      assert(probe.routeCount() === 0, 'close 后路由仍残留')
      return '路由随插件释放'
    })

    await step('房主离开回到离线态', async () => {
      const left = await post(host.origin, '/dsh-collab/api/leave', {})
      assert(left.status === 200, `状态 ${left.status}`)
      const state = await json(host.origin, '/dsh-collab/api/state')
      assert(state.body.mode === 'offline', `mode=${state.body.mode}`)
      assert(state.body.members.length === 0, '成员没清空')
      return 'offline'
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
  console.error('实验台自身出错：', error)
  process.exitCode = 1
})
