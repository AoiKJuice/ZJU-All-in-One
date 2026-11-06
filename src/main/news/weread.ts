import { BrowserWindow, net, session, type Session } from 'electron'
import type { NewsFeed, NewsItem, WechatAccount, WereadState } from '@shared/news'
import { readConfig, writeConfig } from '../secure'
import { logDiagnostic } from '../diagnostics'

// 校园资讯 · 来源 C：微信公众号，经微信读书（weread.qq.com）读取。仅桌面端。思路参考 we-mp-rss 的 weread_mp 模式（只取事实，代码自写）：
// - 登录：弹窗加载 weread.qq.com，用户自己用微信扫码；会话 cookie（wr_vid / wr_skey / wr_rt）存在独立分区 persist:weread
//   （Chromium 的 cookie 库在 Windows 上经 DPAPI 加密，与 safeStorage 同一机制），应用不经手扫码与口令；
// - 公众号的书号为 MP_WXS_<biz 的十进制>，biz 取自文章页的 __biz（Base64），所以「添加」只需粘贴该号任一篇文章的链接，
//   不调用微信读书的订阅接口；
// - 文章列表 GET /web/mp/articles?bookId&offset（we-mp-rss 文档说已弃用、返回 -2041，但其 cookie 校验脚本仍在用），
//   取不到时退回 GET /api/mp/cover?bookId（只有最新一篇）；
// - errCode -2010 / -2012 视为登录失效（会话一般几天后过期，需重新扫码）；HTTP 429 或「频繁」视为被限制，24 小时后再试。
// 以上均未以登录态实测。

const BASE = 'https://weread.qq.com'
const FILE = 'news-weread.json'
const DAY = 86_400_000

interface Stored {
  accounts: WechatAccount[]
  limitedUntil?: number
  expired?: boolean
}

const wereadSession = (): Session => session.fromPartition('persist:weread')
const load = (): Stored => readConfig<Stored>(FILE) ?? { accounts: [] }
const save = (s: Stored): Promise<void> => writeConfig(FILE, s)

async function signedIn(): Promise<boolean> {
  const cookies = await wereadSession().cookies.get({ domain: 'weread.qq.com' })
  return cookies.some((c) => c.name === 'wr_skey' && c.value) && cookies.some((c) => c.name === 'wr_vid' && c.value)
}

export async function getState(): Promise<WereadState> {
  const s = load()
  if (s.limitedUntil && s.limitedUntil > Date.now()) return { status: 'limited', until: s.limitedUntil, accounts: s.accounts }
  if (!(await signedIn())) return { status: 'signedOut', accounts: s.accounts }
  return { status: s.expired ? 'expired' : 'ok', accounts: s.accounts }
}

function request(url: string, sess: Session = wereadSession()): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, session: sess, useSessionCookies: true })
    req.setHeader('Accept', 'application/json, text/html, */*')
    req.setHeader('Referer', `${BASE}/`)
    const timer = setTimeout(() => {
      req.abort()
      reject(new Error('超时'))
    }, 15_000)
    req.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        clearTimeout(timer)
        resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.end()
  })
}

/** 弹窗加载微信读书网页，用户扫码登录；拿到 wr_skey 即关窗。关窗未登录也返回当前状态 */
export async function login(parent?: BrowserWindow): Promise<WereadState> {
  await new Promise<void>((resolve) => {
    const win = new BrowserWindow({
      parent,
      width: 520,
      height: 640,
      title: '微信读书登录',
      autoHideMenuBar: true,
      webPreferences: { session: wereadSession(), contextIsolation: true, sandbox: true }
    })
    const cookies = wereadSession().cookies
    const onCookie = (_e: unknown, cookie: Electron.Cookie, _cause: string, removed: boolean): void => {
      if (cookie.name === 'wr_skey' && !removed && cookie.value) setTimeout(() => !win.isDestroyed() && win.close(), 800)
    }
    cookies.on('changed', onCookie)
    win.on('closed', () => {
      cookies.off('changed', onCookie)
      resolve()
    })
    // 打开即弹出扫码登录框（网页的登录入口）
    void win.loadURL(`${BASE}/#login`)
  })
  const s = load()
  if (await signedIn()) await save({ ...s, expired: false })
  logDiagnostic('weread-login', { ok: await signedIn() })
  return getState()
}

export async function logout(): Promise<WereadState> {
  await wereadSession().clearStorageData({ storages: ['cookies', 'localstorage'] })
  await save({ ...load(), expired: false })
  return getState()
}

/** 从公众号文章链接推出书号与名称：__biz 是 Base64 的十进制号 */
async function resolveArticle(articleUrl: string): Promise<WechatAccount> {
  const u = new URL(articleUrl.trim())
  if (u.hostname !== 'mp.weixin.qq.com') throw new Error('请粘贴 mp.weixin.qq.com 的文章链接')
  let biz = u.searchParams.get('__biz')
  const page = await request(u.href, session.defaultSession)
  biz ??= /var\s+biz\s*=\s*["']([^"']+)["']/.exec(page.text)?.[1] ?? /__biz=([A-Za-z0-9+/=]+)/.exec(page.text)?.[1] ?? null
  if (!biz) throw new Error('链接里找不到公众号信息')
  const id = atob(decodeURIComponent(biz).replace(/"|\|\|/g, '')).trim()
  if (!/^\d+$/.test(id)) throw new Error('链接里找不到公众号信息')
  const nick = /var\s+nickname\s*=\s*htmlDecode\(["']([^"']*)["']\)/.exec(page.text)?.[1] ?? /nick_name\s*[:=]\s*["']([^"']*)["']/.exec(page.text)?.[1] ?? /<strong class="profile_nickname">([^<]*)</.exec(page.text)?.[1]
  const avatar = /var\s+(?:round_head_img|hd_head_img)\s*=\s*["']([^"']+)["']/.exec(page.text)?.[1]
  return { id: `MP_WXS_${id}`, name: nick?.trim() || `公众号 ${id}`, ...(avatar ? { avatar } : {}) }
}

export async function addAccount(articleUrl: string): Promise<WereadState> {
  const account = await resolveArticle(articleUrl)
  const s = load()
  if (!s.accounts.some((a) => a.id === account.id)) s.accounts.push(account)
  await save(s)
  return getState()
}

export async function removeAccount(id: string): Promise<WereadState> {
  const s = load()
  await save({ ...s, accounts: s.accounts.filter((a) => a.id !== id) })
  return getState()
}

class WereadError extends Error {
  constructor(
    message: string,
    readonly kind: 'expired' | 'limited' | 'other'
  ) {
    super(message)
  }
}

function check(status: number, body: { errCode?: number; errcode?: number; errMsg?: string; errmsg?: string }): void {
  const code = body.errCode ?? body.errcode ?? 0
  const msg = body.errMsg ?? body.errmsg ?? ''
  if (status === 429 || /频繁|limit/i.test(msg)) throw new WereadError('请求频繁，被微信读书限制', 'limited')
  if (status === 401 || code === -2010 || code === -2012) throw new WereadError('微信读书登录已过期', 'expired')
  if (code !== 0) throw new WereadError(`微信读书 ${code}`, 'other')
}

/** 在一段 JSON 里找文章：带 title 与链接（doc_url / url）的对象 */
function collect(value: unknown, out: { title: string; url?: string; time?: number; reviewId?: string }[]): void {
  if (Array.isArray(value)) return value.forEach((v) => collect(v, out))
  if (!value || typeof value !== 'object') return
  const o = value as Record<string, unknown>
  if (typeof o.title === 'string' && (typeof o.doc_url === 'string' || typeof o.url === 'string' || typeof o.reviewId === 'string')) {
    out.push({
      title: o.title,
      url: (o.doc_url ?? o.url) as string | undefined,
      time: typeof o.time === 'number' ? o.time : typeof o.createTime === 'number' ? o.createTime : undefined,
      reviewId: o.reviewId as string | undefined
    })
    return
  }
  Object.values(o).forEach((v) => collect(v, out))
}

async function articlesOf(account: WechatAccount): Promise<NewsItem[]> {
  const found: { title: string; url?: string; time?: number; reviewId?: string }[] = []
  const list = await request(`${BASE}/web/mp/articles?bookId=${encodeURIComponent(account.id)}&offset=0`)
  const listBody = list.text.trimStart().startsWith('{') ? (JSON.parse(list.text) as Record<string, unknown>) : {}
  const listCode = (listBody.errCode ?? listBody.errcode) as number | undefined
  if (listCode === -2041 || (list.status === 404 && !listCode)) {
    // 列表接口不可用：只取最新一篇
    const cover = await request(`${BASE}/api/mp/cover?bookId=${encodeURIComponent(account.id)}`)
    const coverBody = JSON.parse(cover.text || '{}') as Record<string, unknown>
    check(cover.status, coverBody)
    collect(coverBody, found)
  } else {
    check(list.status, listBody)
    collect(listBody, found)
  }
  return found.map((a, i) => ({
    id: `wechat:${account.id}:${a.reviewId ?? a.url ?? i}`,
    kind: 'wechat' as const,
    title: a.title,
    url: a.url ?? (a.reviewId ? `${BASE}/web/mp/content?reviewId=${encodeURIComponent(a.reviewId)}` : undefined),
    time: a.time ? new Date(a.time * (a.time < 1e12 ? 1000 : 1)).toISOString() : null,
    from: account.name
  }))
}

/** 逐个公众号取文章（间隔 2 秒，免得触发频率限制）；登录失效或被限制时停下并记下状态 */
export async function fetchWechat(): Promise<NewsFeed> {
  const s = load()
  const feed: NewsFeed = { items: [], failed: [], hidden: 0, fetchedAt: Date.now() }
  const state = await getState()
  if (state.status !== 'ok' || !s.accounts.length) return feed
  for (const [i, account] of s.accounts.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 2000))
    try {
      feed.items.push(...(await articlesOf(account)))
      account.error = undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      account.error = message
      feed.failed.push({ from: account.name, message })
      if (error instanceof WereadError && error.kind === 'expired') s.expired = true
      if (error instanceof WereadError && error.kind === 'limited') s.limitedUntil = Date.now() + DAY
      if (error instanceof WereadError && error.kind !== 'other') break
    }
  }
  await save(s)
  feed.items.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))
  return feed
}
