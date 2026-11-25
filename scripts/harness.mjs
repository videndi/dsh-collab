/**
 * scripts/harness.mjs — 不依赖 DSH 进程的协作插件实验台。
 *
 * 为什么需要它：Host 半的代码只能在 Host 进程里跑，而改完代码要看到效果得重启
 * DSH。这个实验台用一条假的 Cordis 上下文把 `apply(ctx)` 直接跑起来，挂在真实
 * node:http 服务上，于是可以在本机（回环）复现完整链路：
 *
 *   · 起一个「房主」实例 —— 它有 /dsh-collab/relay/*，就是一个真实的房间；
 *   · 起一个「成员」实例 —— 它真的走 HTTP 去房主那里 join / 上报 / 拉快照；
 *   · 用 fireSessionEvent() 喂真实形状的会话事件，验证进度桥会折出会话卡。
 *
 * 全程 127.0.0.1，不出网。
 */
import http from 'node:http'
import { apply } from '../index.js'

export async function createCollabHost(options = {}) {
  const routes = []
  const listeners = []
  const disposers = []
  const effects = []
  let origin = ''

  const ctx = {
    webServer: {
      getOrigin: () => origin,
      register: (route) => {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
      registerUpgrade: () => () => {},
    },
    on: (name, fn) => {
      const entry = { name, fn }
      listeners.push(entry)
      return () => {
        const index = listeners.indexOf(entry)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') effects.push(dispose)
      return () => {}
    },
    get: () => undefined,
    inject: () => {},
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    for (const route of routes) {
      const matched =
        route.kind === 'prefix'
          ? url.pathname === route.path || url.pathname.startsWith(route.path + '/')
          : url.pathname === route.path
      if (!matched) continue
      try {
        await route.handler(req, res)
      } catch (error) {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(String(error && error.message ? error.message : error))
      }
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('no route in harness: ' + url.pathname)
  })

  apply(ctx)

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', resolve)
  })
  const address = server.address()
  origin = `http://127.0.0.1:${address.port}`

  return {
    origin,
    port: address.port,
    /** 当前注册的路由数，用来断言插件卸载后没有残留。 */
    routeCount: () => routes.length,
    /** 喂一条真实形状的会话事件，驱动进度桥。 */
    fireSessionEvent(session, event) {
      for (const entry of listeners) {
        if (entry.name === 'session/event') entry.fn(session, event)
      }
    },
    async close() {
      for (const dispose of [...effects, ...disposers]) {
        try {
          dispose()
        } catch {
          /* ignore */
        }
      }
      effects.length = 0
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

export function makeSession(id, cwd, preset = 'collab') {
  return { id, header: { cwd, agentPreset: preset } }
}
