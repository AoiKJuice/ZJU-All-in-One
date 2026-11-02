import { BrowserWindow, net, session, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import type { FormAnswer, FormOpenOptions, FormProfile, FormQuestion, FormSession, FormStatus } from '@shared/forms'
import { loadSecret, saveSecret } from '../secure'
import { logDiagnostic } from '../diagnostics'
import { casCookieValue, zjuSession } from '../auth/zjuam'
import { ensureCas, refreshCas } from '../http'
import { OPEN_EVENT } from '@shared/ipc'
import { formMatcher, formPage, type PageState } from './page.js'

// 问卷填写：订阅后在后台开窗（不显示）加载问卷（问卷星 / 腾讯问卷 / 金数据等），注入 page.js 按题目标题填入本人信息。
// 开放后：自动提交时全部填上就直接交，有没填上的题在应用里弹窗问；检查后提交时弹窗列出全部题目，用户确认后交。
// 不调平台接口，只操作页面；验证码、扫码登录时把窗口显示出来交给用户，不绕过。
// 定时开放：窗口先打开，用问卷站响应头的 Date 校准本机时钟，到点刷新再填，页面仍显示未开始时隔一会儿再刷新。
// 窗口用独立分区 persist:forms，扫码登录过的微信 / QQ 下次还在。进行中的订阅只在本次运行里保留，提交后的答卷备份加密存本机

const PROFILE_FILE = 'form-profile.bin'
const HISTORY_FILE = 'form-history.bin'
const PARTITION = 'persist:forms'
const MAX_HISTORY = 50

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

// 已提交的答卷备份
let history: FormSession[] | null = null

async function loadHistory(): Promise<FormSession[]> {
  if (!history) {
    const text = await loadSecret(HISTORY_FILE).catch(() => null)
    history = text ? (JSON.parse(text) as FormSession[]) : []
  }
  return history
}

async function saveHistory(): Promise<void> {
  await saveSecret(HISTORY_FILE, JSON.stringify((history ?? []).slice(0, MAX_HISTORY))).catch(() => {})
}

interface Live {
  session: FormSession
  win: BrowserWindow | null
  timers: NodeJS.Timeout[]
  /** 到了开放时刻（或立即订阅），开始填写 */
  armed: boolean
  /** 到点后页面仍显示未开始时已重刷的次数 */
  reloads: number
  onLogin: boolean
  /** 浙大自己的表单：登录交给应用的统一身份认证，不让用户在问卷窗口里再登 */
  zju: boolean
  /** 被弹回统一身份认证登录页后，用应用登录态重试的次数与上次时刻 */
  casTries: number
  casAt: number
  /** 上次带进来的统一身份认证 cookie；应用重新登录后值会变，据此再试 */
  casSeen: string | null
  polling: boolean
  /** 已经问过 / 交过的页（题目键串）；翻页、提交被拦下后重新判断 */
  decided: string | null
  /** 用户在应用里填的答案，页面刷新后随资料一起重新填进去 */
  answers: Record<string, FormAnswer>
  /** 各页提交时的答卷，按页的题目键串存，同一页重交时覆盖 */
  pages: Map<string, { title: string; value: string }[]>
  submittingAt: number
  reopenedAt: number
  /** 窗口因验证码 / 登录被自动显示出来（处理完再藏起来），或用户要求显示 */
  shown: 'auto' | 'user' | null
  closing: boolean
}

const lives = new Map<string, Live>()

// 主窗口：问卷开放、要用户补填时提到前面
let appWindow: BrowserWindow | null = null
export function setAppWindow(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) appWindow = win
}

const script = (op: 'install' | 'state' | 'describe' | 'answer' | 'submit', profile: FormProfile | null = null, arg: Record<string, FormAnswer> | null = null): string =>
  `(${formPage.toString()})(${JSON.stringify(profile)}, ${JSON.stringify(op)}, ${formMatcher.toString()}, ${JSON.stringify(arg)})`

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

function later(live: Live, ms: number, fn: () => void): void {
  live.timers.push(setTimeout(fn, Math.max(0, ms)))
}

/** 页面里跑脚本；页面卡住（对话框、长任务）时按超时放弃 */
function run<T>(live: Live, code: string, timeout = 3000): Promise<T | null> {
  const win = live.win
  if (!win || win.isDestroyed()) return Promise.resolve(null)
  return Promise.race([win.webContents.executeJavaScript(code).catch(() => null) as Promise<T | null>, new Promise<null>((r) => setTimeout(() => r(null), timeout))])
}

function setStatus(live: Live, status: FormStatus, extra?: Record<string, number>): void {
  if (live.session.status === status) return
  live.session.status = status
  logDiagnostic('form-status', { status, ...extra })
}

async function install(live: Live): Promise<void> {
  // 登录页（统一身份认证、扫码）不是问卷，不能往里填学号
  if (!live.armed || live.onLogin) return
  await run(live, script('install', (await loadProfile()) ?? EMPTY_PROFILE, live.answers))
}

/** 验证码、扫码登录：窗口显示出来交给用户 */
function reveal(live: Live, why: 'auto' | 'user'): void {
  const win = live.win
  if (!win || win.isDestroyed()) return
  if (live.shown !== 'user') live.shown = why
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function conceal(live: Live): void {
  if (live.shown !== 'auto' || !live.win || live.win.isDestroyed()) return
  live.shown = null
  live.win.hide()
}

/** 该问用户的题：不列选填题时只留必填的；自动提交只问没填上的 */
function toAsk(live: Live, questions: FormQuestion[]): FormQuestion[] {
  const shown = live.session.optional ? questions : questions.filter((q) => q.required)
  return live.session.autoSubmit ? shown.filter((q) => !q.filled) : shown
}

/** 要用户在应用里补填 / 确认：记下题目，主窗口提到前面 */
function ask(live: Live, questions: FormQuestion[], message: string | null = null): void {
  const s = live.session
  s.questions = questions
  s.round++
  s.message = message
  setStatus(live, 'asking', { questions: questions.length })
  const win = appWindow
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.flashFrame(true)
  }
}

const answerText = (value: FormAnswer): string => (Array.isArray(value) ? value.join('、') : value.trim())

/** 记下这一页的答卷并点提交（多页问卷点下一页） */
async function submitPage(live: Live, page: string, questions: FormQuestion[]): Promise<void> {
  live.pages.set(
    page,
    questions.filter((q) => q.filled && q.kind !== 'other').map((q) => ({ title: q.title, value: answerText(q.value) }))
  )
  live.session.questions = []
  live.session.message = null
  live.submittingAt = Date.now()
  setStatus(live, 'submitting')
  await run(live, script('submit'))
}

/** 提交成功：答卷存进备份，关掉窗口 */
async function finish(live: Live): Promise<void> {
  const s = live.session
  s.status = 'submitted'
  s.submittedAt = new Date().toISOString()
  s.backup = [...live.pages.values()].flat()
  s.questions = []
  logDiagnostic('form-status', { status: 'submitted', answers: s.backup.length })
  lives.delete(s.id)
  const list = await loadHistory()
  history = [{ ...s }, ...list.filter((h) => h.id !== s.id)].slice(0, MAX_HISTORY)
  await saveHistory()
  live.closing = true
  live.timers.forEach(clearTimeout)
  setTimeout(() => live.win && !live.win.isDestroyed() && live.win.destroy(), 1500)
}

/** 读页面状态，推导记录的状态；开放后决定直接提交还是在应用里问 */
async function poll(live: Live): Promise<void> {
  if (!live.win || live.win.isDestroyed() || !live.armed || live.polling || live.session.status === 'submitted') return
  live.polling = true
  try {
    // 登录页上没装填写脚本，读不到页面状态，要在读状态之前处理
    if (live.onLogin) {
      setStatus(live, 'login')
      // 浙大表单：应用登录上了（或重登成功）就带着新的登录态重开
      if (live.zju && Date.now() - live.casAt > 3000) {
        const value = (await casCookieValue()) ?? null
        if (value && value !== live.casSeen) {
          live.casTries = 0
          void useAppLogin(live)
        }
      }
      return
    }
    const state = await run<PageState>(live, script('state'))
    if (!state) return
    const s = live.session
    // 登录页的标题（统一身份认证平台）不当问卷标题
    if (state.title && !live.onLogin) s.title = state.title
    if (state.alerts.length) s.message = state.alerts[state.alerts.length - 1]

    if (state.done || (state.questions === 0 && state.submittedAt > 0 && !state.notOpen)) return void (await finish(live))
    if (state.captcha) {
      setStatus(live, 'verify')
      return reveal(live, 'auto')
    }
    conceal(live)

    if (state.notOpen) {
      setStatus(live, 'waiting')
      // 立即订阅的：页面写着开放时刻就按它倒计时
      if (!s.at && state.opensAt) {
        s.at = state.opensAt
        void serverOffset(s.url).then((offset) => (s.offset = offset))
      }
      // 到点了页面却还没开放（本机时钟误差、平台慢几秒）：隔一会儿再刷，最多刷 15 次
      if (s.at && Date.now() + s.offset >= Date.parse(s.at) && live.reloads < 15) {
        live.reloads++
        later(live, 800, () => reopen(live))
      }
      // 页面没写开放时刻（如浙大表单只说「未在开启时间范围内」），或到点重刷 15 次仍没开：每 30 秒重开一次看看
      else if ((!s.at || live.reloads >= 15) && Date.now() - live.reopenedAt > 30_000) reopen(live)
      return
    }
    if (state.questions === 0) {
      if (s.status !== 'asking') setStatus(live, 'filling')
      return
    }

    if (s.status === 'submitting') {
      const stuck = Date.now() - live.submittingAt > 10_000
      // 提交被页面拦下（必填没填、格式不对），或点了没反应：列出全部题目再问
      if (state.page === live.decided && (state.invalid || stuck)) {
        const questions = await run<FormQuestion[]>(live, script('describe'), 5000)
        if (questions) ask(live, live.session.optional ? questions : questions.filter((q) => q.required || !q.filled), s.message ?? (stuck ? '提交后页面没有反应' : '提交被页面拦下'))
        return
      }
      if (state.page === live.decided) return
    }
    if (state.page === live.decided) return
    if (state.running || state.stableFor < 1000) {
      if (s.status !== 'asking') setStatus(live, 'filling')
      return
    }

    // 新的一页填稳了：自动提交时全部填上就交，否则在应用里问
    const questions = await run<FormQuestion[]>(live, script('describe'), 5000)
    if (!questions) return
    live.decided = state.page
    const asking = toAsk(live, questions)
    if (s.autoSubmit && !asking.length) await submitPage(live, state.page, questions)
    else ask(live, asking)
  } finally {
    live.polling = false
  }
}

/** 重开问卷地址：不能 reload——单页表单未开放时会跳到错误页路由（form.zju.edu.cn 的 #/dform/formError/…），刷新的只是错误页 */
function reopen(live: Live): void {
  live.reopenedAt = Date.now()
  if (live.win && !live.win.isDestroyed()) live.win.loadURL(live.session.url).catch(() => {})
}

function arm(live: Live): void {
  if (live.armed || !live.win || live.win.isDestroyed()) return
  live.armed = true
  setStatus(live, 'filling')
  reopen(live)
}

/** 定时：先按当前校准排到开放前 20 秒，那时再校准一次，排到开放时刻 */
async function schedule(live: Live, at: number): Promise<void> {
  const offset = await serverOffset(live.session.url)
  live.session.offset = offset
  const wait = at - (Date.now() + offset)
  if (wait > 30_000) later(live, wait - 20_000, () => void schedule(live, at))
  else later(live, wait, () => arm(live))
}

/** 登录页：换了主机且地址像登录（zjuam 与问卷同在 zju.edu.cn 下，不能按站点比） */
function isLogin(target: string, formHost: string): boolean {
  try {
    return new URL(target).hostname !== formHost && LOGIN.test(target)
  } catch {
    return false
  }
}

/** 浙大自己的表单（form.zju.edu.cn 等）走统一身份认证：把应用里已登录的 CAS cookie 带进问卷分区，不用再登一次 */
const isZju = (host: string): boolean => /(^|\.)zju\.edu\.cn$/.test(host)

async function shareCas(host: string): Promise<void> {
  if (!isZju(host)) return
  const target = session.fromPartition(PARTITION).cookies
  const cookies = await zjuSession().cookies.get({ domain: 'zju.edu.cn' }).catch(() => [])
  for (const c of cookies) {
    const domain = (c.domain ?? '').replace(/^\./, '')
    if (domain !== 'zjuam.zju.edu.cn' && domain !== 'zju.edu.cn') continue
    await target
      .set({ url: `https://${domain}${c.path ?? '/'}`, name: c.name, value: c.value, path: c.path, secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate, ...(c.hostOnly ? {} : { domain: c.domain }) })
      .catch(() => {})
  }
}

/**
 * 浙大表单被弹回统一身份认证登录页：不显示登录页让用户再填，用应用的登录态——
 * 第一次直接把应用的 cookie 带过来重开，第二次先用保存的账号重登再带过来；仍不行（应用没登录、没存账号）就打开应用自己的登录面板，
 * 应用登上后 cookie 值变了，poll 里接着重开
 */
async function useAppLogin(live: Live): Promise<void> {
  live.casAt = Date.now()
  const tries = live.casTries++
  if (tries === 1) await refreshCas().catch(() => false)
  const value = (await casCookieValue()) ?? null
  live.casSeen = value
  if (!value || tries >= 2) {
    live.session.message = '先在应用里登录统一身份认证'
    const win = appWindow
    if (tries <= 2 && win && !win.isDestroyed()) {
      win.show()
      win.focus()
      win.webContents.send(OPEN_EVENT, { login: true })
    }
    return
  }
  live.session.message = null
  await shareCas(new URL(live.session.url).hostname)
  if (live.win && !live.win.isDestroyed()) live.win.loadURL(live.session.url).catch(() => {})
}

function sameSite(a: string, b: string): boolean {
  // edu.cn、com.cn 这类二级后缀要再往前取一级
  const root = (host: string): string => host.split('.').slice(/\.(edu|com|net|org|gov|ac)\.cn$/.test(host) ? -3 : -2).join('.')
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
      optional: options.optional ?? true,
      openedAt: new Date().toISOString(),
      questions: [],
      round: 0,
      message: null,
      submittedAt: null,
      backup: []
    },
    win: null,
    timers: [],
    armed: !timed,
    reloads: 0,
    onLogin: false,
    zju: false,
    casTries: 0,
    casAt: 0,
    casSeen: null,
    polling: false,
    decided: null,
    answers: {},
    pages: new Map(),
    submittingAt: 0,
    reopenedAt: Date.now(),
    shown: null,
    closing: false
  }
  lives.set(live.session.id, live)

  // 窗口不显示，填写、提交都在后台；验证码与扫码登录时才显示出来
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 860,
    title: '问卷',
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  })
  win.webContents.setAudioMuted(true)
  live.win = win
  // 同站与扫码登录的弹窗留在应用里（共用分区），其他外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (sameSite(target, url) || LOGIN.test(target)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } }
    void shell.openExternal(target)
    return { action: 'deny' }
  })
  win.webContents.on('did-navigate', (_e, target) => {
    live.onLogin = isLogin(target, host)
    if (!live.onLogin) return
    setStatus(live, 'login')
    if (live.zju) void useAppLogin(live)
    else reveal(live, 'auto')
  })
  win.webContents.on('did-fail-load', (_e, code, description, _target, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    live.session.message = description || `加载失败（${code}）`
    setStatus(live, 'error')
  })
  win.webContents.on('did-finish-load', () => void install(live))
  win.on('page-title-updated', (_e, title) => title && !live.onLogin && (live.session.title = title.replace(/\s*[-_|｜—]\s*(金数据|问卷星|腾讯问卷|问卷网|jinshuju|wjx)\s*$/i, '')))
  // 用户关掉显示出来的窗口只是藏起来，订阅还在；取消订阅才真的关
  win.on('close', (e) => {
    if (live.closing) return
    e.preventDefault()
    live.shown = null
    win.hide()
  })
  win.on('closed', () => {
    live.timers.forEach(clearTimeout)
    live.win = null
    if (live.session.status !== 'submitted') setStatus(live, 'closed')
  })
  const ticker = setInterval(() => (live.win ? void poll(live) : clearInterval(ticker)), 800)
  live.timers.push(ticker)

  live.zju = isZju(host)
  void (live.zju ? ensureCas().catch(() => {}).then(() => shareCas(host)) : Promise.resolve()).then(() => win.loadURL(url).catch(() => {}))
  if (timed) void schedule(live, at)
  logDiagnostic('form-open', { timed, autoSubmit: options.autoSubmit, optional: options.optional })
  return { ...live.session }
}

export async function listForms(): Promise<FormSession[]> {
  const live = [...lives.values()].reverse().map((l) => ({ ...l.session }))
  return [...live, ...(await loadHistory())]
}

/** 用户在应用里填的答案：填进页面，必填题都有了就提交，否则继续问 */
export async function answerForm(id: string, answers: Record<string, FormAnswer>): Promise<FormSession> {
  const live = lives.get(id)
  if (!live?.win || live.win.isDestroyed()) throw new Error('问卷窗口已关闭')
  if (live.session.status !== 'asking') throw new Error('问卷不在等待填写')
  live.answers = { ...live.answers, ...answers }
  const filled = await run<PageState>(live, script('answer', null, answers), 5000)
  // 等页面把答案吃进去（自绘下拉要展开、点选项）
  for (let i = 0; i < 10; i++) {
    const state = await run<PageState>(live, script('state'))
    if (state && !state.running && state.stableFor > 300) break
    await new Promise((r) => setTimeout(r, 200))
  }
  const questions = await run<FormQuestion[]>(live, script('describe'), 5000)
  if (!filled || !questions) throw new Error('问卷页面没有响应')
  const empty = questions.filter((q) => q.required && !q.filled && q.kind !== 'other')
  if (empty.length) ask(live, toAsk(live, questions), `还有必填题没填上：${empty.map((q) => q.title).join('、')}`)
  else await submitPage(live, live.decided ?? filled.page, questions)
  return { ...live.session }
}

/** 资料改过后：还在进行的订阅按新资料重填，正在问的重新判断（可能已经不用问了） */
export async function applyProfile(): Promise<void> {
  const profile = await loadProfile()
  for (const live of lives.values()) {
    if (!live.armed || !live.win || live.win.isDestroyed() || live.session.status === 'submitting') continue
    await run(live, script('install', profile, live.answers))
    if (live.session.status === 'asking') live.decided = null
  }
}

export async function focusForm(id: string): Promise<void> {
  const live = lives.get(id)
  if (live) {
    if (!live.win || live.win.isDestroyed()) throw new Error('问卷窗口已关闭')
    // 浙大表单要登录时打开应用自己的登录面板，不显示问卷窗口里的登录页
    if (live.zju && live.onLogin) {
      appWindow?.webContents.send(OPEN_EVENT, { login: true })
      return
    }
    return reveal(live, 'user')
  }
  const done = (await loadHistory()).find((h) => h.id === id)
  if (done) await shell.openExternal(done.url)
}

export async function closeForm(id: string): Promise<void> {
  const live = lives.get(id)
  if (live) {
    live.closing = true
    live.timers.forEach(clearTimeout)
    if (live.win && !live.win.isDestroyed()) live.win.destroy()
    lives.delete(id)
    return
  }
  const list = await loadHistory()
  history = list.filter((h) => h.id !== id)
  await saveHistory()
}
