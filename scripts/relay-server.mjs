#!/usr/bin/env node
/**
 * scripts/relay-server.mjs — 独立协作中继（不依赖 DSH，也不需要任何账号）。
 *
 * 为什么要有它：插件内置的 relay 活在某个人的 DSH 进程里，那个人一关 DSH、
 * 一换机器，整个房间就断了。团队长期使用时更合适的拓扑是：
 *
 *    每个人的 DSH ──HTTP──> 独立 relay（本机 / 局域网易台机器 / VPS / Tailscale Funnel）
 *
 * relay 只做房间与进度的中转：不调模型、不需要登录 DSH、不需要任何账号。
 * 谁都不影响谁——某人退出，其它人照常看板与协作。
 *
 *   node scripts/relay-server.mjs --port 8787
 *   node scripts/relay-server.mjs --port 8787 --host 0.0.0.0 --rooms 8
 *
 * 暴露的接口与插件内置 relay 完全一致（/dsh-collab/relay/*），所以插件的
 * 「加入别人的协作室」直接填这个地址即可。
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import { watchHtml } from './watch-page.mjs'
import { statusHtml } from './status-page.mjs'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const PORT = Number(argOf('port', process.env.RELAY_PORT || 8787))
const HOST = argOf('host', process.env.RELAY_HOST || '127.0.0.1')
const MAX_ROOMS = Number(argOf('rooms', 64))
const IDLE_HOURS = Number(argOf('idle-hours', 12))
const BASE = '/dsh-collab'
const MAX_SESSIONS = 40
const MAX_MESSAGES = 300
const TIMELINE_WIRE = 6
const ARTIFACTS_WIRE = 6
const MEMBER_STALE_MS = 15000

const now = () => Date.now()
const shortId = (prefix = 'm') => `${prefix}_${randomBytes(6).toString('hex')}`
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function roomCode(existing) {
  for (;;) {
    const bytes = randomBytes(6)
    let code = ''
    for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length]
    if (!existing.has(code)) return code
  }
}

/** @type {Map<string, {id:string, code:string, createdAt:number, updatedAt:number, host:string, members:Map<string, any>, tokens:Map<string,string>, messages:any[]}>} */
const rooms = new Map()
// ── 落盘：房间与消息存到 data/rooms.json，中继重启后房间还在 ──────────────
const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const DATA_DIR = process.env.RELAY_DATA_DIR ? String(process.env.RELAY_DATA_DIR) : join(ROOT_DIR, 'data')
const ROOMS_FILE = join(DATA_DIR, 'rooms.json')
let saveTimer = null

function persistRooms() {
  try {
    const payload = {
      savedAt: now(),
      rooms: [...rooms.values()].map((room) => ({
        id: room.id,
        code: room.code,
        host: room.host,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        messages: room.messages.slice(-200),
      })),
    }
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(ROOMS_FILE, JSON.stringify(payload), 'utf8')
  } catch {
    /* 落盘失败不影响服务 */
  }
}

function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistRooms()
  }, 1500)
  if (typeof saveTimer.unref === 'function') saveTimer.unref()
}

function loadRooms() {
  try {
    if (!existsSync(ROOMS_FILE)) return 0
    const payload = JSON.parse(readFileSync(ROOMS_FILE, 'utf8'))
    const idleMs = IDLE_HOURS * 3600_000
    let restored = 0
    for (const item of payload.rooms || []) {
      if (!item || !item.code) continue
      if (now() - (item.updatedAt || 0) > idleMs) continue
      rooms.set(item.code, {
        id: item.id || shortId('r'),
        code: item.code,
        host: item.host || 'relay',
        createdAt: item.createdAt || now(),
        updatedAt: item.updatedAt || now(),
        members: new Map(),
        tokens: new Map(),
        messages: Array.isArray(item.messages) ? item.messages.slice(-200) : [],
      })
      restored += 1
    }
    return restored
  } catch {
    return 0
  }
}



function roomsView() {
  return [...rooms.values()].map((room) => ({
    code: room.code,
    host: room.host,
    members: [...room.members.values()].filter((m) => now() - m.updatedAt < MEMBER_STALE_MS).length,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  }))
}

function trimRooms() {
  const idleMs = IDLE_HOURS * 3600_000
  for (const [code, room] of rooms) {
    if (now() - room.updatedAt > idleMs) rooms.delete(code)
  }
  if (rooms.size <= MAX_ROOMS) return
  const sorted = [...rooms.values()].sort((a, b) => a.updatedAt - b.updatedAt)
  for (const room of sorted.slice(0, rooms.size - MAX_ROOMS)) rooms.delete(room.code)
}

function snapshotFor(room, req) {
  const members = [...room.members.values()].map((member) => ({
    ...member,
    online: now() - member.updatedAt < MEMBER_STALE_MS,
  }))
  return {
    roomId: room.id,
    code: room.code,
    relay: relayUrlFor(req),
    members,
    messages: room.messages.slice(-MAX_MESSAGES),
    updatedAt: room.updatedAt,
  }
}

let origin = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`
function relayUrl() {
  return `${origin.replace(/\/+$/, '')}${BASE}/relay`
}

/**
 * 对外的 relay 地址要跟访问者看到的一致：走 Tailscale Funnel / nginx 时
 * Host 头是公网域名，x-forwarded-proto 说明是 https。落地页与二维码都靠它。
 */
function relayUrlFor(req) {
  const host = req && req.headers ? req.headers.host : ''
  const proto = (req && req.headers && (req.headers['x-forwarded-proto'] || '')).split(',')[0].trim()
  if (!host) return relayUrl()
  const scheme = proto === 'https' || proto === 'http' ? proto : 'http'
  return `${scheme}://${host}${BASE}/relay`
}

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

async function readJson(req, limit = 2_000_000) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('payload too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  return text.trim() ? JSON.parse(text) : {}
}

const ALLOW_ALL_PRESETS = process.env.RELAY_ALLOW_ALL_PRESETS === '1'

/**
 * 客厅只收「协作模式」会话：普通会话（标准/创造等）一进不了客厅，
 * 所以谁在别的模式下干活，进度和资料都不会被共享 —— 还没升级插件的队友也一样。
 */
function sanitizeSession(item) {
  if (!item) return null
  const preset = String(item.preset || '').toLowerCase()
  if (!ALLOW_ALL_PRESETS && preset !== 'collab') return null
  return {
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
    timeline: Array.isArray(item.timeline)
      ? item.timeline.slice(-TIMELINE_WIRE).map((entry) => ({
          id: String(entry.id || ''),
          at: Number(entry.at) || now(),
          kind: entry.kind === 'say' || entry.kind === 'ask' ? entry.kind : 'tool',
          tool: entry.tool ? String(entry.tool).slice(0, 48) : null,
          text: entry.text ? String(entry.text).slice(0, 280) : '',
        }))
      : [],
    artifacts: Array.isArray(item.artifacts)
      ? item.artifacts.slice(0, ARTIFACTS_WIRE).map((art) => ({
          id: String(art.id || ''),
          path: String(art.path || '').slice(0, 240),
          title: String(art.title || '').slice(0, 120),
          tool: art.tool ? String(art.tool).slice(0, 32) : null,
          at: Number(art.at) || now(),
          bytes: Number(art.bytes) || null,
          truncated: !!art.truncated,
          note: art.note ? String(art.note).slice(0, 120) : null,
        }))
      : [],
  }
}

function memberFor(token) {
  for (const room of rooms.values()) {
    const memberId = room.tokens.get(token)
    if (memberId) return { room, member: room.members.get(memberId) }
  }
  return null
}

function createRoom(name) {
  const room = {
    id: shortId('r'),
    code: roomCode(rooms),
    createdAt: now(),
    updatedAt: now(),
    host: String(name || 'relay').slice(0, 40),
    members: new Map(),
    tokens: new Map(),
    messages: [],
  }
  rooms.set(room.code, room)
  trimRooms()
  scheduleSave()
  return room
}

const joinPage = (code, relayAddr) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>加入协作室</title>
<style>body{margin:0;font:15px/1.6 ui-sans-serif,system-ui,sans-serif;background:#0f1216;color:#e8eaed;
display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:520px;width:100%;background:#171c22;border:1px solid #2a333d;border-radius:14px;padding:22px}
h1{font-size:18px;margin:0 0 4px}p{color:#9aa4b2;font-size:13px}
.v{margin:6px 0 14px;padding:10px 12px;background:#0f1216;border:1px solid #2a333d;border-radius:8px;
font-family:ui-monospace,Menlo,monospace;font-size:13px;word-break:break-all}
.code{font-size:26px;letter-spacing:6px;color:#5ad1c0}</style></head><body><div class="card">
<h1>加入 DSH 协作室</h1><p>独立 relay，不依赖任何人的 DSH 在线。</p>
<div>邀请码</div><div class="v code">${code}</div>
<div>Relay 地址</div><div class="v">${relayAddr}</div>
<p>在你自己的 DSH 里：新建会话 → 协作模式 → 开启协作 → 把上面的地址和邀请码填进「加入别人的协作室」。</p>
</div></body></html>`

function handleRelay(sub, req, res) {
  if (sub === '/relay/health' && req.method === 'GET') {
    json(res, 200, { ok: true, rooms: rooms.size, host: hostname(), relay: relayUrlFor(req) })
    return
  }
  if (sub === '/relay/rooms' && req.method === 'GET') {
    json(res, 200, { ok: true, rooms: roomsView() })
    return
  }
  if (sub === '/relay/room' && req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost')
    const code = (url.searchParams.get('code') || url.searchParams.get('c') || '').toUpperCase()
    const room = rooms.get(code)
    if (!room) {
      json(res, 404, { error: 'no such room' })
      return
    }
    const online = [...room.members.values()].filter((m) => now() - m.updatedAt < MEMBER_STALE_MS)
    json(res, 200, {
      code: room.code,
      host: room.host,
      members: online.length,
      totalMembers: room.members.size,
      relay: relayUrlFor(req),
      createdAt: room.createdAt,
    })
    return
  }
  if (sub === '/relay/room' && req.method === 'POST') {
    return readJson(req).then((body) => {
      const room = createRoom(body.name)
      json(res, 200, { ok: true, code: room.code, roomId: room.id, relay: relayUrlFor(req) })
    })
  }
  if (sub === '/relay/join' && req.method === 'POST') {
    return readJson(req).then((body) => {
      const code = String(body.code || '').trim().toUpperCase()
      let room = rooms.get(code)
      if (!room) {
        if (!body.create) {
          json(res, 404, { error: 'room not found（可带 create:true 自动创建）' })
          return
        }
        room = createRoom(body.name)
        if (code) {
          rooms.delete(room.code)
          room.code = code
          rooms.set(code, room)
        }
      }
      // 同一个人（同一台机器）重复加入时复用已有成员，客厅里不会出现两个"我"
      const deviceId = String(body.deviceId || '').slice(0, 64)
      let member = deviceId ? [...room.members.values()].find((item) => item.deviceId === deviceId) : undefined
      if (!member) {
        member = {
          id: shortId('g'),
          name: String(body.name || 'guest').slice(0, 40),
          machine: String(body.machine || '').slice(0, 60),
          deviceId,
          online: true,
          self: false,
          updatedAt: now(),
          sessions: [],
        }
        room.members.set(member.id, member)
      } else {
        if (body.name) member.name = String(body.name).slice(0, 40)
        if (body.machine) member.machine = String(body.machine).slice(0, 60)
        member.online = true
        member.updatedAt = now()
      }
      const token = randomBytes(16).toString('hex')
      room.tokens.set(token, member.id)
      scheduleSave()
      room.updatedAt = now()
      json(res, 200, {
        token,
        self: { id: member.id, name: member.name },
        room: { id: room.id, code: room.code },
        messages: room.messages.slice(-MAX_MESSAGES),
      })
    })
  }
  if (sub === '/relay/report' && req.method === 'POST') {
    return readJson(req).then((body) => {
      const found = memberFor(String(body.token || ''))
      if (!found) {
        json(res, 403, { error: 'unknown member' })
        return
      }
      const sessions = Array.isArray(body.sessions) ? body.sessions : []
      found.member.sessions = sessions
        .slice(0, MAX_SESSIONS)
        .map(sanitizeSession)
        .filter(Boolean)
      found.member.updatedAt = now()
      found.member.online = true
      if (body.name) found.member.name = String(body.name).slice(0, 40)
      if (body.artifactBodies && typeof body.artifactBodies === 'object') {
        found.member.artifactBodies = found.member.artifactBodies || {}
        for (const [sessionId, map] of Object.entries(body.artifactBodies)) {
          if (!map || typeof map !== 'object') continue
          const bucket = found.member.artifactBodies[sessionId] || {}
          for (const [artifactId, text] of Object.entries(map)) {
            if (typeof text === 'string') bucket[artifactId] = text.slice(0, 32 * 1024)
          }
          found.member.artifactBodies[sessionId] = bucket
        }
      }
      found.room.updatedAt = now()
      json(res, 200, { ok: true, messages: found.room.messages.slice(-MAX_MESSAGES) })
    })
  }
  if (sub === '/relay/message' && req.method === 'POST') {
    return readJson(req).then((body) => {
      const found = memberFor(String(body.token || ''))
      if (!found) {
        json(res, 403, { error: 'unknown member' })
        return
      }
      const text = String(body.text || '').slice(0, 4000).trim()
      if (!text) {
        json(res, 400, { error: 'empty message' })
        return
      }
      found.room.messages.push({
        id: randomBytes(6).toString('hex'),
        from: found.member.id,
        name: found.member.name,
        text,
        at: now(),
      })
      if (found.room.messages.length > MAX_MESSAGES) {
        found.room.messages.splice(0, found.room.messages.length - MAX_MESSAGES)
      }
      found.room.updatedAt = now()
      json(res, 200, { ok: true })
    })
  }
  if (sub === '/relay/board' && req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost')
    const code = (url.searchParams.get('code') || url.searchParams.get('c') || '').toUpperCase()
    const room = rooms.get(code)
    if (!room) {
      json(res, 404, { error: 'room not found' })
      return
    }
    const members = [...room.members.values()].map((member) => ({
      id: member.id,
      name: member.name,
      machine: member.machine,
      online: now() - member.updatedAt < MEMBER_STALE_MS,
      updatedAt: member.updatedAt,
      sessions: (member.sessions || []).map((session) => ({
        id: session.id,
        label: session.label,
        status: session.status,
        tool: session.tool,
        note: session.note,
        turn: session.turn,
        tokensIn: session.tokensIn,
        tokensOut: session.tokensOut,
        at: session.at,
        timeline: session.timeline,
        artifacts: session.artifacts,
      })),
    }))
    json(res, 200, {
      code: room.code,
      host: room.host,
      relay: relayUrlFor(req),
      members,
      messages: room.messages.slice(-100),
      updatedAt: room.updatedAt,
    })
    return
  }
  if (sub === '/relay/snapshot' && req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost')
    const found = memberFor(url.searchParams.get('token') || '')
    if (!found) {
      json(res, 403, { error: 'unknown member' })
      return
    }
    found.member.updatedAt = now()
    json(res, 200, snapshotFor(found.room, req))
    return
  }
  if (sub === '/relay/artifact' && req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost')
    const found = memberFor(url.searchParams.get('token') || '')
    if (!found) {
      json(res, 403, { error: 'unknown member' })
      return
    }
    const memberId = url.searchParams.get('member') || ''
    const sessionId = url.searchParams.get('session') || ''
    const artifactId = url.searchParams.get('aid') || ''
    const member = found.room.members.get(memberId)
    if (!member) {
      json(res, 404, { error: 'no member' })
      return
    }
    const session = (member.sessions || []).find((item) => item.id === sessionId)
    const meta = session && (session.artifacts || []).find((item) => item.id === artifactId)
    if (!meta) {
      json(res, 404, { error: 'no artifact' })
      return
    }
    const bodies = (member.artifactBodies && member.artifactBodies[sessionId]) || {}
    json(res, 200, {
      title: meta.title,
      path: meta.path,
      bytes: meta.bytes,
      truncated: !!meta.truncated,
      note: meta.note || null,
      text: Object.prototype.hasOwnProperty.call(bodies, artifactId) ? bodies[artifactId] : null,
    })
    return
  }
  json(res, 404, { error: 'unknown relay endpoint' })
}


/** 给自检页用的候选地址：局域网 / Tailscale / 公网隧道都列出来，谁通用谁。 */
function candidateAddresses(req, port) {
  const list = []
  const seen = new Set()
  const add = (label, ip, note) => {
    const url = `http://${ip}:${port}${BASE}/relay`
    if (seen.has(url)) return
    seen.add(url)
    list.push({ label, url, note })
  }
  const nets = networkInterfaces()
  for (const [name, infos] of Object.entries(nets)) {
    for (const info of infos || []) {
      if (!info || info.family !== 'IPv4' || info.internal) continue
      if (/^169\.254\./.test(info.address)) continue
      if (info.address.startsWith('100.')) {
        add('Tailscale', info.address, '装了 Tailscale 并加入同一 tailnet 就能用这条')
        continue
      }
      if (/VMware|VirtualBox|Npcap|Hyper-V|Loopback|vEthernet/i.test(name)) continue
      add('局域网', info.address, '同一 WiFi / 同一办公室网络可用这条（最稳）')
    }
  }
  const hostHeader = req && req.headers ? req.headers.host : ''
  const proto = ((req && req.headers && (req.headers['x-forwarded-proto'] || '')) || '').split(',')[0].trim() || 'http'
  if (hostHeader && !/^127\.|^localhost/i.test(hostHeader)) {
    list.unshift({ label: '公网隧道', url: `${proto}://${hostHeader}${BASE}/relay`, note: '走 Cloudflare 临时隧道；部分网络会拦截 trycloudflare.com' })
  }
  return list
}
const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  const sub = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null
  Promise.resolve()
    .then(() => {
      if (sub === '/status' || sub === '/status/') {
        const portMatch = String(req.headers.host || '').match(/:(\d+)$/)
        const port = portMatch ? Number(portMatch[1]) : PORT
        html(res, 200, statusHtml({
          host: hostname(),
          rooms: roomsView(),
          updatedAt: now(),
          currentVia: String(req.headers.host || ''),
          addresses: candidateAddresses(req, port),
        }))
        return
      }
      if (sub === '/watch' || sub === '/watch/') {
        const code = (url.searchParams.get('c') || url.searchParams.get('code') || '').toUpperCase()
        html(res, 200, watchHtml(code))
        return
      }
      if (sub === '/join' || sub === '/join/') {
        const code = (url.searchParams.get('c') || url.searchParams.get('code') || '').toUpperCase()
        html(res, 200, joinPage(code, relayUrlFor(req)))
        return
      }
      if (sub && sub.startsWith('/relay')) return handleRelay(sub, req, res)
      if (!sub || sub === '/' || sub === '') {
        json(res, 200, { ok: true, service: 'dsh-collab independent relay', relay: relayUrlFor(req), rooms: roomsView() })
        return
      }
      json(res, 404, { error: 'not found' })
    })
    .catch((error) => {
      try {
        json(res, 500, { error: String(error && error.message ? error.message : error) })
      } catch {
        /* ignore */
      }
    })
})

// 定期清理闲置房间
const sweeper = setInterval(trimRooms, 10 * 60_000)
if (typeof sweeper.unref === 'function') sweeper.unref()

const restoredRooms = loadRooms()
server.listen(PORT, HOST, () => {
  const address = server.address()
  origin = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${address.port}`
  console.log(`dsh-collab relay 已启动：${relayUrl()}${restoredRooms ? `（已恢复 ${restoredRooms} 个房间）` : ''}`)
  console.log(`  健康检查  GET  ${origin}${BASE}/relay/health`)
  console.log(`  房间列表  GET  ${origin}${BASE}/relay/rooms`)
  console.log(`  邀请落地页 GET  ${origin}${BASE}/join?c=<邀请码>`)
  console.log(`  公网暴露：把 ${HOST}:${address.port} 交给 Tailscale Funnel / nginx / 反代，再把这个地址填到插件面板的「固定地址」。`)
})
