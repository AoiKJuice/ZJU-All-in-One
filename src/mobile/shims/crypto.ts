// node:crypto 的替身：services 只用到 md5（智云回放签名）与 randomUUID

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)

function md5(input: Uint8Array): string {
  const length = ((input.length + 8) >>> 6) * 64 + 64
  const bytes = new Uint8Array(length)
  bytes.set(input)
  bytes[input.length] = 0x80
  const view = new DataView(bytes.buffer)
  view.setUint32(length - 8, (input.length * 8) >>> 0, true)
  view.setUint32(length - 4, Math.floor(input.length / 0x20000000), true)
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]
  for (let offset = 0; offset < length; offset += 64) {
    let [a, b, c, d] = [a0, b0, c0, d0]
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) [f, g] = [(b & c) | (~b & d), i]
      else if (i < 32) [f, g] = [(d & b) | (~d & c), (5 * i + 1) % 16]
      else if (i < 48) [f, g] = [b ^ c ^ d, (3 * i + 5) % 16]
      else [f, g] = [c ^ (b | ~d), (7 * i) % 16]
      const sum = (a + f + K[i] + view.getUint32(offset + g * 4, true)) >>> 0
      ;[a, d, c] = [d, c, b]
      b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }
  const out = new DataView(new ArrayBuffer(16))
  ;[a0, b0, c0, d0].forEach((word, i) => out.setUint32(i * 4, word, true))
  return [...new Uint8Array(out.buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createHash(algorithm: 'md5') {
  if (algorithm !== 'md5') throw new Error(`不支持的摘要算法 ${algorithm}`)
  const parts: Uint8Array[] = []
  const hash = {
    update(data: string | Uint8Array) {
      parts.push(typeof data === 'string' ? new TextEncoder().encode(data) : data)
      return hash
    },
    digest(_encoding: 'hex') {
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
      let at = 0
      for (const p of parts) {
        all.set(p, at)
        at += p.length
      }
      return md5(all)
    }
  }
  return hash
}

export const randomUUID = (): string => crypto.randomUUID()
