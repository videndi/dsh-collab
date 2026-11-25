/**
 * scripts/qr-decode.mjs — 二维码**反向读取**器，只用于自检。
 *
 * 与 qr.js 的编码器是两条独立路径：这里重新绘制功能模块图、重新读格式位、
 * 重新做逆 zigzag 与反交织，并对每块做 RS 余数校验。能读回原文 = 编码器
 * 的格式位、数据放置顺序、分块交织、纠错码都自洽（扫码器做的就是这些）。
 */
import { QR_TABLES } from '../qr.js'

const { ECC_CW_PER_BLOCK, ECC_BLOCKS, ECC_NAMES, ECC_FORMAT_BITS } = QR_TABLES

function rawModules(ver) {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}

function alignPositions(ver) {
  if (ver === 1) return []
  const numAlign = Math.floor(ver / 7) + 2
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2
  const size = ver * 4 + 17
  const out = [6]
  for (let pos = size - 7; out.length < numAlign; pos -= step) out.splice(1, 0, pos)
  return out
}

export function functionMap(ver) {
  const size = ver * 4 + 17
  const map = Array.from({ length: size }, () => new Uint8Array(size))
  const mark = (x, y) => {
    if (x >= 0 && x < size && y >= 0 && y < size) map[y][x] = 1
  }
  for (let i = 0; i < size; i++) {
    mark(6, i)
    mark(i, 6)
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy)
  }
  const align = alignPositions(ver)
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(align[i] + dx, align[j] + dy)
    }
  }
  for (let i = 0; i <= 8; i++) {
    mark(8, i)
    mark(i, 8)
  }
  for (let i = 0; i < 8; i++) {
    mark(size - 1 - i, 8)
    mark(8, size - 1 - i)
  }
  mark(8, size - 8)
  if (ver >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      mark(a, b)
      mark(b, a)
    }
  }
  return { map, size }
}

function maskBit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0
    case 1: return y % 2 === 0
    case 2: return x % 3 === 0
    case 3: return (x + y) % 3 === 0
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
    default: return false
  }
}

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
}
const gfMul = (a, b) => (a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0)

function rsRemainderAll(dataWithEcc, eccLen) {
  const divisor = new Uint8Array(eccLen)
  divisor[eccLen - 1] = 1
  let root = 1
  for (let i = 0; i < eccLen; i++) {
    for (let j = 0; j < divisor.length; j++) {
      divisor[j] = gfMul(divisor[j], root)
      if (j + 1 < divisor.length) divisor[j] ^= divisor[j + 1]
    }
    root = gfMul(root, 2)
  }
  const rem = new Uint8Array(eccLen)
  for (const byte of dataWithEcc) {
    const factor = byte ^ rem[0]
    rem.copyWithin(0, 1)
    rem[rem.length - 1] = 0
    for (let i = 0; i < divisor.length; i++) rem[i] ^= gfMul(divisor[i], factor)
  }
  return rem
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/** @param {{size:number, modules:Uint8Array[], version:number}} matrix */
export function decodeMatrix(matrix) {
  const { size, modules, version: ver } = matrix
  assert(size === ver * 4 + 17, '矩阵尺寸与版本不符')

  let bits = 0
  const read = (x, y) => (modules[y][x] ? 1 : 0)
  for (let i = 0; i <= 5; i++) bits |= read(8, i) << i
  bits |= read(8, 7) << 6
  bits |= read(8, 8) << 7
  bits |= read(7, 8) << 8
  for (let i = 9; i < 15; i++) bits |= read(14 - i, 8) << i

  const raw = bits ^ 0x5412
  const data5 = raw >>> 10
  assert(data5 >>> 5 === 0, '格式信息高 5 位不合法')
  let bchRem = data5
  for (let i = 0; i < 10; i++) bchRem = (bchRem << 1) ^ ((bchRem >>> 9) * 0x537)
  const expected = (((data5 << 10) | bchRem) ^ 0x5412) & 0x7fff
  assert(expected === bits, '格式信息 BCH 校验失败')
  const eclBits = data5 >>> 3
  const mask = data5 & 7
  const ecl = ECC_FORMAT_BITS.indexOf(eclBits)
  assert(ecl >= 0, '未知纠错级')

  const { map } = functionMap(ver)
  const plain = modules.map((row) => Uint8Array.from(row))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!map[y][x] && maskBit(mask, x, y)) plain[y][x] ^= 1
    }
  }

  const total = Math.floor(rawModules(ver) / 8)
  const bytes = new Uint8Array(total)
  let index = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!map[y][x] && index < total * 8) {
          if (plain[y][x]) bytes[index >>> 3] |= 1 << (7 - (index & 7))
          index++
        }
      }
    }
  }
  assert(index === total * 8, '码字读取长度不足')

  const numBlocks = ECC_BLOCKS[ecl][ver]
  const eccLen = ECC_CW_PER_BLOCK[ecl][ver]
  const rawCodewords = total
  const numShort = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)
  const blocks = []
  for (let i = 0; i < numBlocks; i++) {
    const dataLen = shortBlockLen - eccLen + (i < numShort ? 0 : 1)
    blocks.push({ data: new Uint8Array(dataLen), ecc: new Uint8Array(eccLen) })
  }
  let cursor = 0
  for (let i = 0; i < shortBlockLen + 1; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i !== shortBlockLen - eccLen || j >= numShort) {
        if (i < blocks[j].data.length) blocks[j].data[i] = bytes[cursor++]
      }
    }
  }
  for (let i = 0; i < eccLen; i++) {
    for (let j = 0; j < numBlocks; j++) blocks[j].ecc[i] = bytes[cursor++]
  }
  assert(cursor === rawCodewords, '反交织读取不完整')

  blocks.forEach((block, i) => {
    const combined = new Uint8Array(block.data.length + block.ecc.length)
    combined.set(block.data, 0)
    combined.set(block.ecc, block.data.length)
    const rem = rsRemainderAll(combined, eccLen)
    assert(rem.every((v) => v === 0), `第 ${i} 块 RS 校验失败`)
  })

  const stream = []
  blocks.forEach((b) => b.data.forEach((v) => stream.push(v)))
  let pos = 0
  const readBits = (count) => {
    let value = 0
    for (let i = 0; i < count; i++) {
      const byteIndex = Math.floor(pos / 8)
      const bit = (stream[byteIndex] >> (7 - (pos % 8))) & 1
      value = (value << 1) | bit
      pos++
    }
    return value
  }
  const mode = readBits(4)
  assert(mode === 0b0100, `模式不是 byte（读到 ${mode.toString(2)}）`)
  const length = readBits(ver <= 9 ? 8 : 16)
  const out = []
  for (let i = 0; i < length; i++) out.push(readBits(8))
  return {
    text: new TextDecoder().decode(Uint8Array.from(out)),
    version: ver,
    ecl: ECC_NAMES[ecl],
    mask,
  }
}

/** 从 qr.js 产出的 SVG path 还原不出矩阵，所以自检统一用 encodeMatrix 的矩阵。 */
export function assertRoundTrip(encodeMatrix, text, ecl = 'M') {
  const matrix = encodeMatrix(text, ecl)
  const decoded = decodeMatrix(matrix)
  assert(decoded.text === text, `往返内容不一致：${JSON.stringify(decoded.text.slice(0, 40))}`)
  return { matrix, decoded }
}
