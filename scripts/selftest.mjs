/**
 * scripts/selftest.mjs — 对着**正在运行的 DSH** 做体检 + 二维码往返校验。
 *
 *   node scripts/selftest.mjs                # 默认 http://127.0.0.1:53796
 *   node scripts/selftest.mjs http://127.0.0.1:53796
 *
 * 前置：插件已装进当前 profile，且 DSH 在改动 Host 代码之后重启过一次
 * （Host 半的 JS 不会热替换，见 README「改了代码怎么生效」）。
 *
 * 需要「两台机器」的实验请用 scripts/lab.mjs：它自己起实例，不需要 DSH。
 */
import { encodeMatrix } from '../qr.js'
import { assertRoundTrip } from './qr-decode.mjs'

const BASE = (process.argv[2] || process.env.DSH_COLLAB_BASE || 'http://127.0.0.1:53796').replace(/\/+$/, '')
const results = []

async function step(name, fn, options = {}) {
  try {
    const detail = await fn()
    results.push({ name, ok: true })
    console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`)
  } catch (error) {
    const message = String(error && error.message ? error.message : error)
    results.push({ name, ok: false, detail: message, optional: !!options.optional })
    console.log(`  ${options.optional ? 'SKIP' : 'FAIL'}  ${name} — ${message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function json(path, init) {
  const response = await fetch(BASE + path, init)
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text.slice(0, 160) }
  }
  return { status: response.status, body, text }
}

const post = (path, value) =>
  json(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value || {}) })

async function main() {
  console.log('== 1. 二维码离线编解码往返（不联网） ==')
  const samples = [
    'http://127.0.0.1:53796/?collab=6WTP47&relay=http%3A%2F%2F127.0.0.1%3A53796%2Fdsh-collab%2Frelay',
    'relay=http://192.168.1.20:53796/dsh-collab/relay\ncode=ABC234',
    'x',
    'DSH 协作室 · 多人研究进度同步 · 中文也要能编码',
    'a'.repeat(120),
    'b'.repeat(200),
  ]
  for (const sample of samples) {
    await step(`QR 往返 ${new TextEncoder().encode(sample).length} 字节`, () => {
      const { matrix, decoded } = assertRoundTrip(encodeMatrix, sample, 'M')
      return `v${matrix.version}-${matrix.ecl} mask=${decoded.mask} ${matrix.size}×${matrix.size}`
    })
  }
  await step('QR 高纠错级（Q）往返', () => {
    const sample = 'http://192.168.1.20:53796/?collab=TESTCM&relay=http%3A%2F%2F192.168.1.20%3A53796%2Fdsh-collab%2Frelay'
    assertRoundTrip(encodeMatrix, sample, 'Q')
    return `${new TextEncoder().encode(sample).length} 字节`
  })

  console.log(`\n== 2. 运行中的 DSH（${BASE}） ==`)
  let needsRestart = false
  await step('relay 健康检查（探测 Host 半是否为当前版本）', async () => {
    const { status, body } = await json('/dsh-collab/relay/health')
    if (status === 404) {
      needsRestart = true
      throw new Error('Host 半还是旧代码：请重启一次 DSH（协作模式里的面板会恢复）')
    }
    assert(status === 200, `意外状态 ${status}`)
    return `room=${body.room ?? '（未开房）'} host=${body.host}`
  })

  if (needsRestart) {
    console.log('\n结论：插件已安装，但 Host 模块是旧的一代。重启 DSH 后重跑本脚本。')
    console.log('（想让代码在没有 DSH 的情况下也能验证，直接跑 npm run lab）')
    process.exitCode = 1
    return
  }

  let code = ''
  await step('创建协作室并生成邀请（链接 + 二维码）', async () => {
    const { status, body } = await post('/dsh-collab/api/create', { name: '自检房主' })
    assert(status === 200, `状态 ${status}`)
    assert(body.mode === 'host', 'mode 不是 host')
    assert(body.invite && body.invite.code, '没有邀请信息')
    assert(body.invite.qr && body.invite.qr.path.length > 100, '二维码 path 为空')
    code = body.invite.code
    return `code=${code} 二维码 v${body.invite.qr.version} relay=${body.invite.lanRelay}`
  })

  await step('二维码能解回邀请链接', () => {
    const statePath = '/dsh-collab/api/state'
    return json(statePath).then(({ body }) => {
      const url = body.invite.primaryUrl
      const decoded = assertRoundTrip(encodeMatrix, url, 'M').decoded
      assert(decoded.text === url, '解码结果不一致')
      return `${url.length} 字节 / v${decoded.version}-${decoded.ecl}`
    })
  })

  await step('邀请落地页', async () => {
    const { status, text } = await json(`/dsh-collab/join?c=${code}`)
    assert(status === 200, `状态 ${status}`)
    assert(text.includes(code), '落地页没有邀请码')
    assert(text.includes('协作模式'), '落地页缺少步骤')
    return `${text.length} 字节`
  })

  let token = ''
  await step('relay join / report / snapshot 全链路', async () => {
    const join = await post('/dsh-collab/relay/join', { code, name: '自检成员', machine: 'SELFTEST' })
    assert(join.status === 200, `join ${join.status}`)
    token = join.body.token
    const report = await post('/dsh-collab/relay/report', {
      token,
      sessions: [{ id: 'self-s1', label: 'demo-repo', status: 'running', tool: 'grep', note: '在查接口定义', turn: 2, tokensIn: 500, tokensOut: 90, at: Date.now() }],
    })
    assert(report.status === 200, `report ${report.status}`)
    const snap = await json(`/dsh-collab/relay/snapshot?token=${token}`)
    const guest = snap.body.members.find((m) => m.name === '自检成员')
    assert(guest && guest.sessions[0].tool === 'grep', '进度没同步')
    return `成员 ${snap.body.members.length} 个`
  })

  await step('错误邀请码被拒绝', async () => {
    const { status } = await post('/dsh-collab/relay/join', { code: 'ZZZZZZ', name: '冒名' })
    assert(status === 403, `期望 403，得到 ${status}`)
    return '403'
  })

  await step('本机实验可启动', async () => {
    const started = await post('/dsh-collab/api/lab', { members: 2 })
    assert(started.status === 200, `lab ${started.status}`)
    assert(started.body.running === true, '实验没起来')
    await new Promise((r) => setTimeout(r, 1600))
    const state = await json('/dsh-collab/api/state')
    const sim = state.body.members.filter((m) => /模拟/.test(m.name))
    assert(sim.length === 2, `模拟成员 ${sim.length} 个`)
    return sim.map((m) => m.name).join(' / ')
  })

  await step('本机实验可停止并清理', async () => {
    await post('/dsh-collab/api/lab/stop', {})
    const state = await json('/dsh-collab/api/state')
    assert(state.body.members.filter((m) => /模拟/.test(m.name)).length === 0, '没清理')
    return '已清理'
  })

  await step('离开房间回到离线态', async () => {
    const { status } = await post('/dsh-collab/api/leave', {})
    assert(status === 200, `leave ${status}`)
    const state = await json('/dsh-collab/api/state')
    assert(state.body.mode === 'offline', `mode=${state.body.mode}`)
    return 'offline'
  })

  const failed = results.filter((r) => !r.ok && !r.optional)
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
  if (failed.length) {
    console.log('失败项：')
    for (const item of failed) console.log(`  · ${item.name} — ${item.detail}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('自检脚本自身出错：', error)
  process.exitCode = 1
})
