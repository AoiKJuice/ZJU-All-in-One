import { BrowserWindow, net, session, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import type { FormOpenOptions, FormProfile, FormSession, FormStatus } from '@shared/forms'
import { loadSecret, saveSecret } from '../secure'
import { logDiagnostic } from '../diagnostics'
import { formMatcher, formPage, type PageState } from './page.js'

// 问卷填写：开窗加载问卷（问卷星 / 腾讯问卷 / 金数据等），注入 page.js 按题目标题填入本人信息。
// 不调平台接口，只操作页面；有必填题没认出时不自动提交；验证码、扫码登录、最短作答时间都由用户在窗口里处理，不绕过。
// 定时开放：窗口先打开（可提前扫码登录），用问卷站响应头的 Date 校准本机时钟，到点刷新再填，页面仍显示未开始时隔一会儿再刷新。
// 窗口用独立分区 persist:forms，扫码登录过的微信 / QQ 下次还在。记录只在本次运行里保留

const PROFILE_FILE = 'form-profile.bin'
const PARTITION = 'persist:forms'
const MAX_SESSIONS = 12

export const EMPTY_PROFILE: FormProfile = {
  studentId: '',
  name: '',
  gender: '',
  className: '',
  major: '',
  college: '',
  grade: '',
  campus: '',
  phone: '',
  email: '',
  qq: '',
  wechat: '',
  dorm: ''
}

/** 没保存过时为 null */
export async function loadProfile(): Promise<FormProfile | null> {
  const text = await loadSecret(PROFILE_FILE).catch(() => null)
  return text ? { ...EMPTY_PROFILE, ...(JSON.parse(text) as Partial<FormProfile>) } : null
}

export async function saveProfile(profile: FormProfile): Promise<FormProfile> {
  const clean = Object.fromEntries(Object.keys(EMPTY_PROFILE).map((k) => [k, String(profile[k as keyof FormProfile] ?? '').trim()])) as unknown as FormProfile
  await saveSecret(PROFILE_FILE, JSON.stringify(clean))
  return clean
}

interface Live {
  session: FormSession
  win: BrowserWindow | null
  timers: NodeJS.Timeout[]
  /** 到了开放时刻（或立即打开），开始填写 */
  armed: boolean
  /** 自动提交只试一次：第一次填稳时有没认出的必填题就放弃 */
  autoDecided: boolean
  /** 到点后页面仍显示未开始时已重刷的次数 */
  reloads: number
  onLogin: boolean
  polling: boolean
}

const lives = new Map<string, Live>()

const script = (op: 'install' | 'refill' | 'state' | 'submit', profile: FormProfile | null = null): string =>
  `(${formPage.toString()})(${JSON.stringify(profile)}, ${JSON.stringify(op)}, ${formMatcher.toString()})`

const LOGIN = /ptlogin|graph\.qq\.com|open\.weixin\.qq\.com|weixin\.qq\.com\/connect|passport\.|\/(login|signin|oauth|auth)\b/i

/** 问卷站时钟与本机的差（毫秒）：Date 头只到秒，取往返中点并补半秒；取不到当 0 */
function serverOffset(url: string): Promise<number> {
  return new Promise((resolve) => {
    const sent = Date.now()
    const req = net.request({ url, method: 'HEAD', session: session.fromPartition(PARTITION) })
    const timer = setTimeout(() => {
      req.abort()
      resolve(0)
    }, 5000)
    req.on('response', (res) => {
      clearTimeout(timer)
      const date = res.headers['date']
      const value = Array.isArray(date) ? date[0] : date
      resolve(value ? Date.parse(value) + 500 - (sent + Date.now()) / 2 : 0)
    })
    req.on('error', () => {
      clearTimeout(timer)
      resolve(0)
    })
    req.end()
  })
}

function update(live: Live, patch: Partial<FormSession>): void {
  Object.assign(live.session, patch)
}

function later(live: Live, ms: number, fn: () => void): void {
  live.timers.push(setTimeout(fn, Math.max(0, ms)))
}

async function install(live: Live): Promise<void> {
  const win = live.win
  if (!win || win.isDestroyed() || !live.armed) return
  const profile = (await loadProfile()) ?? EMPTY_PROFILE
  await win.webContents.executeJavaScript(script('install', profile)).catch(() => null)
}

/** 读页面状态，推导记录的状态；该自动提交时点提交 */
async function poll(live: Live): Promise<void> {
  const win = live.win
  if (!win || win.isDestroyed() || !live.armed || live.polling) return
  live.polling = true
  try {
    // 页面弹着 alert 时脚本会等到对话框关掉，所以加个超时
    const state = (await Promise.race([
      win.webContents.executeJavaScript(script('state')),
      new Promise((r) => setTimeout(() => r(null), 3000))
    ])) as PageState | null
    if (!state) return
    const s = live.session
    if (state.title) s.title = state.title
    // 提交后的成功页没有题目，保留最后一次的填写结果
    if (state.questions > 0) {
      s.filled = state.filled
      s.missed = state.missed
    }
    if (state.alerts.length) s.message = state.alerts[state.alerts.length - 1]
    else if (state.invalid) s.message = '提交被页面拦下'

    let status: FormStatus
    if (state.done) status = 'submitted'
    else if (state.captcha) status = 'verify'
    else if (live.onLogin) status = 'login'
    else if (state.notOpen) status = 'waiting'
    else if (state.questions === 0 && state.submittedAt > 0) status = 'submitted'
    // 还在渲染或正在填：已有结果时先保持，免得用户一边改一边闪
    else if (state.questions === 0 || state.running || state.stableFor < 800) status = s.status === 'filled' || s.status === 'attention' ? s.status : 'filling'
    else if (state.missed.length || !state.filled.length || state.invalid) status = 'attention'
    else status = 'filled'
    if (status !== s.status) logDiagnostic('form-status', { status, filled: state.filled.length, missed: state.missed.length })
    s.status = status

    // 到点了页面却还没开放（本机时钟误差、平台慢几秒）：隔一会儿再刷，最多刷 15 次
    if (state.notOpen && live.reloads < 15 && s.at) {
      live.reloads++
      later(live, 800, () => win.isDestroyed() || win.webContents.reload())
    }

    if (s.autoSubmit && !live.autoDecided && state.questions > 0 && !state.running && state.stableFor > 1200 && !state.captcha) {
      if (state.missed.length || !state.filled.length) live.autoDecided = true
      // 多页问卷翻到最后一页（只有提交、没有下一页）才交
      else if (state.submitReady && !state.nextPage) {
        live.autoDecided = true
        await win.webContents.executeJavaScript(script('submit'))
      }
    }
  } finally {
    live.polling = false
  }
}

function arm(live: Live): void {
  if (live.armed || !live.win || live.win.isDestroyed()) return
  live.armed = true
  update(live, { status: 'filling' })
  live.win.webContents.reload()
}

/** 定时：先按当前校准排到开放前 20 秒，那时再校准一次，排到开放时刻 */
async function schedule(live: Live, at: number): Promise<void> {
  const offset = await serverOffset(live.session.url)
  update(live, { offset })
  const wait = at - (Date.now() + offset)
  if (wait > 30_000) later(live, wait - 20_000, () => void schedule(live, at))
  else later(live, wait, () => arm(live))
}

function sameSite(a: string, b: string): boolean {
  const root = (host: string): string => host.split('.').slice(-2).join('.')
  try {
    return root(new URL(a).hostname) === root(new URL(b).hostname)
  } catch {
    return false
  }
}

export async function openForm(url: string, options: FormOpenOptions): Promise<FormSession> {
  url = url.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error('问卷地址无效')
  }
  const at = options.at ? Date.parse(options.at) : NaN
  const timed = Number.isFinite(at) && at > Date.now()

  const live: Live = {
    session: {
      id: randomUUID(),
      url,
      title: host,
      status: timed ? 'waiting' : 'filling',
      at: timed ? new Date(at).toISOString() : null,
      offset: 0,
      autoSubmit: options.autoSubmit,
      openedAt: new Date().toISOString(),
      filled: [],
      missed: [],
      message: null
    },
    win: null,
    timers: [],
    armed: !timed,
    autoDecided: false,
    reloads: 0,
    onLogin: false,
    polling: false
  }
  lives.set(live.session.id, live)
  // 只留最近的几条，先丢已关的
  for (const [id, old] of lives) {
    if (lives.size <= MAX_SESSIONS) break
    if (!old.win) lives.delete(id)
  }

  const win = new BrowserWindow({
    width: 1000,
    height: 860,
    title: '问卷',
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  })
  live.win = win
  // 同站与扫码登录的弹窗留在应用里（共用分区），其他外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (sameSite(target, url) || LOGIN.test(target)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } }
    void shell.openExternal(target)
    return { action: 'deny' }
  })
  win.webContents.on('did-navigate', (_e, target) => {
    live.onLogin = !sameSite(target, url) && LOGIN.test(target)
    if (live.onLogin) update(live, { status: 'login' })
  })
  win.webContents.on('did-fail-load', (_e, code, description, _target, isMainFrame) => {
    if (isMainFrame && code !== -3) update(live, { status: 'error', message: description || `加载失败（${code}）` })
  })
  win.webContents.on('did-finish-load', () => void install(live))
  win.on('page-title-updated', (_e, title) => title && update(live, { title }))
  win.on('closed', () => {
    live.timers.forEach(clearTimeout)
    live.win = null
    if (live.session.status !== 'submitted') update(live, { status: 'closed' })
  })
  const ticker = setInterval(() => (live.win ? void poll(live) : clearInterval(ticker)), 800)
  live.timers.push(ticker)

  win.loadURL(url).catch(() => {})
  if (timed) void schedule(live, at)
  logDiagnostic('form-open', { timed, autoSubmit: options.autoSubmit })
  return { ...live.session }
}

export function listForms(): FormSession[] {
  return [...lives.values()].reverse().map((l) => ({ ...l.session }))
}

export function focusForm(id: string): void {
  const win = lives.get(id)?.win
  if (!win || win.isDestroyed()) throw new Error('窗口已关闭')
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export async function refillForm(id: string): Promise<FormSession> {
  const live = lives.get(id)
  if (!live?.win || live.win.isDestroyed()) throw new Error('窗口已关闭')
  if (live.armed) await live.win.webContents.executeJavaScript(script('refill', (await loadProfile()) ?? EMPTY_PROFILE)).catch(() => null)
  await poll(live)
  return { ...live.session }
}

export function closeForm(id: string): void {
  const live = lives.get(id)
  if (!live) return
  if (live.win && !live.win.isDestroyed()) live.win.close()
  else lives.delete(id)
}
