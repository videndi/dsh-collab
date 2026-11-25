import * as fs from 'node:fs'

const file = 'scripts/relay-server.mjs'
let s = fs.readFileSync(file, 'utf8')

const need = (t) => {
  if (!s.includes(t)) {
    console.error('ANCHOR MISSING:', JSON.stringify(t.slice(0, 70)))
    process.exit(1)
  }
}

// 1) 离线成员超时清理（否则"4 人"里有旧 token 的残留）
need(`function roomOf(req, res) {`)
s = s.replace(
  `function roomOf(req, res) {`,
  () =>
    `/** 长时间没上报的成员直接移除，房间人数才是真实在线人数。 */
const MEMBER_TTL_MS = 10 * 60_000
function pruneMembers(room) {
  if (!room || !room.members) return 0
  let removed = 0
  for (const [id, member] of room.members) {
    if (now() - (member.updatedAt || 0) > MEMBER_TTL_MS) {
      room.members.delete(id)
      for (const [token, owner] of room.tokens) if (owner === id) room.tokens.delete(token)
      removed += 1
    }
  }
  if (removed) room.updatedAt = now()
  return removed
}

function roomOf(req, res) {`,
)

// 2) board / snapshot / rooms 之前先清理
need(`      const found = findByCode(code)`)
s = s.replace(
  `      const found = findByCode(code)`,
  () => `      const found = findByCode(code)
      if (found) pruneMembers(found.room)`,
)

writeFileSync(file, s)
console.log('relay: prune offline members')
