/**
 * scripts/tunnel-host.mjs — 给独立中继挂一条公网隧道（cloudflared quick tunnel）。
 *
 *   node scripts/tunnel-host.mjs [--port 8790] [--bin <cloudflared 路径>]
 *
 * 为什么单独一个脚本：Windows 上想让进程真正脱离当前 shell（不被连带杀掉），
 * 最稳的是用 WMI / 计划任务启动一个 node 进程，再由 node 去 spawn cloudflared，
 * 输出重定向到 tunnel.log，方便取回公网地址。
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const port = Number(argOf('port', 8790))
const root = 'D:/dsh/collab-plugin'
const logPath = argOf('log', join(root, 'tunnel.log'))
const candidates = [
  argOf('bin', ''),
  'D:/dsh/home/profiles/desktop/node_modules/cloudflared/bin/cloudflared.exe',
  join(process.env.DSH_HOME || '', 'node_modules/cloudflared/bin/cloudflared.exe'),
  'cloudflared',
].filter(Boolean)

const bin = candidates.find((candidate) => candidate === 'cloudflared' || existsSync(candidate)) || 'cloudflared'
const out = createWriteStream(logPath, { flags: 'w' })

function write(line) {
  out.write(`${new Date().toISOString()} ${line}\n`)
}

write(`starting cloudflared (${bin}) -> http://127.0.0.1:${port}`)

const child = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

let url = ''
const scan = (chunk) => {
  const text = String(chunk)
  out.write(text)
  if (!url) {
    const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(text)
    if (match) {
      url = match[0]
      write(`PUBLIC_URL ${url}`)
      console.log(`PUBLIC_URL ${url}`)
    }
  }
}
child.stdout.on('data', scan)
child.stderr.on('data', scan)
child.on('error', (error) => {
  write(`spawn error: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code) => {
  write(`cloudflared exited (${code})`)
})
