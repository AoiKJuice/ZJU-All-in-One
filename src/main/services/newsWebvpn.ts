// 校内专用域名经 WebVPN（webvpn.zju.edu.cn，Wengine 系统）访问时的地址改写。
// 规则（Wengine 通用，浙大实例未以登录态实测）：https://webvpn.zju.edu.cn/<协议[-端口]>/<hex(IV)><hex(AES-128-CFB(主机名))><路径与查询>，
// 密钥与 IV 均为 ASCII「wrdvpnisthebest!」，CFB 段长 128 位，密文截到主机名的长度。WebVPN 是另一套账号（与统一身份认证无关），应用不替用户登录：只有会话里已有 WebVPN 登录时才取得到。
// 只用 WebCrypto（CFB 由单块 AES 加密拼出：对一块明文做零 IV 的 AES-CBC，取前 16 字节即 AES(块)），桌面与安卓共用。

import { zjuFetch } from '../http'

const KEY = 'wrdvpnisthebest!'
export const WEBVPN = 'https://webvpn.zju.edu.cn'

const bytes = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(text))
const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

const keys = new Map<string, Promise<CryptoKey>>()
const aesKey = (key: string): Promise<CryptoKey> => {
  let k = keys.get(key)
  if (!k) keys.set(key, (k = crypto.subtle.importKey('raw', bytes(key), { name: 'AES-CBC' }, false, ['encrypt'])))
  return k
}

/** AES-128 加密单个 16 字节块 */
async function encryptBlock(key: string, block: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const out = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, await aesKey(key), block)
  return new Uint8Array(out).slice(0, 16)
}

/** AES-128-CFB（段长 128 位），IV 与密钥相同；decrypt 时 input 为密文 */
async function cfb(input: Uint8Array, key = KEY, decrypt = false): Promise<Uint8Array> {
  const out = new Uint8Array(input.length)
  let prev = bytes(key)
  for (let i = 0; i < input.length; i += 16) {
    const stream = await encryptBlock(key, prev)
    const block = new Uint8Array(new ArrayBuffer(16))
    for (let k = 0; k < 16; k++) block[k] = (input[i + k] ?? 0) ^ stream[k]
    out.set(block.slice(0, Math.min(16, input.length - i)), i)
    // 下一段的移位寄存器是这一段的密文：加密时是刚算出的，解密时是读进来的
    if (decrypt) {
      const c = new Uint8Array(new ArrayBuffer(16))
      c.set(input.slice(i, i + 16))
      // 最后一段不足 16 字节时用不到 prev，补零无妨
      prev = c
    } else prev = block
  }
  return out
}

/** 把校内地址改写成 WebVPN 地址 */
export async function webvpnUrl(url: string): Promise<string> {
  const u = new URL(url)
  const scheme = u.protocol.replace(':', '')
  const port = u.port ? `-${u.port}` : ''
  const host = new TextEncoder().encode(u.hostname)
  return `${WEBVPN}/${scheme}${port}/${hex(new TextEncoder().encode(KEY))}${hex(await cfb(host))}${u.pathname}${u.search}`
}

/** 校内专用域名：只在校园网可达（公网解析不到或连不上）。WebVPN 自己除外 */
export const isCampusHost = (url: string): boolean => {
  const h = new URL(url).hostname
  return h.endsWith('.zju.edu.cn') && h !== 'webvpn.zju.edu.cn'
}

const IV_HEX = hex(new TextEncoder().encode(KEY))
const unhex = (h: string): Uint8Array => new Uint8Array((h.match(/../g) ?? []).map((b) => parseInt(b, 16)))

/** WebVPN 改写过的页面里，链接是 /https/<IV><加密主机名>/路径（或带 webvpn 主机的全称）：还原成原地址，列表解析才认得 */
export async function unwebvpn(html: string): Promise<string> {
  const re = new RegExp(String.raw`(?:https?://webvpn\.zju\.edu\.cn)?/(https?)(-\d+)?/${IV_HEX}([0-9a-f]+)`, 'g')
  const hosts = new Map<string, string>()
  for (const m of html.matchAll(re)) {
    if (hosts.has(m[3])) continue
    hosts.set(m[3], new TextDecoder().decode(await cfb(unhex(m[3]), KEY, true)))
  }
  return html.replace(re, (_, scheme: string, port: string | undefined, enc: string) => `${scheme}://${hosts.get(enc)}${port ? ':' + port.slice(1) : ''}`)
}
