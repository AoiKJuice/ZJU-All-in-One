// 校内专用域名经 WebVPN（webvpn.zju.edu.cn，Wengine 系统）访问时的地址改写。
// 规则（Wengine 通用，浙大实例未以登录态实测）：https://webvpn.zju.edu.cn/<协议[-端口]>/<hex(IV)><hex(AES-128-CFB(主机名))><路径与查询>，
// 密钥与 IV 均为 ASCII「wrdvpnisthebest!」，CFB 段长 128 位，密文截到主机名的长度。WebVPN 自身走统一身份认证登录（会话 cookie 在 persist:zju）。
// 只用 WebCrypto（CFB 由单块 AES 加密拼出：对一块明文做零 IV 的 AES-CBC，取前 16 字节即 AES(块)），桌面与安卓共用。

import { zjuFetch } from '../http'
import { loadCredentials } from '../auth/password'
import { logDiagnostic } from '../diagnostics'

const KEY = 'wrdvpnisthebest!'
/** 登录页给密码加密用的另一把（密钥与 IV 相同） */
const LOGIN_KEY = 'wrdvpnisawesome!'
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
  const re = new RegExp(`(?:https?://webvpn\.zju\.edu\.cn)?/(https?)(-\d+)?/${IV_HEX}([0-9a-f]+)`, 'g')
  const hosts = new Map<string, string>()
  for (const m of html.matchAll(re)) {
    if (hosts.has(m[3])) continue
    hosts.set(m[3], new TextDecoder().decode(await cfb(unhex(m[3]), KEY, true)))
  }
  return html.replace(re, (_, scheme: string, port: string | undefined, enc: string) => `${scheme}://${hosts.get(enc)}${port ? ':' + port.slice(1) : ''}`)
}

let login: Promise<void> | null = null
let failedAt = 0
let failure = ''

/**
 * 登录 WebVPN（网瑞达 Wengine）：它不接统一身份认证，只有自己的账号登录，用应用保存的统一身份认证账号试。
 * 登录页取 _csrf 与 captcha_id，密码按页面脚本 AES-CFB 加密（密钥 = IV = LOGIN_KEY，明文补 '0' 到 16 的倍数后截回原长），
 * POST /do-login，回 { success, url } 或 { error, message }。被拒（含要验证码、要短信二次验证）后 30 分钟内不再试，免得账号被锁
 */
export function webvpnLogin(): Promise<void> {
  if (Date.now() - failedAt < 30 * 60_000) return Promise.reject(new Error(failure))
  login ??= (async () => {
    const saved = await loadCredentials()
    if (!saved) throw new Error('WebVPN 未登录')
    const page = await (await zjuFetch(`${WEBVPN}/login`, { relogin: false })).text()
    const field = (name: string): string => new RegExp(`name="${name}"\s+value="([^"]*)"`).exec(page)?.[1] ?? ''
    const plain = new TextEncoder().encode(saved.password)
    const password = hex(bytes(LOGIN_KEY)) + hex(await cfb(plain, LOGIN_KEY))
    const form = new URLSearchParams({
      _csrf: field('_csrf'),
      auth_type: 'local',
      username: saved.username,
      sms_code: '',
      password,
      captcha: '',
      needCaptcha: 'false',
      captcha_id: field('captcha_id')
    })
    const reply = await (
      await zjuFetch(`${WEBVPN}/do-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
        body: form.toString(),
        relogin: false
      })
    )
      .json<{ success?: boolean; error?: string; message?: string }>()
      .catch(() => ({ success: false, error: 'BAD_REPLY', message: '' }))
    logDiagnostic('webvpn-login', { ok: Boolean(reply.success), error: reply.error })
    if (!reply.success) throw new Error(reply.error === 'NEED_TWO_STEP' || reply.error === 'NEED_TWO_STEP_TOTP' ? 'WebVPN 要二次验证' : 'WebVPN 登录失败')
  })().catch((error: unknown) => {
    failedAt = Date.now()
    failure = error instanceof Error ? error.message : String(error)
    login = null
    throw error
  })
  return login
}

/** 退出统一身份认证时一并忘掉 */
export function resetWebvpn(): void {
  login = null
  failedAt = 0
}
