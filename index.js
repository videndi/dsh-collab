/**
 * dsh-collab — Host half.
 *
 * 多人协同研究室：本机 DSH 把自己的研究进度上报到协作室，并把房间里所有
 * 成员的进度、消息同步回来给 Web UI 的协作面板显示。
 *
 * 设计前提：**不依赖外部网络**。
 *   · 房主地址默认 127.0.0.1，同机多窗口就能完成全部链路；
 *   · 邀请用「链接 + 二维码」，二维码在本机现算（./qr.js），不调用任何外部服务；
 *   · 没有第二台机器时用「本机实验」：插件在进程内拉起若干模拟成员，走真实
 *     HTTP 回环（127.0.0.1）完成 join → report → broadcast 全链路。
 *
 * 两种角色：
 *   host  —— 本机创建协作室，发布 relay 端点，其他成员把进度 POST 过来；
 *   guest —— 本机加入别人创建的房间，每 2 秒上报本机进度并拉取房间快照。
 *
 * 路由（prefix /dsh-collab）：
 *   GET  /join?c=CODE&r=RELAY      邀请落地页（朋友没装插件时也能看懂怎么连）
 *   GET  /api/state                当前房间快照（含邀请链接与二维码 path）
 *   POST /api/create               { name } 创建协作室
 *   POST /api/join                 { relay, code, name } 加入协作室
 *   POST /api/leave                离开
 *   POST /api/message              { text } 发消息
 *   POST /api/rename               { name } 改显示名
 *   POST /api/lab                  { members } 本机实验：拉起模拟成员
 *   POST /api/lab/stop             停止本机实验
 *   relay（仅 host 模式生效）：
 *     GET  /relay/health           健康检查
 *     POST /relay/join             { code, name } -> { token, self, room }
 *     POST /relay/report           { token, sessions } -> { ok }
 *     POST /relay/message          { token, text }
 *     GET  /relay/snapshot?token=
 */
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, hostname, networkInterfaces, userInfo } from 'node:os'
import { dirname, join as joinPath } from 'node:path'
import { qrSvgPath } from './qr.js'

export const name = 'dsh-collab'

/** 唯一的硬依赖：要在既有的浏览器 HTTP 服务上挂自己的路由。 */
export const inject = ['webServer']

const BASE = '/dsh-collab'
const MAX_SESSIONS = 40
const MAX_MESSAGES = 300
const IDLE_HIDE_MS = 6 * 60 * 60 * 1000
const GUEST_TICK_MS = 2000
const MEMBER_STALE_MS = 15000
const LAB_TICK_MS = 1400

const now = () => Date.now()

function defaultName() {
  const env = process.env.DSH_COLLAB_NAME
  if (env && env.trim()) return env.trim().slice(0, 40)
  try {
    const info = userInfo()
    if (info && info.username) return `${info.username}@${hostname()}`.slice(0, 40)
  } catch {
    /* ignore */
  }
  return `member-${hostname() || 'local'}`.slice(0, 40)
}

function shortId(prefix = 'm') {
  return `${prefix}_${randomBytes(6).toString('hex')}`
}

function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(6)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

function labelOf(session) {
  const header = session && session.header
  const cwd = header && header.cwd
  if (typeof cwd === 'string' && cwd.length) {
    const parts = cwd.split(/[\\/]+/).filter(Boolean)
    const tail = parts[parts.length - 1]
    if (tail) return String(tail).slice(0, 48)
  }
  const id = String((session && session.id) || '')
  return id ? `session ${id.slice(0, 6)}` : 'session'
}

function presetOf(session) {
  const preset = session && session.header && session.header.agentPreset
  return typeof preset === 'string' ? preset : undefined
}

async function readJson(req, limit = 1_000_000) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('payload too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  return JSON.parse(text)
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(html)
}

function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return ''
  let out = ''
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string') out += block.text
  }
  return out
}

/** 本机可用的局域网 IPv4（用于把 127.0.0.1 换成一个朋友能连的地址）。 */
function lanIPv4() {
  try {
    const all = networkInterfaces()
    const list = []
    for (const name of Object.keys(all)) {
      for (const info of all[name] || []) {
        if (!info || info.family !== 'IPv4' || info.internal) continue
        if (/^169\.254\./.test(info.address)) continue
        list.push(info.address)
      }
    }
    return list
  } catch {
    return []
  }
}

/**
 * 找一个可用的 cloudflared 可执行文件（不 import 那个 npm 包，避免被包的解析路径限制）。
 * quick tunnel 让「不在同一网段」的成员也能连进来：不需要 VPS、不需要开放端口。
 */
function findCloudflared() {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  const bases = new Set()
  const addBase = (value) => {
    if (value && String(value).trim()) bases.add(String(value).trim())
  }
  addBase(process.env.DSH_HOME)
  addBase(process.env.DSH_PROFILE_DIR)
  // 常见布局：<workspace>/home（DSH_HOME 的默认落点）、~/.dsh、可执行文件旁的 resources/
  try {
    addBase(joinPath(process.cwd(), 'home'))
    addBase(joinPath(process.cwd(), '..', 'home'))
    addBase(joinPath(homedir(), '.dsh'))
    const exeDir = dirname(process.execPath)
    addBase(joinPath(exeDir, 'resources', 'app', 'dsh'))
    addBase(joinPath(exeDir, 'resources', 'home'))
    addBase(joinPath(exeDir, 'home'))
  } catch {
    /* 路径推断失败就算了 */
  }

  const candidates = []
  if (process.env.DSH_COLLAB_CLOUDFLARED) candidates.push(process.env.DSH_COLLAB_CLOUDFLARED)
  for (const base of bases) {
    candidates.push(joinPath(base, 'node_modules', 'cloudflared', 'bin', exe))
    try {
      for (const name of readdirSync(joinPath(base, 'profiles'))) {
        candidates.push(joinPath(base, 'profiles', name, 'node_modules', 'cloudflared', 'bin', exe))
      }
    } catch {
      /* 没有 profiles */
    }
  }
  candidates.push(joinPath(process.cwd(), 'node_modules', 'cloudflared', 'bin', exe))

  for (const candidate of Array.from(new Set(candidates))) {
    try {
      if (candidate && existsSync(candidate)) return candidate
    } catch {
      /* ignore */
    }
  }
  return null
}

const LAB_PEOPLE = [
  { name: '研究员A（模拟）', labels: ['alpha-service', 'alpha-web'] },
  { name: '研究员B（模拟）', labels: ['beta-etl'] },
  { name: '研究员C（模拟）', labels: ['gamma-cli'] },
]
const LAB_TOOLS = ['bash', 'grep', 'read', 'edit', 'web_search', 'todo_write', 'skill', 'write']
const LAB_NOTES = [
  '正在定位入口',
  '已拉取依赖树',
  '在核对接口契约',
  '跑了一遍现有测试',
  '整理结论到报告',
  '比对了另一分支的实现',
]

export function apply(ctx) {
  const state = {
    mode: 'offline', // offline | host | guest
    self: { id: shortId('u'), name: defaultName(), machine: hostname() },
    room: null,
    relayUrl: null,
    token: null,
    remoteSnap: null,
  }

  const localSessions = new Map()
  const relayMembers = new Map()
  const relayTokens = new Map()
  const messages = []
  const clients = new Set()

  let guestTimer = null
  let labTimer = null
  let flushTimer = null
  let qrCache = { key: '', value: null }

  const lab = { running: false, members: [] }

  // ── 公网隧道：把 relay 暴露成一个临时 https 域名，跨网段也能加入 ────────
  // 注意只暴露 relay + 邀请落地页，不暴露 DSH 自己的 Web UI：隧道指向插件
  // 内部另起的小服务，而不是 webServer 的端口。
  const tunnel = { child: null, url: null, error: null, starting: false }
  let relayServer = null
  let relayPort = 0

  function relayLocalUrl() {
    return relayPort ? `http://127.0.0.1:${relayPort}` : null
  }

  function ensureRelayServer() {
    if (relayServer) return Promise.resolve(relayServer)
    relayServer = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const sub = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null
        if (sub === '/join' || sub === '/join/') {
          sendHtml(res, 200, joinPage(url))
          return
        }
        if (sub && sub.startsWith('/relay')) {
          await handleRelay(sub, req, res)
          return
        }
        if (!sub || sub === '/' || sub === '') {
          sendJson(res, 200, { ok: true, service: 'dsh-collab relay', room: state.room ? state.room.code : null })
          return
        }
        sendJson(res, 404, { error: 'not found' })
      } catch (error) {
        try {
          sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
        } catch {
          /* 响应已发出 */
        }
      }
    })
    return new Promise((resolve, reject) => {
      relayServer.once('error', reject)
      relayServer.listen(0, '127.0.0.1', () => {
        relayPort = relayServer.address().port
        resolve(relayServer)
      })
    })
  }

  /** quick tunnel 拿到域名后边缘还要几秒才通；这里等到真的 200 再对外报“已开启”。 */
  async function waitTunnelReady(url, timeoutMs = 15000) {
    const deadline = now() + timeoutMs
    while (now() < deadline) {
      try {
        const response = await fetch(`${url}${BASE}/relay/health`, { signal: AbortSignal.timeout(5000) })
        if (response.ok) return true
      } catch {
        /* 边缘还没就绪，继续等 */
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    return false
  }

  async function tunnelStart() {
    if (tunnel.url) return { running: true, url: tunnel.url }
    if (tunnel.starting) return { running: false, starting: true }
    tunnel.starting = true
    tunnel.error = null
    try {
      await ensureRelayServer()
      const local = relayLocalUrl()
      const bin = findCloudflared()
      const child = spawn(bin || 'cloudflared', ['tunnel', '--url', local, '--no-autoupdate'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      tunnel.child = child
      const url = await new Promise((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          reject(new Error('cloudflared 25 秒内没有给出公网地址（检查网络或 DSH_COLLAB_CLOUDFLARED 指向的二进制）'))
        }, 25000)
        const finish = (fn, value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          fn(value)
        }
        const scan = (chunk) => {
          const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(String(chunk))
          if (match) finish(resolve, match[0])
        }
        child.stdout.on('data', scan)
        child.stderr.on('data', scan)
        child.once('error', (error) => finish(reject, error))
        child.once('exit', (code) => finish(reject, new Error(`cloudflared 退出（code ${code}）`)))
      })
      tunnel.url = url
      tunnel.starting = false
      const ready = await waitTunnelReady(url)
      tunnel.ready = ready
      if (!ready) tunnel.error = '隧道已建立，但公网入口 15 秒内还没通（可稍等再点一次，或检查出门网络）'
      child.once('exit', () => {
        if (tunnel.url === url) {
          tunnel.url = null
          tunnel.error = '隧道已断开'
          bump()
        }
      })
      bump()
      return { running: true, url }
    } catch (error) {
      tunnel.starting = false
      tunnel.error = String(error && error.message ? error.message : error)
      if (tunnel.child) {
        try {
          tunnel.child.kill()
        } catch {
          /* ignore */
        }
      }
      tunnel.child = null
      bump()
      return { running: false, error: tunnel.error }
    }
  }

  function tunnelStop() {
    const child = tunnel.child
    tunnel.child = null
    tunnel.url = null
    tunnel.ready = false
    tunnel.starting = false
    if (child) {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }
    bump()
    return { running: false }
  }

  function tunnelView() {
    return {
      running: !!tunnel.url,
      starting: tunnel.starting,
      url: tunnel.url,
      ready: !!tunnel.ready,
      error: tunnel.error,
      localPort: relayPort,
      bin: findCloudflared(),
    }
  }

  // ── 本机会话进度 ──────────────────────────────────────────────────────

  function ensureLocal(session) {
    const id = String(session.id)
    let rec = localSessions.get(id)
    if (!rec) {
      rec = {
        id,
        label: labelOf(session),
        cwd: session && session.header && typeof session.header.cwd === 'string' ? session.header.cwd : null,
        preset: presetOf(session),
        status: 'idle',
        tool: null,
        note: null,
        turn: 0,
        tokensIn: 0,
        tokensOut: 0,
        at: now(),
      }
      localSessions.set(id, rec)
    }
    return rec
  }

  function localSessionViews() {
    return [...localSessions.values()]
      .filter((rec) => now() - rec.at < IDLE_HIDE_MS)
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_SESSIONS)
      .map((rec) => ({
        id: rec.id,
        label: rec.label,
        preset: rec.preset,
        status: rec.status,
        tool: rec.tool,
        note: rec.note,
        turn: rec.turn,
        tokensIn: rec.tokensIn,
        tokensOut: rec.tokensOut,
        at: rec.at,
      }))
  }

  function selfView() {
    return {
      id: state.self.id,
      name: state.self.name,
      machine: state.self.machine,
      online: true,
      self: true,
      updatedAt: now(),
      sessions: localSessionViews(),
    }
  }

  function trimmedMessages() {
    return messages.slice(-MAX_MESSAGES)
  }

  // ── 邀请信息（链接 + 二维码，全部本机生成） ────────────────────────────

  function originOf() {
    try {
      return ctx.webServer.getOrigin()
    } catch {
      return 'http://127.0.0.1'
    }
  }

  /** 房间绑定的“项目”：优先取本机最近活跃会话的 cwd，创建者也可以手填名字。 */
  function projectOf(override) {
    const manual = override && String(override).trim()
    if (manual) return { name: manual.slice(0, 60), cwd: null, source: 'manual' }
    const latest = [...localSessions.values()].filter((r) => r.cwd).sort((a, b) => b.at - a.at)[0]
    if (latest) {
      const parts = String(latest.cwd).split(/[\\/]+/).filter(Boolean)
      const name = parts[parts.length - 1] || '项目'
      return { name: name.slice(0, 60), cwd: latest.cwd, source: 'session' }
    }
    return { name: '未命名项目', cwd: null, source: 'none' }
  }

  /** relay 地址对朋友来说必须是可达地址：优先给局域网 IP，没有就给回环。 */
  function relayAddresses() {
    const origin = originOf().replace(/\/+$/, '')
    const port = (() => {
      try {
        const u = new URL(origin)
        return u.port || (u.protocol === 'https:' ? '443' : '80')
      } catch {
        return '53796'
      }
    })()
    const lan = lanIPv4()
    const local = `${origin}${BASE}/relay`
    const lanRelay = lan.length ? `http://${lan[0]}:${port}${BASE}/relay` : local
    return { origin, port, lan, local, lanRelay, reachable: lan.length > 0 }
  }

  function inviteOf() {
    if (state.mode !== 'host' || !state.room) return null
    const addrs = relayAddresses()
    const code = state.room.code
    const buildUrl = (relay) => {
      const host = new URL(relay)
      return `${host.origin}/?collab=${encodeURIComponent(code)}&relay=${encodeURIComponent(relay)}`
    }
    const localUrl = buildUrl(addrs.local)
    const lanUrl = buildUrl(addrs.lanRelay)
    const tunnelRelay = tunnel.url ? `${tunnel.url}${BASE}/relay` : null
    const tunnelUrl = tunnelRelay ? buildUrl(tunnelRelay) : null
    const primary = tunnelUrl || (addrs.reachable ? lanUrl : localUrl)
    const channel = tunnelUrl ? 'tunnel' : addrs.reachable ? 'lan' : 'loopback'
    const qrKey = `${primary}`
    if (qrCache.key !== qrKey) {
      let qr = null
      try {
        const result = qrSvgPath(primary, { ecl: 'M', quiet: 2 })
        qr = { path: result.path, dimension: result.dimension, version: result.version, ecl: result.ecl }
      } catch {
        qr = null
      }
      qrCache = { key: qrKey, value: qr }
    }
    return {
      code,
      localUrl,
      lanUrl,
      tunnelUrl,
      primaryUrl: primary,
      channel,
      localRelay: addrs.local,
      lanRelay: addrs.lanRelay,
      tunnelRelay,
      lan: addrs.lan,
      reachable: addrs.reachable,
      joinPage: `${(tunnelRelay || addrs.local).replace(/\/relay$/, '')}/join?c=${encodeURIComponent(code)}`,
      qr: qrCache.value,
      plain: `relay=${tunnelRelay || (addrs.reachable ? addrs.lanRelay : addrs.local)}\ncode=${code}`,
    }
  }

  function snapshot() {
    if (state.mode === 'host') {
      const members = [selfView()]
      for (const member of relayMembers.values()) {
        members.push({ ...member, online: now() - member.updatedAt < MEMBER_STALE_MS })
      }
      return {
        mode: 'host',
        roomId: state.room.id,
        code: state.room.code,
        project: state.room.project || null,
        relay: relayAddresses().lanRelay,
        self: { id: state.self.id, name: state.self.name },
        members,
        messages: trimmedMessages(),
        invite: inviteOf(),
        tunnel: tunnelView(),
        lab: { running: lab.running, members: lab.members.map((m) => m.name) },
        updatedAt: now(),
      }
    }
    if (state.mode === 'guest' && state.remoteSnap) {
      return {
        ...state.remoteSnap,
        mode: 'guest',
        relay: state.relayUrl,
        self: { id: state.self.id, name: state.self.name },
        localSessions: localSessionViews(),
        tunnel: tunnelView(),
      }
    }
    return {
      mode: state.mode,
      self: { id: state.self.id, name: state.self.name },
      localSessions: localSessionViews(),
      members: [],
      messages: [],
      project: null,
      invite: null,
      tunnel: tunnelView(),
      lab: { running: false, members: [] },
      updatedAt: now(),
    }
  }

  function pushToClients() {
    if (!clients.size) return
    const frame = `data: ${JSON.stringify(snapshot())}\n\n`
    for (const res of clients) {
      try {
        res.write(frame)
      } catch {
        clients.delete(res)
      }
    }
  }

  function bump() {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      if (state.mode === 'guest') void guestReport()
      pushToClients()
    }, state.mode === 'guest' ? 150 : 250)
  }

  // ── 会话事件桥 ────────────────────────────────────────────────────────

  ctx.on('session/event', (session, event) => {
    if (!session || !event) return
    let rec
    try {
      rec = ensureLocal(session)
    } catch {
      return
    }
    const data = event.data || {}
    rec.at = now()
    switch (event.type) {
      case 'turn/start':
        rec.status = 'running'
        rec.turn = typeof data.turn === 'number' ? data.turn : rec.turn
        break
      case 'step/start':
        rec.status = 'running'
        break
      case 'tool/call':
        rec.status = 'running'
        rec.tool = typeof data.name === 'string' ? data.name : rec.tool
        break
      case 'tool/result':
        if (data.error) rec.tool = `${rec.tool || 'tool'} ✗`
        break
      case 'assistant/message':
        if (data.usage) {
          rec.tokensIn += Number(data.usage.inputTokens) || 0
          rec.tokensOut += Number(data.usage.outputTokens) || 0
        }
        break
      case 'user/message': {
        const text = textOfBlocks(data.content).trim()
        if (text) rec.note = text.slice(0, 160)
        break
      }
      case 'turn/end':
        rec.status = 'idle'
        rec.tool = null
        break
      default:
        return
    }
    bump()
  })

  // ── host：relay 端 ───────────────────────────────────────────────────

  function relayMemberFor(token) {
    const memberId = relayTokens.get(token)
    if (!memberId) return undefined
    return relayMembers.get(memberId)
  }

  function relayJoin(body) {
    if (state.mode !== 'host' || !state.room) return { status: 409, value: { error: 'no room on this host' } }
    const code = String(body.code || '').trim().toUpperCase()
    if (code !== state.room.code) return { status: 403, value: { error: 'wrong invite code' } }
    const memberId = shortId('g')
    const token = randomBytes(16).toString('hex')
    const member = {
      id: memberId,
      name: String(body.name || 'guest').slice(0, 40),
      machine: String(body.machine || '').slice(0, 60),
      online: true,
      self: false,
      updatedAt: now(),
      sessions: [],
    }
    relayMembers.set(memberId, member)
    relayTokens.set(token, memberId)
    bump()
    return {
      status: 200,
      value: {
        token,
        self: { id: memberId, name: member.name },
        room: { id: state.room.id, code: state.room.code },
        messages: trimmedMessages(),
      },
    }
  }

  function relayReport(body) {
    const member = relayMemberFor(String(body.token || ''))
    if (!member) return { status: 403, value: { error: 'unknown member' } }
    const sessions = Array.isArray(body.sessions) ? body.sessions : []
    member.sessions = sessions.slice(0, MAX_SESSIONS).map((item) => ({
      id: String(item.id || ''),
      label: String(item.label || '').slice(0, 48),
      preset: item.preset ? String(item.preset).slice(0, 32) : undefined,
      status: item.status === 'running' ? 'running' : 'idle',
      tool: item.tool ? String(item.tool).slice(0, 48) : null,
      note: item.note ? String(item.note).slice(0, 160) : null,
      turn: Number(item.turn) || 0,
      tokensIn: Number(item.tokensIn) || 0,
      tokensOut: Number(item.tokensOut) || 0,
      at: Number(item.at) || now(),
    }))
    member.updatedAt = now()
    member.online = true
    if (body.name) member.name = String(body.name).slice(0, 40)
    bump()
    return { status: 200, value: { ok: true, messages: trimmedMessages() } }
  }

  function relayMessage(body) {
    const member = relayMemberFor(String(body.token || ''))
    if (!member) return { status: 403, value: { error: 'unknown member' } }
    const text = String(body.text || '').slice(0, 4000).trim()
    if (!text) return { status: 400, value: { error: 'empty message' } }
    messages.push({ id: randomBytes(6).toString('hex'), from: member.id, name: member.name, text, at: now() })
    bump()
    return { status: 200, value: { ok: true } }
  }

  // ── guest：上报与拉取 ────────────────────────────────────────────────

  async function guestReport() {
    if (state.mode !== 'guest' || !state.relayUrl || !state.token) return
    const base = state.relayUrl.replace(/\/+$/, '')
    try {
      const response = await fetch(`${base}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: state.token, name: state.self.name, sessions: localSessionViews() }),
      })
      if (!response.ok) return
      await response.json()
      const snapResponse = await fetch(`${base}/snapshot?token=${encodeURIComponent(state.token)}`)
      if (snapResponse.ok) {
        state.remoteSnap = await snapResponse.json()
        pushToClients()
      }
    } catch {
      /* 对端暂时不可达：保留上一次快照，下一个 tick 再试 */
    }
  }

  function startGuestLoop() {
    stopGuestLoop()
    guestTimer = setInterval(() => void guestReport(), GUEST_TICK_MS)
    if (guestTimer && typeof guestTimer.unref === 'function') guestTimer.unref()
  }

  function stopGuestLoop() {
    if (guestTimer) clearInterval(guestTimer)
    guestTimer = null
  }

  // ── 本机实验：进程内模拟成员，走真实回环 HTTP ────────────────────────

  function labSnapshotSession(member) {
    return member.sessions.map((s) => ({
      id: s.id,
      label: s.label,
      status: s.status,
      tool: s.tool,
      note: s.note,
      turn: s.turn,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      at: s.at,
    }))
  }

  async function labStart(count) {
    if (state.mode !== 'host' || !state.room) {
      state.mode = 'host'
      state.room = { id: shortId('r'), code: roomCode(), createdAt: now(), project: projectOf() }
      relayMembers.clear()
      relayTokens.clear()
      messages.length = 0
      qrCache = { key: '', value: null }
    }
    labStop()
    const total = Math.max(1, Math.min(3, Number(count) || 2))
    const base = `${originOf()}${BASE}/relay`
    for (let i = 0; i < total; i++) {
      const person = LAB_PEOPLE[i % LAB_PEOPLE.length]
      const response = await fetch(`${base}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: state.room.code, name: person.name, machine: '本机实验' }),
      })
      if (!response.ok) continue
      const payload = await response.json()
      lab.members.push({
        name: person.name,
        token: payload.token,
        memberId: payload.self.id,
        sessions: person.labels.map((label, index) => ({
          id: `lab-${i}-${index}`,
          label,
          status: 'running',
          tool: LAB_TOOLS[(i + index) % LAB_TOOLS.length],
          note: LAB_NOTES[(i + index) % LAB_NOTES.length],
          turn: 1,
          tokensIn: 900 + i * 310,
          tokensOut: 120 + index * 40,
          at: now(),
        })),
        step: 0,
      })
    }
    lab.running = lab.members.length > 0
    await labReport()
    if (labTimer) clearInterval(labTimer)
    labTimer = setInterval(() => void labTick(), LAB_TICK_MS)
    if (labTimer && typeof labTimer.unref === 'function') labTimer.unref()
    return { running: lab.running, members: lab.members.map((m) => m.name) }
  }

  async function labTick() {
    if (!lab.running) return
    for (const member of lab.members) {
      member.step += 1
      for (const session of member.sessions) {
        session.tool = LAB_TOOLS[(member.step + session.label.length) % LAB_TOOLS.length]
        session.note = LAB_NOTES[member.step % LAB_NOTES.length]
        session.turn += 1
        session.tokensIn += 240 + ((member.step * 37) % 160)
        session.tokensOut += 60 + ((member.step * 13) % 90)
        session.at = now()
        session.status = member.step % 7 === 0 ? 'idle' : 'running'
      }
    }
    await labReport()
    // 每隔一会儿让一个模拟成员说一句话，验证消息广播链路
    if (state.room && lab.members.length > 0) {
      const pick = lab.members[Math.floor(Math.random() * lab.members.length)]
      if (Math.random() < 0.12) {
        const line = `${pick.name}：刚推进到「${LAB_NOTES[Math.floor(Date.now() / 1000) % LAB_NOTES.length]}」，产物已落盘。`
        await fetch(`${originOf()}${BASE}/relay/message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: pick.token, text: line }),
        }).catch(() => {})
      }
    }
  }

  async function labReport() {
    const base = `${originOf()}${BASE}/relay`
    await Promise.all(
      lab.members.map((member) =>
        fetch(`${base}/report`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: member.token,
            name: member.name,
            sessions: labSnapshotSession(member),
          }),
        }).catch(() => {}),
      ),
    )
    pushToClients()
  }

  function labStop() {
    if (labTimer) clearInterval(labTimer)
    labTimer = null
    for (const member of lab.members) {
      relayMembers.delete(member.memberId)
      relayTokens.delete(member.token)
    }
    lab.members = []
    lab.running = false
    bump()
    return { running: false }
  }

  // ── API（本机浏览器侧） ──────────────────────────────────────────────

  async function handleApi(sub, req, res) {
    if (sub === '/api/state' && req.method === 'GET') {
      sendJson(res, 200, snapshot())
      return
    }
    if (sub === '/api/tunnel/probe' && req.method === 'GET') {
      sendJson(res, 200, tunnelView())
      return
    }
    if (sub === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`)
      clients.add(res)
      const heartbeat = setInterval(() => {
        try {
          res.write(': ping\n\n')
        } catch {
          clients.delete(res)
        }
      }, 15000)
      req.on('close', () => {
        clearInterval(heartbeat)
        clients.delete(res)
      })
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    const body = await readJson(req)
    if (sub === '/api/create') {
      if (body.name) state.self.name = String(body.name).slice(0, 40)
      state.mode = 'host'
      state.room = { id: shortId('r'), code: roomCode(), createdAt: now(), project: projectOf(body.project) }
      state.relayUrl = null
      state.token = null
      state.remoteSnap = null
      relayMembers.clear()
      relayTokens.clear()
      messages.length = 0
      qrCache = { key: '', value: null }
      labStop()
      bump()
      sendJson(res, 200, snapshot())
      return
    }
    if (sub === '/api/join') {
      const relay = String(body.relay || '').trim().replace(/\/+$/, '')
      const code = String(body.code || '').trim().toUpperCase()
      if (!relay || !code) {
        sendJson(res, 400, { error: 'relay 地址与邀请码都要填（也可以直接粘贴邀请链接或二维码文本）' })
        return
      }
      if (body.name) state.self.name = String(body.name).slice(0, 40)
      try {
        const response = await fetch(`${relay}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, name: state.self.name, machine: hostname() }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          sendJson(res, response.status === 403 ? 403 : 502, { error: payload.error || `join failed (${response.status})` })
          return
        }
        stopGuestLoop()
        labStop()
        state.mode = 'guest'
        state.relayUrl = relay
        state.token = payload.token
        state.room = payload.room || { id: 'remote', code }
        state.remoteSnap = null
        startGuestLoop()
        void guestReport()
        sendJson(res, 200, snapshot())
      } catch (error) {
        sendJson(res, 502, { error: `无法连接协作室：${error && error.message ? error.message : String(error)}` })
      }
      return
    }
    if (sub === '/api/leave') {
      stopGuestLoop()
      labStop()
      state.mode = 'offline'
      state.room = null
      state.relayUrl = null
      state.token = null
      state.remoteSnap = null
      relayMembers.clear()
      relayTokens.clear()
      messages.length = 0
      bump()
      sendJson(res, 200, snapshot())
      return
    }
    if (sub === '/api/rename') {
      if (body.name) state.self.name = String(body.name).slice(0, 40)
      bump()
      sendJson(res, 200, snapshot())
      return
    }
    if (sub === '/api/lab') {
      const result = await labStart(body.members)
      bump()
      sendJson(res, 200, { ok: true, ...result, snapshot: snapshot() })
      return
    }
    if (sub === '/api/lab/stop') {
      const result = labStop()
      sendJson(res, 200, { ok: true, ...result, snapshot: snapshot() })
      return
    }
    if (sub === '/api/tunnel/start') {
      const result = await tunnelStart()
      const view = tunnelView()
      sendJson(res, result.running ? 200 : 502, { ok: !!result.running, tunnel: view, error: result.error, snapshot: snapshot() })
      return
    }
    if (sub === '/api/tunnel/stop') {
      tunnelStop()
      sendJson(res, 200, { ok: true, tunnel: tunnelView(), snapshot: snapshot() })
      return
    }
    if (sub === '/api/message') {
      const text = String(body.text || '').slice(0, 4000).trim()
      if (!text) {
        sendJson(res, 400, { error: '消息为空' })
        return
      }
      if (state.mode === 'host') {
        messages.push({ id: randomBytes(6).toString('hex'), from: state.self.id, name: state.self.name, text, at: now() })
        bump()
        sendJson(res, 200, { ok: true })
        return
      }
      if (state.mode === 'guest' && state.relayUrl && state.token) {
        try {
          await fetch(`${state.relayUrl}/message`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: state.token, text }),
          })
          void guestReport()
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 502, { error: String(error && error.message ? error.message : error) })
        }
        return
      }
      sendJson(res, 409, { error: '还没有加入协作室' })
      return
    }
    sendJson(res, 404, { error: 'unknown endpoint' })
  }

  async function handleRelay(sub, req, res) {
    if (sub === '/relay/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, room: state.room ? state.room.code : null, host: state.self.name })
      return
    }
    if (sub === '/relay/join' && req.method === 'POST') {
      const result = relayJoin(await readJson(req))
      sendJson(res, result.status, result.value)
      return
    }
    if (sub === '/relay/report' && req.method === 'POST') {
      const result = relayReport(await readJson(req))
      sendJson(res, result.status, result.value)
      return
    }
    if (sub === '/relay/message' && req.method === 'POST') {
      const result = relayMessage(await readJson(req))
      sendJson(res, result.status, result.value)
      return
    }
    if (sub === '/relay/snapshot' && req.method === 'GET') {
      const url = new URL(req.url || '/', 'http://localhost')
      const member = relayMemberFor(url.searchParams.get('token') || '')
      if (!member) {
        sendJson(res, 403, { error: 'unknown member' })
        return
      }
      member.updatedAt = now()
      const snap = snapshot()
      sendJson(res, 200, {
        roomId: snap.roomId,
        code: snap.code,
        relay: snap.relay,
        members: snap.members,
        messages: snap.messages,
        lab: snap.lab,
        updatedAt: snap.updatedAt,
      })
      return
    }
    sendJson(res, 404, { error: 'unknown relay endpoint' })
  }

  // 邀请落地页：朋友没装插件、甚至只用手机扫码时，也能看到该填什么。
  function joinPage(url) {
    const code = (url.searchParams.get('c') || url.searchParams.get('code') || '').toUpperCase()
    const relay = url.searchParams.get('r') || url.searchParams.get('relay') || `${originOf()}${BASE}/relay`
    const esc = (s) =>
      String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>加入 DSH 协作室</title>
<style>
:root{color-scheme:dark light}
body{margin:0;font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  background:#0f1216;color:#e8eaed;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:520px;width:100%;background:#171c22;border:1px solid #2a333d;border-radius:14px;padding:22px}
h1{font-size:18px;margin:0 0 4px}
p.sub{margin:0 0 18px;color:#9aa4b2;font-size:13px}
.k{font-size:11px;color:#8b96a5;letter-spacing:.04em;text-transform:uppercase}
.v{margin:2px 0 14px;padding:10px 12px;background:#0f1216;border:1px solid #2a333d;border-radius:8px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all}
.code{font-size:26px;letter-spacing:6px;color:#5ad1c0}
ol{margin:0;padding-left:20px;color:#c7cfd9;font-size:13.5px}
ol li{margin:6px 0}
.hint{margin-top:16px;font-size:12px;color:#8b96a5}
</style></head><body><div class="card">
<h1>加入 DSH 协作室</h1>
<p class="sub">全部在本机 / 局域网完成，不经过任何外部服务。</p>
<div class="k">邀请码</div><div class="v code">${esc(code || '——')}</div>
<div class="k">Relay 地址</div><div class="v">${esc(relay)}</div>
<ol><li>打开你自己的 DeepSeek Harness，新建会话时选「协作模式」</li>
<li>点输入框下方的「开启协作」</li>
<li>把上面的 Relay 地址和邀请码填进「加入朋友的协作室」，点「加入」</li>
<li>如果想直接跳转，复制这条链接到同一个浏览器：<br>
<span class="v" style="display:block;margin-top:6px">${esc(url.origin)}/?collab=${esc(code)}&amp;relay=${esc(relay)}</span></li>
</ol>
<div class="hint">看不到面板说明插件没装：让房主把 <code>collab-plugin</code> 目录拷给你，在 DSH 里执行 <code>plugin_manager install_bundle</code>。</div>
</div></body></html>`
  }

  async function routeHandler(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const sub = url.pathname.slice(BASE.length)
      if (sub === '/join' || sub === '/join/') {
        sendHtml(res, 200, joinPage(url))
        return
      }
      if (sub.startsWith('/relay')) {
        await handleRelay(sub, req, res)
        return
      }
      await handleApi(sub, req, res)
    } catch (error) {
      // 便于排障：把栈打到 Host 日志，同时给浏览器一个可读的错误。
      console.error('[dsh-collab]', error)
      try {
        sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
      } catch {
        /* 响应已发出 */
      }
    }
  }

  // 路由必须挂在自己的 effect 上：插件被卸载 / 被新一代实例替换时，webServer 里的
  // 这条路由要一起释放，否则同一条行再装一次会因为 duplicate prefix route 而激活失败。
  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'prefix', path: BASE, handler: routeHandler })
    return () => {
      try {
        dispose()
      } catch {
        /* 已经释放过 */
      }
    }
  })

  ctx.effect(() => () => {
    stopGuestLoop()
    tunnelStop()
    if (relayServer) {
      try {
        relayServer.close()
      } catch {
        /* ignore */
      }
      relayServer = null
    }
    if (labTimer) clearInterval(labTimer)
    labTimer = null
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    for (const res of clients) {
      try {
        res.end()
      } catch {
        /* ignore */
      }
    }
    clients.clear()
  })
}

// hmr probe 1795579184
