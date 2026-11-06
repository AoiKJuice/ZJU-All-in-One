// 校内专用域名经 WebVPN（webvpn.zju.edu.cn，Wengine 系统）访问时的地址改写。
// 规则（Wengine 通用，浙大实例未以登录态实测）：https://webvpn.zju.edu.cn/<协议[-端口]>/<hex(IV)><hex(AES-128-CFB(主机名))><路径与查询>，
// 密钥与 IV 均为 ASCII「wrdvpnisthebest!」，CFB 段长 128 位，密文截到主机名的长度。WebVPN 自身走统一身份认证登录（会话 cookie 在 persist:zju）。
// 只用 WebCrypto（CFB 由单块 AES 加密拼出：对一块明文做零 IV 的 AES-CBC，取前 16 字节即 AES(块)），桌面与安卓共用。

const KEY = 'wrdvpnisthebest!'
export const WEBVPN = 'https://webvpn.zju.edu.cn'

const bytes = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(text))
const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

let keyPromise: Promise<CryptoKey> | null = null
const aesKey = (): Promise<CryptoKey> =>
  (keyPromise ??= crypto.subtle.importKey('raw', bytes(KEY), { name: 'AES-CBC' }, false, ['encrypt']))

/** AES-128 加密单个 16 字节块 */
async function encryptBlock(block: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const out = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, await aesKey(), block)
  return new Uint8Array(out).slice(0, 16)
}

async function cfb(plain: Uint8Array): Promise<Uint8Array> {
  const out = new Uint8Array(plain.length)
  let prev = bytes(KEY)
  for (let i = 0; i < plain.length; i += 16) {
    const stream = await encryptBlock(prev)
    const block = new Uint8Array(new ArrayBuffer(16))
    for (let k = 0; k < 16; k++) block[k] = (plain[i + k] ?? 0) ^ stream[k]
    out.set(block.slice(0, Math.min(16, plain.length - i)), i)
    prev = block
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
