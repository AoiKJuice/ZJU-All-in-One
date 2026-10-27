import { app, BrowserWindow, net, safeStorage, session, type Session } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Assignment, PtaState } from '@shared/types'
import { logDiagnostic } from '../diagnostics'

// PTA（pintia.cn）：浙大程序设计类课程的作业平台，账号与统一身份认证无关。
// 接口逆向自 PTA 网页端（登录页 passport 的 Login 接口）与开源的 vscode-pintia：
// - 登录 POST passport.pintia.cn/api/users/sessions {phone|email, password, rememberMe}，成功写入 PTASession cookie；
//   网页端先不带验证码提交，服务端回 GATEWAY_WRONG_CAPTCHA 时才弹腾讯滑块（CaptchaAppId 194593025），带 ticket/randStr 重试。
//   这里同样：用户在应用内登录时弹出验证码窗口让用户完成；后台自动重登遇到验证码则放弃（不突然弹窗）。
// - 当前用户 GET passport.pintia.cn/api/u/current → { user }，未登录 401。
// - 我的题目集 GET pintia.cn/api/problem-sets?filter={"endAtAfter":<now>} → { problemSets }，含 endAt。
// - 完成情况 GET pintia.cn/api/problem-sets/{id}/exam-problem-status → { problemStatus }；只读，不 POST /exams（会开考）。
// 独立分区 persist:pta：退出统一身份认证（清 persist:zju 的 cookie）不影响 PTA。

const PASSPORT = 'https://passport.pintia.cn'
const API = 'https://pintia.cn/api'

export const ptaSession = (): Session => session.fromPartition('persist:pta')

const configPath = (): string => join(app.getPath('userData'), 'pta.json')
const credentialsPath = (): string => join(app.getPath('userData'), 'pta-credentials.bin')

interface Credentials {
  username: string
  password: string
}

interface PtaResponse<T> {
  status: number
  body: T
}

/** 账号或密码被拒（与网络错误、需要验证码区分：只有这种情况才清掉保存的凭据） */
class RejectedError extends Error {}

function request<T>(url: string, method = 'GET', body?: unknown): Promise<PtaResponse<T>> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method, session: ptaSession(), useSessionCookies: true })
    req.setHeader('Accept', 'application/json;charset=UTF-8')
    if (body !== undefined) req.setHeader('Content-Type', 'application/json;charset=UTF-8')
    req.on('error', reject)
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('error', reject)
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, body: (text ? JSON.parse(text) : {}) as T })
      })
    })
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

// ---- 开关 ----

export function isEnabled(): boolean {
  return existsSync(configPath()) && (JSON.parse(readFileSync(configPath(), 'utf8')) as { enabled?: boolean }).enabled === true
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await writeFile(configPath(), JSON.stringify({ enabled }))
}

// ---- 凭据 ----

async function saveCredentials(credentials: Credentials): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) return
  await writeFile(credentialsPath(), safeStorage.encryptString(JSON.stringify(credentials)))
}

async function loadCredentials(): Promise<Credentials | null> {
  if (!existsSync(credentialsPath())) return null
  return JSON.parse(safeStorage.decryptString(await readFile(credentialsPath()))) as Credentials
}

// ---- 登录 ----

interface ErrorBody {
  error?: { code?: string; message?: string }
  code?: string
  message?: string
}

const CAPTCHA_APP_ID = '194593025'

/**
 * 腾讯滑块验证码：在一个 pintia.cn 域下的小窗口里加载 TCaptcha.js 并弹出（验证码校验来源域名），
 * 用户完成后返回 ticket/randStr；关掉窗口或验证码返回 null
 */
async function solveCaptcha(parent: BrowserWindow | undefined): Promise<{ ticket: string; randStr: string } | null> {
  const win = new BrowserWindow({
    parent,
    modal: !!parent,
    width: 400,
    height: 460,
    resizable: false,
    title: 'PTA 验证',
    autoHideMenuBar: true,
    backgroundColor: '#f3eee4',
    show: false,
    webPreferences: { session: ptaSession(), contextIsolation: true, sandbox: true }
  })
  try {
    // 任一 pintia.cn 页面即可，robots.txt 返回的是很小的 JSON
    await win.loadURL('https://pintia.cn/robots.txt')
    win.show()
    const closed = new Promise<null>((resolve) => win.on('closed', () => resolve(null)))
    const solved = win.webContents.executeJavaScript(`new Promise((resolve) => {
      document.body.innerHTML = ''
      document.body.style.background = '#f3eee4'
      const script = document.createElement('script')
      script.src = 'https://turing.captcha.qcloud.com/TCaptcha.js'
      script.onload = () => new window.TencentCaptcha('${CAPTCHA_APP_ID}', (r) => resolve(r)).show()
      script.onerror = () => resolve({ ret: -1 })
      document.head.appendChild(script)
    })`) as Promise<{ ret: number; ticket?: string; randstr?: string; errorCode?: number }>
    const result = await Promise.race([solved, closed])
    if (!result || result.ret !== 0 || result.errorCode || !result.ticket) return null
    return { ticket: result.ticket, randStr: result.randstr ?? '' }
  } finally {
    if (!win.isDestroyed()) win.close()
  }
}

/** parent 存在表示用户正在应用内登录：遇到验证码就弹出来让用户做；否则（后台重登）遇到验证码直接失败 */
async function passwordLogin({ username, password }: Credentials, parent?: BrowserWindow | null): Promise<void> {
  // 网页端规则：含 @ 为邮箱，否则按大陆手机号加 +86
  const who = username.includes('@') ? { email: username } : { phone: `+86${username.replace(/^\+?86/, '')}` }
  const body = { ...who, password, rememberMe: true }
  let res = await request<ErrorBody>(`${PASSPORT}/api/users/sessions`, 'POST', body)
  let code = res.body.error?.code ?? res.body.code
  if (code === 'GATEWAY_WRONG_CAPTCHA') {
    if (parent === undefined) throw new Error('PTA 需要验证码')
    const captcha = await solveCaptcha(parent ?? undefined)
    if (!captcha) throw new Error('验证未完成')
    res = await request<ErrorBody>(`${PASSPORT}/api/users/sessions`, 'POST', { ...body, ...captcha })
    code = res.body.error?.code ?? res.body.code
  }
  if (res.status >= 200 && res.status < 300) return
  const message = res.body.error?.message ?? res.body.message
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new RejectedError(message || 'PTA 账号或密码错误')
  throw new Error(message || `PTA 登录失败（${res.status}）`)
}

/** 带账号密码：程序内登录并加密保存；不带：弹出 PTA 网页登录（验证码等情况兜底），拿到 PTASession 即关窗 */
export async function login(parent: BrowserWindow | undefined, account?: Credentials): Promise<void> {
  if (account) {
    await passwordLogin(account, parent ?? null)
    await saveCredentials(account)
    return
  }
  await new Promise<void>((resolve) => {
    const win = new BrowserWindow({
      parent,
      modal: !!parent,
      width: 480,
      height: 720,
      title: 'PTA 登录',
      autoHideMenuBar: true,
      webPreferences: { session: ptaSession(), contextIsolation: true, sandbox: true }
    })
    const cookies = ptaSession().cookies
    const onCookie = (_e: unknown, cookie: Electron.Cookie, _cause: string, removed: boolean): void => {
      if (cookie.name === 'PTASession' && !removed) win.close()
    }
    cookies.on('changed', onCookie)
    win.on('closed', () => {
      cookies.off('changed', onCookie)
      resolve()
    })
    void win.loadURL('https://pintia.cn/auth/login')
  })
}

export async function logout(): Promise<void> {
  await ptaSession().clearStorageData({ storages: ['cookies'] })
  await rm(credentialsPath(), { force: true })
}

interface PtaUser {
  nickname?: string
  email?: string
  phone?: string
}

async function currentUser(): Promise<PtaUser | null> {
  const res = await request<{ user?: PtaUser }>(`${PASSPORT}/api/u/current`)
  return res.status === 200 && res.body.user ? res.body.user : null
}

let relogging: Promise<boolean> | undefined

/** 会话失效时用保存的账号重登；没有账号或密码被拒返回 false（被拒时清掉凭据） */
function relogin(): Promise<boolean> {
  relogging ??= (async () => {
    const saved = await loadCredentials()
    if (!saved) return false
    try {
      await passwordLogin(saved)
      logDiagnostic('pta-relogin', { result: 'ok' })
      return true
    } catch (error) {
      if (error instanceof RejectedError) await rm(credentialsPath(), { force: true })
      logDiagnostic('pta-relogin', { result: 'failed', message: error instanceof Error ? error.message : String(error) })
      return false
    }
  })().finally(() => {
    relogging = undefined
  })
  return relogging
}

/** 界面上显示的账号脱敏：手机号留前三后四，邮箱留首字与域名，昵称留首字 */
function maskUser(user: PtaUser): string {
  const phone = user.phone?.replace(/^\+?86-?/, '')
  if (phone && phone.length >= 7) return `${phone.slice(0, 3)}****${phone.slice(-4)}`
  if (user.email) {
    const [name, domain] = user.email.split('@')
    return `${name.slice(0, 1)}***@${domain}`
  }
  const nick = user.nickname ?? ''
  return nick ? `${nick.slice(0, 1)}${'*'.repeat(Math.min(Math.max(nick.length - 1, 1), 3))}` : '已登录'
}

export async function getState(): Promise<PtaState> {
  const enabled = isEnabled()
  const user = (await currentUser()) ?? ((await relogin()) ? await currentUser() : null)
  return { enabled, loggedIn: user !== null, user: user ? maskUser(user) : null }
}

// ---- 题目集 → 待办 ----

interface ProblemSet {
  id: string
  name: string
  endAt: string
  organizationName?: string
  ownerNickname?: string
}

interface ProblemStatus {
  problemSubmissionStatus: string
}

/** 未截止的题目集，按待办格式给出；未开启或未登录时返回空 */
export async function fetchTasks(): Promise<Assignment[]> {
  if (!isEnabled()) return []
  const filter = encodeURIComponent(JSON.stringify({ endAtAfter: new Date().toISOString() }))
  const url = `${API}/problem-sets?filter=${filter}`
  let res = await request<{ problemSets?: ProblemSet[] }>(url)
  if (res.status === 401 && (await relogin())) res = await request<{ problemSets?: ProblemSet[] }>(url)
  if (res.status === 401) return []
  if (res.status !== 200) throw new Error(`PTA 请求失败（${res.status}）`)

  const sets = res.body.problemSets ?? []
  return Promise.all(
    sets.map(async (ps): Promise<Assignment> => {
      // 没进入过的题目集还没有考试记录，状态取不到，就不显示进度
      const status = await request<{ problemStatus?: ProblemStatus[] }>(`${API}/problem-sets/${ps.id}/exam-problem-status`)
      const list = status.status === 200 ? status.body.problemStatus ?? [] : []
      const done = list.filter((p) => p.problemSubmissionStatus === 'PROBLEM_ACCEPTED').length
      return {
        id: `pta-${ps.id}`,
        courseId: 'pta',
        type: 'pta',
        courseName: 'PTA',
        title: ps.name,
        deadline: new Date(ps.endAt).toISOString(),
        submitted: list.length > 0 && done === list.length,
        url: `https://pintia.cn/problem-sets/${ps.id}`,
        ...(list.length > 0 ? { progress: { done, total: list.length } } : {})
      }
    })
  )
}
