/**
 * scripts/relay-check.mjs — 独立 relay 的自检（不需要 DSH，也不需要任何账号）。
 *
 *   node scripts/relay-check.mjs
 *
 * 起一个 scripts/relay-server.mjs 子进程，模拟两个成员的 DSH 上报，验证：
 * 房间创建、加入、进度互看、产物正文、消息、房间列表，以及「关掉 relay 只影响自己」。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = 43000 + Math.floor(Math.random() * 900)
const BASE = `http://127.0.0.1:${PORT}`

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
async function json(path, init) {
  const response = await fetch(BASE + path, init)
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text.slice(0, 200) }
  }
  return { status: response.status, body, text }
}
const post = (path, value) =>
  json(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value || {}) })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitHealthy(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/dsh-collab/relay/health`, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return true
    } catch {
      /* 还没起来 */
    }
    await wait(300)
  }
  return false
}

async function main() {
  console.log('== 独立 relay 自检（无需 DSH / 无需账号）==')
  const child = spawn(process.execPath, [join(HERE, 'relay-server.mjs'), '--port', String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let relayLog = ''
  child.stdout.on('data', (d) => (relayLog += String(d)))
  child.stderr.on('data', (d) => (relayLog += String(d)))

  try {
    await step('relay 启动并给出健康检查', async () => {
      const ok = await waitHealthy()
      assert(ok, '健康检查超时：' + relayLog.slice(0, 200))
      const { status, body } = await json('/dsh-collab/relay/health')
      assert(status === 200 && body.ok, 'health 不可用')
      return `rooms=${body.rooms}`
    })

    let code = ''
    await step('在 relay 上创建房间', async () => {
      const { status, body } = await post('/dsh-collab/relay/room', { name: '团队看板' })
      assert(status === 200, `状态 ${status}`)
      assert(/^[A-Z0-9]{6}$/.test(body.code), `邀请码不合法：${body.code}`)
      code = body.code
      return `code=${code}`
    })

    let tokenA = ''
    let tokenB = ''
    let memberA = ''
    let memberB = ''
    await step('两个成员各自加入（互不知情）', async () => {
      const a = await post('/dsh-collab/relay/join', { code, name: '成员A', machine: 'PC-A' })
      const b = await post('/dsh-collab/relay/join', { code, name: '成员B', machine: 'PC-B' })
      assert(a.status === 200 && b.status === 200, `join ${a.status}/${b.status}`)
      tokenA = a.body.token
      tokenB = b.body.token
      memberA = a.body.self.id
      memberB = b.body.self.id
      return `${memberA.slice(0, 8)} / ${memberB.slice(0, 8)}`
    })

    await step('A 上报进度，B 能看到（互看）', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'relay-check-'))
      const file = join(dir, 'plan.md')
      writeFileSync(file, '# 计划\n\n1. 拆接口\n2. 补测试\n', 'utf8')
      const artifactId = 'art1'
      await post('/dsh-collab/relay/report', {
        token: tokenA,
        sessions: [
          {
            id: 'a-s1',
            label: 'alpha',
            preset: 'collab',
            status: 'running',
            tool: 'grep',
            note: '在查入口',
            turn: 2,
            tokensIn: 900,
            tokensOut: 120,
            at: Date.now(),
            timeline: [
              { id: 't1', at: Date.now(), kind: 'tool', tool: 'grep', text: 'createRoom  @ src/index.js' },
              { id: 't2', at: Date.now(), kind: 'say', text: '找到入口了，接下来改路由层。' },
            ],
            artifacts: [{ id: artifactId, path: file, title: 'plan.md', tool: 'write', at: Date.now(), bytes: 30 }],
          },
        ],
        artifactBodies: { 'a-s1': { [artifactId]: '# 计划\n\n1. 拆接口\n2. 补测试\n' } },
      })
      const snap = await json(`/dsh-collab/relay/snapshot?token=${tokenB}`)
      assert(snap.status === 200, `snapshot ${snap.status}`)
      const a = snap.body.members.find((m) => m.name === '成员A')
      assert(a, 'B 看不到 A')
      assert(a.sessions[0].timeline.length === 2, 'timeline 没同步')
      assert(a.sessions[0].artifacts[0].title === 'plan.md', '产物没同步')
      return `${a.sessions[0].timeline.length} 条进展 / ${a.sessions[0].artifacts.length} 个成果`
    })

    await step('产物的正文可以按需取', async () => {
      const snap = await json(`/dsh-collab/relay/snapshot?token=${tokenB}`)
      const a = snap.body.members.find((m) => m.name === '成员A')
      const artifact = a.sessions[0].artifacts[0]
      const body = await json(
        `/dsh-collab/relay/artifact?token=${tokenB}&member=${encodeURIComponent(a.id)}&session=a-s1&aid=${encodeURIComponent(artifact.id)}`,
      )
      assert(body.status === 200, `artifact ${body.status}`)
      assert(String(body.body.text).includes('拆接口'), '正文不对')
      return `${String(body.body.text).length} 字节`
    })

    await step('中继不再按模式过滤（隔离由插件端负责）', async () => {
      await post('/dsh-collab/relay/report', {
        token: tokenA,
        sessions: [
          { id: 'a-s1', label: 'alpha', preset: 'collab', status: 'running', tool: 'grep', turn: 2, tokensIn: 900, tokensOut: 120, at: Date.now() },
          { id: 'a-standard', label: 'private-work', preset: 'standard', status: 'running', tool: 'bash', turn: 9, tokensIn: 9999, tokensOut: 9999, at: Date.now() },
        ],
      })
      const snap = await json(`/dsh-collab/relay/snapshot?token=${tokenB}`)
      const a = snap.body.members.find((m) => m.name === '成员A')
      const ids = (a.sessions || []).map((x) => x.id)
      assert(ids.includes('a-s1'), '协作会话丢了')
      assert(ids.includes('a-standard'), '标准会话应当保留，否则旧版插件会被挡在外面')
      return '保留 ' + ids.join(',')
    })

    await step('消息双向', async () => {
      await post('/dsh-collab/relay/message', { token: tokenA, text: 'A：先拆接口' })
      await post('/dsh-collab/relay/message', { token: tokenB, text: 'B：我来补测试' })
      const snap = await json(`/dsh-collab/relay/snapshot?token=${tokenA}`)
      const texts = snap.body.messages.map((m) => m.text)
      assert(texts.includes('A：先拆接口') && texts.includes('B：我来补测试'), '消息缺失')
      return `${texts.length} 条`
    })

    await step('房间列表与成员数', async () => {
      const { body } = await json('/dsh-collab/relay/rooms')
      const room = body.rooms.find((r) => r.code === code)
      assert(room, '房间不在列表')
      assert(room.members === 2, `成员数 ${room.members}`)
      return `${body.rooms.length} 个房间`
    })

    await step('未带 create 的未知房间被拒（不误建）', async () => {
      const { status } = await post('/dsh-collab/relay/join', { code: 'ZZZZZZ', name: '路人' })
      assert(status === 404, `期望 404，得到 ${status}`)
      return '404'
    })

    await step('带 create 时按指定邀请码开新房', async () => {
      const wanted = 'TEAM01'
      const { status, body } = await post('/dsh-collab/relay/join', { code: wanted, name: '发起者', create: true })
      assert(status === 200, `状态 ${status}`)
      assert(body.room.code === wanted, `code=${body.room.code}`)
      return `code=${body.room.code}`
    })

    await step('成员离线后其它成员照常可用', async () => {
      // B 不再上报；A 仍然可以拉快照、发消息
      await wait(600)
      const snap = await json(`/dsh-collab/relay/snapshot?token=${tokenA}`)
      assert(snap.status === 200, 'A 被 B 的沉默影响')
      const sent = await post('/dsh-collab/relay/message', { token: tokenA, text: 'A：B 掉线我也能继续' })
      assert(sent.status === 200, 'A 发消息失败')
      return 'A 独立可用'
    })
  } finally {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
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
  console.error('relay 自检脚本自身出错：', error)
  process.exitCode = 1
})
