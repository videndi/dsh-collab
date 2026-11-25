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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect as netConnect } from 'node:net'
import { homedir, hostname, networkInterfaces, userInfo } from 'node:os'
import { dirname, join as joinPath } from 'node:path'
import { qrSvgPath } from './qr.js'

export const name = 'dsh-collab'

/** 唯一的硬依赖：要在既有的浏览器 HTTP 服务上挂自己的路由。 */
export const inject = ['webServer']

const BASE = '/dsh-collab'

/**
 * 团队默认中继：装好插件不用填地址，输房间号就能进。
 * 想换中继，面板「第 0 步」里改一次即可（会覆盖这里）。
 */
const DEFAULT_HOME_RELAY = 'http://124.223.178.145/dsh-collab/relay'
const MAX_SESSIONS = 40
const MAX_MESSAGES = 300
const IDLE_HIDE_MS = 6 * 60 * 60 * 1000
const GUEST_TICK_MS = 2000
const MEMBER_STALE_MS = 15000
const LAB_TICK_MS = 1400
const MAX_TIMELINE = 24
const MAX_ARTIFACTS = 12
const MAX_ARTIFACT_BYTES = 32 * 1024
// 快照每 2 秒推一次：上行的条目数要克制（本机仍保留更多历史，只是不往外发）
const TIMELINE_WIRE = 6
const ARTIFACTS_WIRE = 6

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

function settingsBases() {
  const bases = []
  const add = (value) => {
    if (value && String(value).trim()) bases.push(String(value).trim())
  }
  add(process.env.DSH_HOME)
  add(process.env.DSH_PROFILE_DIR)
  try {
    add(joinPath(process.cwd(), 'home'))
    add(joinPath(homedir(), '.dsh'))
  } catch {
    /* ignore */
  }
  return bases
}

/**
 * 插件自己的小配置：固定公网地址（Tailscale Funnel / nginx / 固定隧道都行）、
 * 自己的显示名。落在 DSH home 下的 collab/settings.json，重启后仍然在。
 */
function settingsFile() {
  const bases = settingsBases()
  const base = bases.find((dir) => existsSync(dir)) || bases[0]
  if (!base) return null
  return joinPath(base, 'collab', 'settings.json')
}

function loadSettings() {
  try {
    const file = settingsFile()
    if (!file || !existsSync(file)) return {}
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveSettings(patch) {
  try {
    const file = settingsFile()
    if (!file) return null
    mkdirSync(dirname(file), { recursive: true })
    const next = { ...loadSettings(), ...patch }
    writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
    return next
  } catch {
    return null
  }
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
  const persisted = loadSettings()
  const state = {
    // 固定公网地址（Tailscale Funnel / nginx / 固定隧道），设了就用它生成邀请链接
    publicBaseUrl: typeof persisted.publicBaseUrl === 'string' ? persisted.publicBaseUrl : '',
    // 全团队只配一次的中继地址（配好后，加入只需要房间号，像搜微信号）
    homeRelay:
      typeof persisted.homeRelay === 'string' && persisted.homeRelay
        ? persisted.homeRelay
        : DEFAULT_HOME_RELAY,
    // 问答分离：默认不把模型的输出片段发给房间，只共享「做了什么 + 交付了什么」
    shareTranscript: persisted.shareTranscript === true,
    // 客厅隔离：只共享「协作模式」会话（settings 里可放开，默认关闭）
    shareAllSessions: persisted.shareAllSessions === true,
    mode: 'offline', // offline | host | guest
    self: {
      id: shortId('u'),
      name: defaultName(),
      machine: hostname(),
      // 这台机器/这份 DSH 的稳定身份：加入同一房间时不会重复出现
      installId: typeof persisted.installId === 'string' && persisted.installId ? persisted.installId : randomBytes(12).toString('hex'),
    },
    room: null,
    relayUrl: null,
    token: null,
    remoteSnap: null,
  }

  // 第一次运行把安装标识写进设置，之后每次加入房间都用它作为稳定身份
  if (!persisted.installId) saveSettings({ installId: state.self.installId })

  const localSessions = new Map()
  const relayMembers = new Map()
  const relayTokens = new Map()
  const messages = []
  const clients = new Set()

  let guestTimer = null
  let labTimer = null
  let flushTimer = null
  let qrCache = { key: '', value: null }

  // ── 会话级房间（一栋楼里的不同房间）──────────────────────────────────
  // 每个「协作模式」会话各自一个房间：谁在这个会话里开协作，队友加入同一个房间号，
  // 才看得到这个会话的客厅；其它会话（其它项目）互不可见。
  // 会话模式切换事件里的最新 preset（会话还没产生事件时也能判断"是不是协作模式"）
  const presetOfSession = new Map()
  const bindings = new Map()
  let bindingTimer = null
  let bindingBusy = false

  function serializeBindings() {
    const out = {}
    for (const [sessionId, item] of bindings) out[sessionId] = { code: item.code, relay: item.relay }
    return out
  }

  function restoreBindings() {
    const saved = persisted.bindings && typeof persisted.bindings === 'object' ? persisted.bindings : {}
    for (const [sessionId, item] of Object.entries(saved)) {
      if (!item || !item.code || !item.relay) continue
      bindings.set(String(sessionId), { code: String(item.code), relay: String(item.relay), token: '', snap: null, lastAt: 0 })
    }
  }

  function persistBindings() {
    saveSettings({ bindings: serializeBindings() })
  }

  /** 读 live agent 当前挂的 preset（切换过模式的会话，header 里还是旧值）。 */
  function livePresetOf(sessionId) {
    try {
      const agents = ctx.get ? ctx.get('agents') : undefined
      const presets = ctx.get ? ctx.get('agentPresets') : undefined
      if (!agents || !presets || typeof agents.get !== 'function') return ''
      const agent = agents.get(sessionId)
      if (!agent || !agent.ctx) return ''
      const preset = presets.composedPreset(agent.ctx)
      return typeof preset === 'string' ? preset : ''
    } catch {
      return ''
    }
  }

  function sessionViewOf(sessionId) {
    const rec = localSessions.get(String(sessionId))
    if (!rec) return null
    return {
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
      timeline: rec.timeline.filter((entry) => state.shareTranscript || entry.kind !== 'say').slice(-TIMELINE_WIRE),
      artifacts: rec.artifacts.slice(0, ARTIFACTS_WIRE).map(({ text, ...meta }) => meta),
    }
  }

  function artifactBodiesOf(sessionId) {
    const rec = localSessions.get(String(sessionId))
    if (!rec || !rec.artifacts.length) return {}
    const bucket = {}
    for (const art of rec.artifacts) if (typeof art.text === 'string') bucket[art.id] = art.text
    return Object.keys(bucket).length ? { [rec.id]: bucket } : {}
  }

  async function relayPost(relay, path, body) {
    const response = await fetch(relay.replace(/\/+$/, '') + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(10000),
    })
    const payload = await response.json().catch(() => null)
    return { ok: response.ok, status: response.status, payload }
  }

  async function relayGet(relay, path) {
    const response = await fetch(relay.replace(/\/+$/, '') + path, { signal: AbortSignal.timeout(10000) })
    const payload = await response.json().catch(() => null)
    return { ok: response.ok, status: response.status, payload }
  }

  async function createRoomForSession(sessionId) {
    const relay = state.homeRelay
    if (!relay) return { error: '还没有中继地址' }
    const view = sessionViewOf(sessionId)
    const created = await relayPost(relay, '/room', { name: view ? view.label : 'collab' })
    if (!created.ok || !created.payload || !created.payload.code) return { error: '建房间失败（' + created.status + '）' }
    const code = created.payload.code
    const joined = await relayPost(relay, '/join', {
      code,
      name: state.self.name,
      machine: hostname(),
      deviceId: state.self.installId,
      create: false,
    })
    if (!joined.ok || !joined.payload || !joined.payload.token) return { error: '加入房间失败（' + joined.status + '）' }
    bindings.set(String(sessionId), {
      code,
      relay,
      token: joined.payload.token,
      snap: null,
      lastAt: 0,
      label: view ? view.label : '这个会话',
    })
    persistBindings()
    void reportBinding(String(sessionId), bindings.get(String(sessionId)))
    return { code, relay }
  }

  async function joinRoomForSession(sessionId, code, relayOverride) {
    const relay = relayOverride || state.homeRelay
    if (!relay) return { error: '还没有中继地址' }
    const target = String(code || '').trim().toUpperCase()
    if (!target) return { error: '需要房间号' }
    const joined = await relayPost(relay, '/join', {
      code: target,
      name: state.self.name,
      machine: hostname(),
      deviceId: state.self.installId,
      create: false,
    })
    if (!joined.ok || !joined.payload || !joined.payload.token) {
      return { error: joined.status === 404 ? '没找到房间 ' + target : '加入失败（' + joined.status + '）' }
    }
    bindings.set(String(sessionId), {
      code: target,
      relay,
      token: joined.payload.token,
      snap: null,
      lastAt: 0,
      label: (sessionViewOf(sessionId) || {}).label || '这个会话',
    })
    persistBindings()
    void reportBinding(String(sessionId), bindings.get(String(sessionId)))
    return { code: target, relay }
  }

  async function reportBinding(sessionId, binding) {
    if (!binding) return
    // 重启后 token 会丢（restoreBindings 只恢复 code/relay）：先用房间号重新加入，
    // 拿到 token 再上报。否则这个绑定会永远静默、面板一直显示「0 人」。
    if (!binding.token) {
      try {
        const joined = await relayPost(binding.relay, '/join', {
          code: binding.code,
          name: state.self.name,
          machine: hostname(),
          deviceId: state.self.installId,
          create: true,
        })
        if (joined.ok && joined.payload && joined.payload.token) {
          binding.token = joined.payload.token
        } else {
          return
        }
      } catch {
        return
      }
    }
    // 会话可能还没有任何事件（比如刚重启后没打开过它）：仍然要上报一个最小视图，
    // 否则这个绑定会一直静默，面板里就永远显示"0 人"。
    const view = sessionViewOf(sessionId) || {
      id: String(sessionId),
      label: binding.label || '这个会话',
      preset: 'collab',
      status: 'idle',
      tool: null,
      note: null,
      turn: 0,
      tokensIn: 0,
      tokensOut: 0,
      at: now(),
      timeline: [],
      artifacts: [],
    }
    try {
      const reported = await relayPost(binding.relay, '/report', {
        token: binding.token,
        name: state.self.name,
        sessions: [view],
        artifactBodies: artifactBodiesOf(sessionId),
      })
      if (!reported.ok) {
        if (reported.status === 403 || reported.status === 404) {
          const rejoined = await relayPost(binding.relay, '/join', {
            code: binding.code,
            name: state.self.name,
            machine: hostname(),
            deviceId: state.self.installId,
            create: true,
          })
          if (rejoined.ok && rejoined.payload && rejoined.payload.token) binding.token = rejoined.payload.token
        }
        return
      }
      const snap = await relayGet(binding.relay, '/snapshot?token=' + encodeURIComponent(binding.token))
      if (snap.ok && snap.payload) {
        binding.snap = snap.payload
        binding.lastAt = now()
      }
    } catch {
      /* 下个周期再试 */
    }
  }

  async function tickBindings() {
    if (bindingBusy) return
    bindingBusy = true
    try {
      for (const [sessionId, binding] of bindings) await reportBinding(sessionId, binding)
    } finally {
      bindingBusy = false
    }
    pushToClients()
  }

  function dropBinding(sessionId) {
    bindings.delete(String(sessionId))
    persistBindings()
    pushToClients()
  }

  const lab = { running: false, members: [] }

  // 房主的 DSH 往往只监听 127.0.0.1：这时把局域网 IP 写进邀请链接会误导队友。
  // 这里对每个网卡地址做一次真实 TCP 连接探测，只用探测成功的地址生成链接。
  let reachableHosts = null // Set<string> | null（null = 还没测过）
  let probeTimer = null

  async function probeReachableHosts() {
    const ips = lanIPv4()
    if (!ips.length) {
      reachableHosts = new Set()
      return
    }
    let port = 0
    try {
      const url = new URL(originOf())
      port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    } catch {
      return
    }
    const alive = new Set()
    await Promise.all(
      ips.map(
        (ip) =>
          new Promise((resolve) => {
            const socket = netConnect({ host: ip, port, timeout: 900 })
            const done = (ok) => {
              if (ok) alive.add(ip)
              socket.destroy()
              resolve()
            }
            socket.once('connect', () => done(true))
            socket.once('timeout', () => done(false))
            socket.once('error', () => done(false))
          }),
      ),
    )
    reachableHosts = alive
    bump()
  }

  // 上次加入过的房间：DSH 重启后自动回去，不用每次手动填地址
  const resumeRelay = typeof persisted.relay === 'string' ? persisted.relay : ''
  const resumeCode = typeof persisted.code === 'string' ? persisted.code : ''
  if (resumeRelay && resumeCode) {
    let attempts = 0
    // 中继可能比 DSH 晚起来（比如开机顺序）：持续重试一小时，别试几次就放弃。
    const resumeTimer = setInterval(async () => {
      attempts += 1
      if (state.mode === 'guest' || attempts > 720) {
        clearInterval(resumeTimer)
        return
      }
      try {
        const response = await fetch(`${originOf()}${BASE}/api/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ relay: resumeRelay, code: resumeCode, name: state.self.name }),
        })
        if (response.ok) {
          clearInterval(resumeTimer)
          console.log('[dsh-collab] 已自动回到协作室', resumeCode)
        }
      } catch {
        /* 端口或中继还没起来，等下一轮 */
      }
    }, 5000)
    if (resumeTimer && typeof resumeTimer.unref === 'function') resumeTimer.unref()
  }

  // 会话级房间：恢复上次绑定，每 2 秒给每个已绑定会话各上报一次
  restoreBindings()
  bindingTimer = setInterval(() => void tickBindings(), GUEST_TICK_MS)
  if (bindingTimer && typeof bindingTimer.unref === 'function') bindingTimer.unref()

  void probeReachableHosts()
  probeTimer = setInterval(() => void probeReachableHosts(), 60_000)
  if (probeTimer && typeof probeTimer.unref === 'function') probeTimer.unref()

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

  function basenameOf(path) {
    const parts = String(path).split(/[\\/]+/).filter(Boolean)
    return (parts[parts.length - 1] || String(path)).slice(0, 120)
  }

  /** 把一次工具调用折成一行人话，让队友看得懂“他在干什么”。 */
  function summarizeToolArgs(name, raw) {
    let args = null
    try {
      args = raw ? JSON.parse(String(raw)) : null
    } catch {
      args = null
    }
    if (!args || typeof args !== 'object') return String(raw || '').slice(0, 120)
    const pick = (key, max = 100) => (typeof args[key] === 'string' ? args[key].replace(/\s+/g, ' ').slice(0, max) : '')
    if (name === 'bash' || name === 'pwsh' || name === 'win_bash') return pick('command', 140)
    if (name === 'read' || name === 'write' || name === 'edit') return pick('file_path', 140) || pick('path', 140)
    if (name === 'grep') return (pick('pattern', 70) + (args.path ? '  @ ' + pick('path', 70) : '')).trim()
    if (name === 'web_search') return pick('query', 120)
    if (name === 'web_fetch') return pick('url', 120)
    if (name === 'subagent' || name === 'subagent_fork') return pick('description', 120) || pick('prompt', 120)
    if (name === 'present') return pick('description', 120) || pick('path', 120)
    if (name === 'todo_write') return '更新任务清单'
    return pick('description', 120) || pick('query', 120) || pick('command', 100)
  }

  function pushTimeline(rec, entry) {
    rec.timeline.push({ id: randomBytes(4).toString('hex'), at: now(), ...entry })
    if (rec.timeline.length > MAX_TIMELINE) rec.timeline.splice(0, rec.timeline.length - MAX_TIMELINE)
  }

  /** 把一次交付（present / write / edit）里的文件登记成“成果”，带一段正文供队友预览。 */
  function addArtifactFromPath(rec, path, tool, force = false) {
    const clean = String(path || '').trim()
    if (!clean) return
    const existing = rec.artifacts.find((item) => item.path === clean)
    if (existing && !force) {
      existing.at = now()
      existing.tool = tool
      return
    }
    if (existing && force) {
      existing.at = now()
      existing.tool = tool
    }
    const artifact = existing || {
      id: randomBytes(4).toString('hex'),
      path: clean.slice(0, 240),
      title: basenameOf(clean),
      tool,
      at: now(),
      bytes: null,
      text: null,
      truncated: false,
      note: null,
    }
    try {
      const stat = statSync(clean)
      artifact.bytes = stat.size
      if (!stat.isFile()) {
        artifact.note = '不是普通文件'
      } else if (stat.size <= MAX_ARTIFACT_BYTES) {
        const body = readFileSync(clean, 'utf8')
        artifact.text = body.slice(0, MAX_ARTIFACT_BYTES)
        artifact.truncated = body.length > MAX_ARTIFACT_BYTES
      } else {
        artifact.note = '文件超过 32KB，只同步元数据'
      }
    } catch {
      artifact.note = '读取失败（可能已移动，或不是文本）'
    }
    rec.artifacts.unshift(artifact)
    if (rec.artifacts.length > MAX_ARTIFACTS) rec.artifacts.length = MAX_ARTIFACTS
  }

  function registerArtifactFromCall(rec, call) {
    let args = null
    try {
      args = call && call.args ? JSON.parse(String(call.args)) : null
    } catch {
      args = null
    }
    if (!args || typeof args !== 'object') return
    const paths = []
    for (const key of ['file_path', 'path', 'file', 'target']) {
      if (typeof args[key] === 'string' && args[key]) paths.push(args[key])
    }
    if (Array.isArray(args.files)) {
      for (const item of args.files) {
        if (typeof item === 'string') paths.push(item)
        else if (item && typeof item.path === 'string') paths.push(item.path)
      }
    }
    for (const path of [...new Set(paths)].slice(0, 4)) addArtifactFromPath(rec, path, call.name)
  }

  function localArtifactBodies() {
    const out = {}
    for (const rec of localSessions.values()) {
      if (!rec.artifacts.length) continue
      const bucket = {}
      for (const art of rec.artifacts) if (typeof art.text === 'string') bucket[art.id] = art.text
      if (Object.keys(bucket).length) out[rec.id] = bucket
    }
    return out
  }

  function findArtifact(memberId, sessionId, artifactId) {
    if (memberId === state.self.id) {
      const rec = localSessions.get(String(sessionId))
      const art = rec && rec.artifacts.find((item) => item.id === artifactId)
      return art ? { ...art } : null
    }
    const member = relayMembers.get(memberId)
    if (!member) return null
    const session = (member.sessions || []).find((item) => item.id === sessionId)
    const meta = session && (session.artifacts || []).find((item) => item.id === artifactId)
    if (!meta) return null
    const bodies = (member.artifactBodies && member.artifactBodies[sessionId]) || {}
    return { ...meta, text: Object.prototype.hasOwnProperty.call(bodies, artifactId) ? bodies[artifactId] : null }
  }

  function ensureLocal(session) {
    const id = String(session.id)
    let rec = localSessions.get(id)
    if (!rec) {
      rec = {
        id,
        label: labelOf(session),
        cwd: session && session.header && typeof session.header.cwd === 'string' ? session.header.cwd : null,
        preset: presetOfSession.get(id) || livePresetOf(id) || presetOf(session),
        status: 'idle',
        tool: null,
        note: null,
        turn: 0,
        tokensIn: 0,
        tokensOut: 0,
        timeline: [],
        artifacts: [],
        callArgs: new Map(),
        at: now(),
      }
      localSessions.set(id, rec)
    }
    return rec
  }

  function localSessionViews() {
    return [...localSessions.values()]
      .filter((rec) => now() - rec.at < IDLE_HIDE_MS)
      // 只有协作模式的会话才进客厅；标准/创造模式的会话只留在本地
      .filter((rec) => state.shareAllSessions || String(rec.preset || '').toLowerCase() === 'collab')
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
        timeline: rec.timeline
          .filter((entry) => state.shareTranscript || entry.kind !== 'say')
          .slice(-TIMELINE_WIRE),
        artifacts: rec.artifacts.slice(0, ARTIFACTS_WIRE).map(({ text, ...meta }) => meta),
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
    const allLan = lanIPv4()
    const lan = reachableHosts ? allLan.filter((ip) => reachableHosts.has(ip)) : allLan
    const local = `${origin}${BASE}/relay`
    const lanRelay = lan.length ? `http://${lan[0]}:${port}${BASE}/relay` : local
    return {
      origin,
      port,
      lan,
      allLan,
      local,
      lanRelay,
      reachable: lan.length > 0,
      loopbackOnly: reachableHosts !== null && lan.length === 0,
    }
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
    const publicRelay = state.publicBaseUrl ? `${state.publicBaseUrl}${BASE}/relay` : null
    const publicUrl = publicRelay ? buildUrl(publicRelay) : null
    const primary = publicUrl || tunnelUrl || (addrs.reachable ? lanUrl : localUrl)
    const channel = publicUrl ? 'public' : tunnelUrl ? 'tunnel' : addrs.reachable ? 'lan' : 'loopback'
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
      publicRelay,
      publicBaseUrl: state.publicBaseUrl || null,
      lan: addrs.lan,
      allLan: addrs.allLan,
      reachable: addrs.reachable,
      loopbackOnly: addrs.loopbackOnly,
      joinPage: `${(publicRelay || tunnelRelay || addrs.local).replace(/\/relay$/, '')}/join?c=${encodeURIComponent(code)}`,
      qr: qrCache.value,
      plain: `relay=${publicRelay || tunnelRelay || (addrs.reachable ? addrs.lanRelay : addrs.local)}\ncode=${code}`,
    }
  }

  function snapshot() {
    const settingsView = {
      publicBaseUrl: state.publicBaseUrl || '',
      homeRelay: state.homeRelay || '',
      shareTranscript: !!state.shareTranscript,
      shareAllSessions: !!state.shareAllSessions,
      settingsFile: settingsFile(),
      selfName: state.self.name,
    }
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
        settings: settingsView,
        tunnel: tunnelView(),
        lab: { running: lab.running, members: lab.members.map((m) => m.name) },
        updatedAt: now(),
      }
    }
    if (state.mode === 'guest' && state.remoteSnap) {
      const remoteCode = state.remoteSnap.code || (state.room && state.room.code) || ''
      const relayAddr = state.relayUrl || ''
      let guestInvite = null
      try {
        const lane = new URL(relayAddr)
        const landing = `${lane.origin}${BASE}/join?c=${encodeURIComponent(remoteCode)}`
        const qrKey2 = `guest|${landing}`
        if (qrCache.key !== qrKey2) {
          let qr = null
          try {
            const result = qrSvgPath(landing, { ecl: 'M', quiet: 2 })
            qr = { path: result.path, dimension: result.dimension, version: result.version, ecl: result.ecl }
          } catch {
            qr = null
          }
          qrCache = { key: qrKey2, value: qr }
        }
        guestInvite = {
          code: remoteCode,
          primaryUrl: landing,
          channel: 'relay',
          localRelay: relayAddr,
          lanRelay: relayAddr,
          publicRelay: relayAddr,
          reachable: true,
          plain: `relay=${relayAddr}\ncode=${remoteCode}`,
          qr: qrCache.value,
        }
      } catch {
        guestInvite = null
      }
      return {
        ...state.remoteSnap,
        mode: 'guest',
        invite: guestInvite,
        relay: state.relayUrl,
        self: { id: state.self.id, name: state.self.name },
        localSessions: localSessionViews(),
        settings: settingsView,
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
      settings: settingsView,
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

  // 会话里切换 Agent 模式（例如从标准切到协作模式）时，会发这个事件
  ctx.on('agent-preset/selected', (sessionId, agentPreset) => {
    if (sessionId === undefined || sessionId === null) return
    const key = String(sessionId)
    if (agentPreset) presetOfSession.set(key, String(agentPreset))
    const rec = localSessions.get(key)
    if (rec && agentPreset) rec.preset = String(agentPreset)
    bump()
  })

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
      case 'tool/call': {
        rec.status = 'running'
        const name = typeof data.name === 'string' ? data.name : 'tool'
        rec.tool = name
        pushTimeline(rec, { kind: 'tool', tool: name, text: summarizeToolArgs(name, data.arguments) })
        if (data.callId) rec.callArgs.set(String(data.callId), { name, args: data.arguments })
        break
      }
      case 'tool/result': {
        const callId = data.message && data.message.source ? String(data.message.source.callId || '') : ''
        const call = callId ? rec.callArgs.get(callId) : undefined
        if (callId) rec.callArgs.delete(callId)
        if (call && (call.name === 'present' || call.name === 'write' || call.name === 'edit')) {
          registerArtifactFromCall(rec, call)
        }
        if (data.error) rec.tool = `${rec.tool || 'tool'} ✗`
        break
      }
      case 'assistant/message': {
        if (data.usage) {
          rec.tokensIn += Number(data.usage.inputTokens) || 0
          rec.tokensOut += Number(data.usage.outputTokens) || 0
        }
        const said = textOfBlocks(data.message && data.message.content).trim()
        if (said) pushTimeline(rec, { kind: 'say', text: said.slice(0, 280) })
        break
      }
      case 'user/message': {
        const text = textOfBlocks(data.content).trim()
        if (text) {
          rec.note = text.slice(0, 160)
          pushTimeline(rec, { kind: 'ask', text: text.slice(0, 200) })
        }
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
    const deviceId = String(body.deviceId || '').slice(0, 64)
    let member = deviceId ? [...relayMembers.values()].find((item) => item.deviceId === deviceId) : undefined
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
      relayMembers.set(member.id, member)
    } else {
      if (body.name) member.name = String(body.name).slice(0, 40)
      member.online = true
      member.updatedAt = now()
    }
    const token = randomBytes(16).toString('hex')
    relayTokens.set(token, member.id)
    bump()
    return {
      status: 200,
      value: {
        token,
        self: { id: member.id, name: member.name },
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
    }))

    // 产物正文单独存（不进快照，按需取）
    const bodies = body.artifactBodies && typeof body.artifactBodies === 'object' ? body.artifactBodies : null
    if (bodies) {
      member.artifactBodies = member.artifactBodies || {}
      for (const [sessionId, map] of Object.entries(bodies)) {
        if (!map || typeof map !== 'object') continue
        const bucket = member.artifactBodies[String(sessionId)] || {}
        for (const [artifactId, text] of Object.entries(map)) {
          if (typeof text === 'string') bucket[String(artifactId)] = text.slice(0, MAX_ARTIFACT_BYTES)
        }
        member.artifactBodies[String(sessionId)] = bucket
      }
    }
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

  // 中继重启 / 掉线后：token 失效或网络断开时自动重新加入同一个房间。
  let rejoinAt = 0
  let rejoining = false
  async function tryRejoin() {
    if (state.mode !== 'guest' || !state.relayUrl || !state.room) return
    if (rejoining || now() - rejoinAt < 5000) return
    rejoinAt = now()
    rejoining = true
    try {
      const response = await fetch(`${originOf()}${BASE}/api/join` , {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ relay: state.relayUrl, code: state.room.code, name: state.self.name }),
      })
      if (!response.ok) return
      const payload = await response.json().catch(() => null)
      if (payload && payload.mode === 'guest') {
        console.log('[dsh-collab] 已重新加入协作室', state.room.code)
        bump()
      }
    } catch {
      /* 下一轮再试 */
    } finally {
      rejoining = false
    }
  }

  async function guestReport() {
    if (state.mode !== 'guest' || !state.relayUrl || !state.token) return
    const base = state.relayUrl.replace(/\/+$/, '')
    try {
      const response = await fetch(`${base}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: state.token,
          name: state.self.name,
          sessions: localSessionViews(),
          artifactBodies: localArtifactBodies(),
        }),
      })
      if (!response.ok) {
        if (response.status === 403 || response.status === 404) void tryRejoin()
        return
      }
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
      const stateUrl = new URL(req.url || '/', 'http://localhost')
      const requestedSession = stateUrl.searchParams.get('session') || ''
      if (requestedSession) {
        const rec = localSessions.get(requestedSession)
        const boundLabel = bindings.get(requestedSession) ? bindings.get(requestedSession).label : ''
        const knownPreset =
          livePresetOf(requestedSession) ||
          (rec && rec.preset) ||
          presetOfSession.get(requestedSession) ||
          ''
        const isCollab = String(knownPreset || '').toLowerCase() === 'collab'
        const binding = bindings.get(requestedSession)
        let invite = null
        if (binding && binding.code) {
          const relayBase = binding.relay
          const origin = relayBase.indexOf(BASE + '/relay') >= 0 ? relayBase.split(BASE + '/relay')[0] : relayBase
          const landing = origin + BASE + '/join?c=' + encodeURIComponent(binding.code)
          let qr = null
          try {
            const result = qrSvgPath(landing, { ecl: 'M', quiet: 2 })
            qr = { path: result.path, dimension: result.dimension, version: result.version }
          } catch {
            qr = null
          }
          invite = { code: binding.code, primaryUrl: landing, relay: binding.relay, qr }
        }
        sendJson(res, 200, {
          mode: 'session',
          sessionId: requestedSession,
          isCollabSession: isCollab,
          session: rec ? sessionViewOf(requestedSession) : null,
          binding: binding ? { code: binding.code, relay: binding.relay, lastAt: binding.lastAt } : null,
          snap: binding ? binding.snap : null,
          invite,
          self: { id: state.self.id, name: state.self.name },
          settings: { homeRelay: state.homeRelay || '', shareTranscript: !!state.shareTranscript },
        })
        return
      }
      sendJson(res, 200, snapshot())
      return
    }
    if (sub === '/api/artifact' && req.method === 'GET') {
      const url = new URL(req.url || '/', 'http://localhost')
      const memberId = url.searchParams.get('member') || ''
      const sessionId = url.searchParams.get('session') || ''
      const artifactId = url.searchParams.get('aid') || ''
      if (!memberId || !sessionId || !artifactId) {
        sendJson(res, 400, { error: 'member / session / aid 都要给' })
        return
      }
      if (state.mode === 'guest' && state.relayUrl && state.token && memberId !== state.self.id) {
        try {
          const upstream = `${state.relayUrl.replace(/\/+$/, '')}/artifact?token=${encodeURIComponent(state.token)}&member=${encodeURIComponent(memberId)}&session=${encodeURIComponent(sessionId)}&aid=${encodeURIComponent(artifactId)}`
          const response = await fetch(upstream)
          const payload = await response.json().catch(() => null)
          if (!response.ok || !payload) {
            sendJson(res, response.status || 502, { error: (payload && payload.error) || '取不到对方的产物' })
            return
          }
          sendJson(res, 200, payload)
        } catch (error) {
          sendJson(res, 502, { error: String(error && error.message ? error.message : error) })
        }
        return
      }
      const artifact = findArtifact(memberId, sessionId, artifactId)
      if (!artifact) {
        sendJson(res, 404, { error: '没有这个产物' })
        return
      }
      sendJson(res, 200, {
        title: artifact.title,
        path: artifact.path,
        bytes: artifact.bytes,
        truncated: !!artifact.truncated,
        note: artifact.note || null,
        text: typeof artifact.text === 'string' ? artifact.text : null,
      })
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
      const relay = String(body.relay || state.homeRelay || '').trim().replace(/\/+$/, '')
      const code = String(body.code || '').trim().toUpperCase()
      if (!code) {
        sendJson(res, 400, { error: '还需要房间号（6 位）' })
        return
      }
      if (!relay) {
        sendJson(res, 400, { error: '还没有默认中继：先在上面填一次中继地址（全团队一样，填完以后只要房间号）' })
        return
      }
      if (body.name) state.self.name = String(body.name).slice(0, 40)
      try {
        const response = await fetch(`${relay}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code,
            name: state.self.name,
            machine: hostname(),
            deviceId: state.self.installId,
            create: body.create !== false,
          }),
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
        saveSettings({ relay, code })
        state.remoteSnap = null
        startGuestLoop()
        void guestReport()
        sendJson(res, 200, snapshot())
      } catch (error) {
        const cause = error && error.cause ? error.cause.code || error.cause.message || '' : ''
        const detail = error && error.message ? error.message : String(error)
        sendJson(res, 502, {
          error: `连不上 ${relay}${cause ? '（' + cause + '）' : ''}：${detail}。请确认这个地址在浏览器里能打开 /dsh-collab/relay/health`,
        })
      }
      return
    }
    if (sub === '/api/leave') {
      stopGuestLoop()
      labStop()
      saveSettings({ relay: '', code: '' })
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
    if (sub === '/api/rooms') {
      const relay = String(body.relay || state.homeRelay || '').trim()
      if (!relay) {
        sendJson(res, 400, { error: '还没有中继地址' })
        return
      }
      try {
        const listed = await relayGet(relay, '/rooms')
        sendJson(res, listed.ok ? 200 : 502, listed.ok ? { relay, rooms: (listed.payload && listed.payload.rooms) || [] } : { error: '中继没有回应' })
      } catch (error) {
        sendJson(res, 502, { error: String(error && error.message ? error.message : error) })
      }
      return
    }
    if (sub === '/api/session/room') {
      const sessionId = String(body.sessionId || '')
      if (!sessionId) {
        sendJson(res, 400, { error: '缺少 sessionId' })
        return
      }
      const result = await createRoomForSession(sessionId)
      sendJson(res, result.error ? 502 : 200, result)
      return
    }
    if (sub === '/api/session/join') {
      const sessionId = String(body.sessionId || '')
      if (!sessionId) {
        sendJson(res, 400, { error: '缺少 sessionId' })
        return
      }
      const result = await joinRoomForSession(sessionId, body.code, body.relay)
      sendJson(res, result.error ? 502 : 200, result)
      return
    }
    if (sub === '/api/session/leave') {
      dropBinding(String(body.sessionId || ''))
      sendJson(res, 200, { ok: true })
      return
    }
    if (sub === '/api/settings') {
      const patch = {}
      if (typeof body.publicBaseUrl === 'string') {
        const value = body.publicBaseUrl.trim().replace(/\/+$/, '')
        if (value && !/^https?:\/\//i.test(value)) {
          sendJson(res, 400, { error: '固定地址要以 http:// 或 https:// 开头' })
          return
        }
        patch.publicBaseUrl = value
        state.publicBaseUrl = value
      }
      if (typeof body.homeRelay === 'string') {
        const value = body.homeRelay.trim().replace(/\/+$/, '')
        if (value && !/^https?:\/\//i.test(value)) {
          sendJson(res, 400, { error: '默认中继要以 http:// 或 https:// 开头' })
          return
        }
        patch.homeRelay = value
        state.homeRelay = value
      }
      if (typeof body.shareTranscript === 'boolean') {
        patch.shareTranscript = body.shareTranscript
        state.shareTranscript = body.shareTranscript
      }
      if (typeof body.shareAllSessions === 'boolean') {
        patch.shareAllSessions = body.shareAllSessions
        state.shareAllSessions = body.shareAllSessions
      }
      if (typeof body.name === 'string' && body.name.trim()) {
        patch.name = body.name.trim().slice(0, 40)
        state.self.name = patch.name
      }
      saveSettings(patch)
      qrCache = { key: '', value: null }
      bump()
      sendJson(res, 200, { ok: true, settings: { publicBaseUrl: state.publicBaseUrl }, snapshot: snapshot() })
      return
    }
    if (sub === '/api/public-url/check') {
      const target = String(body.publicBaseUrl || state.publicBaseUrl || '').trim().replace(/\/+$/, '')
      if (!target) {
        sendJson(res, 400, { error: '先填一个固定地址' })
        return
      }
      try {
        const response = await fetch(`${target}${BASE}/relay/health`, { signal: AbortSignal.timeout(8000) })
        const payload = await response.json().catch(() => null)
        sendJson(res, response.ok ? 200 : 502, {
          ok: response.ok,
          status: response.status,
          room: payload && payload.room,
          host: payload && payload.host,
          error: response.ok ? undefined : `健康检查返回 ${response.status}`,
        })
      } catch (error) {
        sendJson(res, 502, { ok: false, error: String(error && error.message ? error.message : error) })
      }
      return
    }
    if (sub === '/api/discover') {
      const code = String(body.code || '').trim().toUpperCase()
      const relay = String(body.relay || state.homeRelay || '').trim().replace(/\/+$/, '')
      if (!code) {
        sendJson(res, 400, { error: '输入房间号，例如 3LMMJQ' })
        return
      }
      if (!relay) {
        sendJson(res, 400, { error: '先配一次默认中继地址' })
        return
      }
      try {
        const response = await fetch(`${relay}/room?code=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(8000) })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload) {
          sendJson(res, response.status === 404 ? 404 : 502, {
            error: response.status === 404 ? `没找到房间 ${code}` : '中继没有回应',
          })
          return
        }
        sendJson(res, 200, { found: true, relay, room: payload })
      } catch (error) {
        sendJson(res, 502, {
          error: `连不上中继 ${relay}：${error && error.message ? error.message : String(error)}`,
        })
      }
      return
    }
    if (sub === '/api/share') {
      const target = String(body.path || '').trim()
      if (!target) {
        sendJson(res, 400, { error: '需要文件路径' })
        return
      }
      const rec = [...localSessions.values()].sort((a, b) => b.at - a.at)[0]
      if (!rec) {
        sendJson(res, 409, { error: '还没有会话：先在协作模式里跑一次，或直接填一个文件路径' })
        return
      }
      addArtifactFromPath(rec, target, 'share', true)
      const shared = rec.artifacts.find((item) => item.path === target)
      bump()
      sendJson(res, 200, {
        ok: true,
        artifact: shared ? { id: shared.id, path: shared.path, title: shared.title, bytes: shared.bytes, note: shared.note || null } : null,
      })
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
    if (sub === '/relay/artifact' && req.method === 'GET') {
      const url = new URL(req.url || '/', 'http://localhost')
      const member = relayMemberFor(url.searchParams.get('token') || '')
      if (!member) {
        sendJson(res, 403, { error: 'unknown member' })
        return
      }
      const artifact = findArtifact(
        url.searchParams.get('member') || '',
        url.searchParams.get('session') || '',
        url.searchParams.get('aid') || '',
      )
      if (!artifact) {
        sendJson(res, 404, { error: 'no artifact' })
        return
      }
      sendJson(res, 200, {
        title: artifact.title,
        path: artifact.path,
        bytes: artifact.bytes,
        truncated: !!artifact.truncated,
        note: artifact.note || null,
        text: typeof artifact.text === 'string' ? artifact.text : null,
      })
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
    if (bindingTimer) clearInterval(bindingTimer)
    bindingTimer = null
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
