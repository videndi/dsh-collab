/**
 * scripts/watchdog.mjs — 中继与公网隧道的看护进程（node 版，可日志，跨平台）。
 *
 *   node scripts/watchdog.mjs
 *
 * 每 60 秒：探测本机 relay 的 /relay/health；不通就拉起 relay-server。
 * 同时确认 cloudflared 进程在，不在就拉起 tunnel-host。
 * 拉起时用 detached + unref，父进程退出也不影响子进程。
 */
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const ROOT = 'D:/dsh/collab-plugin'
const LOG = `${ROOT}/watchdog.log`
const nodeExe = process.execPath
const relayHealth = 'http://127.0.0.1:8790/dsh-collab/relay/health'

function write(line) {
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* ignore */
  }
}

function launch(script, args) {
  const child = spawn(nodeExe, [`${ROOT}/scripts/${script}`, ...args], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  return child.pid
}

async function relayUp() {
  try {
    const response = await fetch(relayHealth, { signal: AbortSignal.timeout(3000) })
    return response.ok
  } catch {
    return false
  }
}

function hasCloudflared() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq cloudflared.exe'], { encoding: 'utf8' })
    return out.includes('cloudflared.exe')
  } catch {
    return false
  }
}

let lastRelayState = null
let lastTunnelState = null

async function tick() {
  const up = await relayUp()
  if (up !== lastRelayState) {
    write(`relay ${up ? 'up' : 'down'}`)
    lastRelayState = up
  }
  if (!up) {
    const pid = launch('relay-server.mjs', ['--port', '8790', '--host', '0.0.0.0', '--rooms', '32'])
    write(`relay restarted pid=${pid}`)
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  const cf = hasCloudflared()
  if (cf !== lastTunnelState) {
    write(`cloudflared ${cf ? 'present' : 'missing'}`)
    lastTunnelState = cf
  }
  if (!cf) {
    const pid = launch('tunnel-host.mjs', ['--port', '8790'])
    write(`tunnel restarted pid=${pid}`)
  }
}

write(`watchdog started (node=${nodeExe})`)
await tick()
setInterval(() => void tick(), 60_000)
