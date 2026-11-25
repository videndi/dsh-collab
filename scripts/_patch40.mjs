import * as fs from 'node:fs'

const file = 'scripts/relay-server.mjs'
let s = fs.readFileSync(file, 'utf8')

const need = (t) => {
  if (!s.includes(t)) {
    console.error('ANCHOR MISSING:', JSON.stringify(t.slice(0, 70)))
    process.exit(1)
  }
}

// 1) 定义 pruneMembers（放在 MEMBER_STALE_MS 之后）
need(`const MEMBER_STALE_MS = 15000`)
s = s.replace(
  `const MEMBER_STALE_MS = 15000`,
  () =>
    `const MEMBER_STALE_MS = 15000
// 超过这个时间没有任何上报的成员，直接从房间里删掉（否则旧 token / 掉线残留会让"几人"虚高）
const MEMBER_TTL_MS = 10 * 60_000

function pruneMembers(room) {
  if (!room || !room.members) return 0
  let removed = 0
  for (const [id, member] of room.members) {
    if (now() - (member.updatedAt || 0) > MEMBER_TTL_MS) {
      room.members.delete(id)
      for (const [token, owner] of room.tokens) {
        if (owner === id) room.tokens.delete(token)
      }
      removed += 1
    }
  }
  return removed
}`,
)

// 2) board 里先清理，再返回
need(`    const room = rooms.get(code)
    if (!room) {
      json(res, 404, { error: 'room not found' })
      return
    }`)
s = s.replace(
  `    const room = rooms.get(code)
    if (!room) {
      json(res, 404, { error: 'room not found' })
      return
    }`,
  () => `    const room = rooms.get(code)
    if (!room) {
      json(res, 404, { error: 'room not found' })
      return
    }
    pruneMembers(room)`,
)

writeFileSync(file, s)
console.log('relay prune wired')
