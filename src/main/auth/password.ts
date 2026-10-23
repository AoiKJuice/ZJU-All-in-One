import { app, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zjuFetch } from '../http'
import { CAS_BASE, hasCasCookie, zjuSession } from './zjuam'

// 统一身份认证账号密码登录。流程照 Celechron（lib/http/zjuServices/zjuam.dart）：
// 登录页取 execution → getPubKey 取 RSA 公钥 → 教科书 RSA 加密密码 → 表单提交，写入 iPlanetDirectoryPro 即成功。

interface Credentials {
  username: string
  password: string
}

/** 账号或密码被拒（区别于网络错误：只有这种情况才清掉保存的凭据） */
class RejectedError extends Error {}

const credentialsPath = (): string => join(app.getPath('userData'), 'credentials.bin')

/** RSA 无填充：密码 UTF-8 字节作大整数 m，c = m^e mod n，十六进制左补 0 到 128 位 */
function encrypt(password: string, exponent: string, modulus: string): string {
  let base = BigInt(`0x${Buffer.from(password, 'utf8').toString('hex')}`)
  let e = BigInt(`0x${exponent}`)
  const n = BigInt(`0x${modulus}`)
  let result = 1n
  base %= n
  while (e > 0n) {
    if (e & 1n) result = (result * base) % n
    base = (base * base) % n
    e >>= 1n
  }
  return result.toString(16).padStart(128, '0')
}

/** 失败时登录页 #errormsg 段落里是提示文字（页面始终带隐藏的验证码区，不能据此判断） */
function errorMessage(html: string): string {
  const block = html.match(/id="errormsg"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''
  return block.replace(/<[^>]+>/g, '').trim() || '用户名或密码错误'
}

async function submit(username: string, password: string): Promise<void> {
  const cookies = zjuSession().cookies
  for (const cookie of await cookies.get({ name: 'iPlanetDirectoryPro' })) {
    await cookies.remove(`https://${cookie.domain!.replace(/^\./, '')}${cookie.path ?? '/'}`, cookie.name)
  }

  const page = await (await zjuFetch(`${CAS_BASE}/login`, { relogin: false })).text()
  const execution = page.match(/name="execution" value="(.*?)"/)?.[1]
  if (!execution) throw new Error('统一身份认证页面异常')

  const key = await (await zjuFetch(`${CAS_BASE}/v2/getPubKey`, { relogin: false })).json<{ modulus: string; exponent: string }>()
  const body = new URLSearchParams({
    username,
    password: encrypt(password, key.exponent, key.modulus),
    execution,
    _eventId: 'submit',
    rememberMe: 'true'
  })
  const response = await zjuFetch(`${CAS_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: body.toString(),
    relogin: false
  })
  if (await hasCasCookie()) return
  const message = errorMessage(await response.text())
  // 多次失败后要求验证码：交给网页登录，凭据不算失效
  if (message.includes('验证码')) throw new Error('需要验证码，请用网页登录')
  throw new RejectedError(message)
}

let pending: Promise<void> | undefined

export function passwordLogin(username: string, password: string): Promise<void> {
  pending ??= submit(username, password).finally(() => {
    pending = undefined
  })
  return pending
}

export async function saveCredentials(username: string, password: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) return
  await writeFile(credentialsPath(), safeStorage.encryptString(JSON.stringify({ username, password })))
}

export async function loadCredentials(): Promise<Credentials | null> {
  if (!existsSync(credentialsPath())) return null
  return JSON.parse(safeStorage.decryptString(await readFile(credentialsPath()))) as Credentials
}

export async function clearCredentials(): Promise<void> {
  await rm(credentialsPath(), { force: true })
}

let relogging: Promise<boolean> | undefined

/** 用保存的凭据重登；没有凭据返回 false，凭据失效（密码已改）则清掉后返回 false */
export function relogin(): Promise<boolean> {
  relogging ??= (async () => {
    const saved = await loadCredentials()
    if (!saved) return false
    try {
      await passwordLogin(saved.username, saved.password)
      return true
    } catch (error) {
      if (error instanceof RejectedError) await clearCredentials()
      return false
    }
  })().finally(() => {
    relogging = undefined
  })
  return relogging
}
