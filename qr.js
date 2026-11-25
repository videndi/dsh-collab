/**
 * qr.js — 离线二维码编码器（byte 模式，版本 1–40 自适应，纠错级 L/M/Q/H）。
 *
 * 为什么要自己写：协作室要把「邀请链接」变成二维码，但不引入 npm 依赖、
 * 不调用任何外部服务（Google Chart 之类），全程本机计算。
 *
 * 实现口径按 ISO/IEC 18004：模式指示符 0100、字符计数、终止符、0xEC/0x11 填充、
 * RS 纠错分块交织、8 种掩码择优选罚分。纠错块表是公开标准表。
 *
 * 输出直接是 SVG path 的 `d` 属性，调用方拼成 <svg>。
 */

const ECC_CW_PER_BLOCK = [
  // L
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // M
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  // Q
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // H
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
]

const ECC_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
]

/** L=0, M=1, Q=2, H=3；格式信息里的两位分别是 01 / 00 / 11 / 10。 */
const ECC_FORMAT_BITS = [1, 0, 3, 2]
const ECC_NAMES = ['L', 'M', 'Q', 'H']

// ── GF(256) ────────────────────────────────────────────────────────────────

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
GF_LOG[0] = 0

function gfMul(a, b) {
  if (!a || !b) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

function rsDivisor(degree) {
  const result = new Uint8Array(degree)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 2)
  }
  return result
}

function rsRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length)
  for (const byte of data) {
    const factor = byte ^ result[0]
    result.copyWithin(0, 1)
    result[result.length - 1] = 0
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor)
  }
  return result
}

// ── 版本容量 ───────────────────────────────────────────────────────────────

function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}

function numDataCodewords(ver, ecl) {
  return Math.floor(numRawDataModules(ver) / 8) - ECC_CW_PER_BLOCK[ecl][ver] * ECC_BLOCKS[ecl][ver]
}

function alignmentPositions(ver) {
  if (ver === 1) return []
  const numAlign = Math.floor(ver / 7) + 2
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2
  const size = ver * 4 + 17
  const result = [6]
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
  return result
}

// ── 数据编码 ───────────────────────────────────────────────────────────────

function textToBytes(text) {
  if (typeof TextEncoder !== 'undefined') return [...new TextEncoder().encode(text)]
  return [...Buffer.from(String(text), 'utf8')]
}

function pickVersion(byteLen, ecl) {
  for (let ver = 1; ver <= 40; ver++) {
    const countBits = ver <= 9 ? 8 : 16
    const capacityBits = numDataCodewords(ver, ecl) * 8
    const needBits = 4 + countBits + byteLen * 8
    if (needBits <= capacityBits) return ver
  }
  return -1
}

function buildCodewords(bytes, ver, ecl) {
  const capacityBits = numDataCodewords(ver, ecl) * 8
  const bits = []
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  push(0b0100, 4) // byte mode
  push(bytes.length, ver <= 9 ? 8 : 16)
  for (const byte of bytes) push(byte, 8)

  const terminator = Math.min(4, capacityBits - bits.length)
  for (let i = 0; i < terminator; i++) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)

  const data = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    data.push(byte)
  }
  const total = numDataCodewords(ver, ecl)
  for (let pad = 0xec; data.length < total; pad ^= 0xec ^ 0x11) data.push(pad)
  return data
}

function addEccAndInterleave(data, ver, ecl) {
  const numBlocks = ECC_BLOCKS[ecl][ver]
  const blockEccLen = ECC_CW_PER_BLOCK[ecl][ver]
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)
  const divisor = rsDivisor(blockEccLen)

  const blocks = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dataLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1)
    const dat = data.slice(k, k + dataLen)
    k += dataLen
    const ecc = rsRemainder(dat, divisor)
    const block = dat.slice()
    if (i < numShortBlocks) block.push(0) // 占位，交织时跳过
    blocks.push({ data: block, ecc, short: i < numShortBlocks })
  }

  const result = []
  for (let i = 0; i < shortBlockLen + 1; i++) {
    for (const block of blocks) {
      if (i !== shortBlockLen - blockEccLen || !block.short) {
        if (i < block.data.length) result.push(block.data[i])
      }
    }
  }
  for (let i = 0; i < blockEccLen; i++) {
    for (const block of blocks) result.push(block.ecc[i])
  }
  if (result.length !== rawCodewords) throw new Error(`interleave length ${result.length} != ${rawCodewords}`)
  return result
}

// ── 矩阵 ───────────────────────────────────────────────────────────────────

function makeMatrix(ver, ecl, codewords) {
  const size = ver * 4 + 17
  const modules = Array.from({ length: size }, () => new Uint8Array(size))
  const isFunction = Array.from({ length: size }, () => new Uint8Array(size))

  const setFunction = (x, y, dark) => {
    modules[y][x] = dark ? 1 : 0
    isFunction[y][x] = 1
  }

  // 时序图案
  for (let i = 0; i < size; i++) {
    setFunction(6, i, i % 2 === 0)
    setFunction(i, 6, i % 2 === 0)
  }
  // 定位图案（含分隔符）
  const drawFinder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, dist !== 2 && dist !== 4)
      }
    }
  }
  drawFinder(3, 3)
  drawFinder(size - 4, 3)
  drawFinder(3, size - 4)
  // 校正图案
  const align = alignmentPositions(ver)
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue
      const cx = align[i]
      const cy = align[j]
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }

  const drawFormat = (mask) => {
    const data = (ECC_FORMAT_BITS[ecl] << 3) | mask
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = ((data << 10) | rem) ^ 0x5412
    const bit = (i) => ((bits >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) setFunction(8, i, bit(i))
    setFunction(8, 7, bit(6))
    setFunction(8, 8, bit(7))
    setFunction(7, 8, bit(8))
    for (let i = 9; i < 15; i++) setFunction(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, bit(i))
    setFunction(8, size - 8, true) // 恒暗模块
  }
  drawFormat(0)

  const drawVersion = () => {
    if (ver < 7) return
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFunction(a, b, dark)
      setFunction(b, a, dark)
    }
  }
  drawVersion()

  // 数据位（zigzag）
  let index = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFunction[y][x] && index < codewords.length * 8) {
          modules[y][x] = (codewords[index >>> 3] >>> (7 - (index & 7))) & 1
          index++
        }
      }
    }
  }
  if (index !== codewords.length * 8) throw new Error(`data placement ${index} != ${codewords.length * 8}`)

  return { size, modules, isFunction, drawFormat }
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

function penalty(modules, size) {
  let score = 0
  // 规则 1：连续 5 个以上同色
  for (let y = 0; y < size; y++) {
    let run = 1
    for (let x = 1; x < size; x++) {
      if (modules[y][x] === modules[y][x - 1]) {
        run++
      } else {
        if (run >= 5) score += run - 2
        run = 1
      }
    }
    if (run >= 5) score += run - 2
  }
  for (let x = 0; x < size; x++) {
    let run = 1
    for (let y = 1; y < size; y++) {
      if (modules[y][x] === modules[y - 1][x]) {
        run++
      } else {
        if (run >= 5) score += run - 2
        run = 1
      }
    }
    if (run >= 5) score += run - 2
  }
  // 规则 2：2×2 同色块
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = modules[y][x]
      if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) score += 3
    }
  }
  // 规则 4：暗色比例偏离 50%
  let dark = 0
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dark += modules[y][x] ? 1 : 0
  const percent = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(percent - 50) / 5) * 10
  return score
}

/** 标准表（供自测脚本的反向解码器复用；表本身是 ISO/IEC 18004 的公开数据）。 */
export const QR_TABLES = { ECC_CW_PER_BLOCK, ECC_BLOCKS, ECC_NAMES, ECC_FORMAT_BITS }

/**
 * 编码为二维码矩阵。
 * @param {string} text
 * @param {'L'|'M'|'Q'|'H'} eclName
 * @returns {{ size: number, modules: Uint8Array[], version: number, ecl: string, mask: number }}
 */
export function encodeMatrix(text, eclName = 'M') {
  const ecl = Math.max(0, ECC_NAMES.indexOf(String(eclName).toUpperCase()))
  const bytes = textToBytes(text)
  const ver = pickVersion(bytes.length, ecl)
  if (ver < 0) throw new Error('内容过长，二维码放不下')
  const data = buildCodewords(bytes, ver, ecl)
  const codewords = addEccAndInterleave(data, ver, ecl)
  const base = makeMatrix(ver, ecl, codewords)

  let best = null
  for (let mask = 0; mask < 8; mask++) {
    const modules = base.modules.map((row) => Uint8Array.from(row))
    for (let y = 0; y < base.size; y++) {
      for (let x = 0; x < base.size; x++) {
        if (!base.isFunction[y][x] && maskBit(mask, x, y)) modules[y][x] ^= 1
      }
    }
    // 掩码改变后要重画格式信息
    const patched = makeMatrix(ver, ecl, codewords)
    for (let y = 0; y < base.size; y++) for (let x = 0; x < base.size; x++) patched.modules[y][x] = modules[y][x]
    patched.drawFormat(mask)
    const score = penalty(patched.modules, base.size)
    if (!best || score < best.score) best = { score, mask, modules: patched.modules }
  }

  return { size: base.size, modules: best.modules, version: ver, ecl: ECC_NAMES[ecl], mask: best.mask }
}

/**
 * 编码成 SVG path 的 `d` 属性：每个连续暗色横段一个矩形。
 * @param {string} text
 * @param {{ecl?: string, quiet?: number}} [options]
 */
export function qrSvgPath(text, options = {}) {
  const { ecl = 'M', quiet = 2 } = options
  const matrix = encodeMatrix(text, ecl)
  const parts = []
  for (let y = 0; y < matrix.size; y++) {
    let x = 0
    while (x < matrix.size) {
      if (!matrix.modules[y][x]) {
        x++
        continue
      }
      let run = 1
      while (x + run < matrix.size && matrix.modules[y][x + run]) run++
      parts.push(`M${x + quiet} ${y + quiet}h${run}v1h-${run}z`)
      x += run
    }
  }
  return {
    path: parts.join(''),
    dimension: matrix.size + quiet * 2,
    version: matrix.version,
    ecl: matrix.ecl,
    mask: matrix.mask,
  }
}
