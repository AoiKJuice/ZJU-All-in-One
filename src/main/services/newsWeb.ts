import type { NewsArticle, NewsFeed, NewsItem, NewsSettings, WebSource } from '@shared/news'
import { zjuFetch } from '../http'
import { logDiagnostic } from '../diagnostics'
import { parseArticle, parseList } from './newsWebplus'
import { isCampusHost, unwebvpn, webvpnUrl } from './newsWebvpn'
import { judgeByRules } from './newsFilter'
import { WEB_SOURCES } from './newsSources'

// 校园资讯 · 来源 B：部处与学院官网栏目。来源表见 newsSources.ts（scripts/news-sources.mjs 生成，部处手工整理），
// 列表页按 newsWebplus 的通用规则解析；校内域名直连失败或取到的不是列表页（校外）时改走 WebVPN（用保存的账号登录，未实测）。
// 每个栏目只取第一页（最近十几条），合并后按日期排序、按地址去重，再按规则去掉面向教职工的（newsFilter）

const TIMEOUT = 15_000
/** 直连等得短些：校外连校内专用地址时常一直挂着，早点改走 WebVPN */
const DIRECT_TIMEOUT = 8_000
const FRESH = 10 * 60_000
/** 只看近 120 天的条目 */
const RECENT_DAYS = 120

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('超时')), ms))])

const HEADERS = { Accept: 'text/html,application/xhtml+xml,*/*' }

/** 经 WebVPN 取校内页面（校外时多数部处网站只有 WebVPN 进得去）。WebVPN 与统一身份认证是两套账号，应用不替用户登录 */
async function viaWebvpn(url: string): Promise<string> {
  const r = await withTimeout(zjuFetch(await webvpnUrl(url), { headers: HEADERS, relogin: false }), TIMEOUT)
  const landed = new URL(r.url)
  if (landed.hostname === 'zjuam.zju.edu.cn' || /^\/login/.test(landed.pathname)) throw new Error('WebVPN 未登录')
  if (r.status >= 400) throw new Error(`WebVPN HTTP ${r.status}`)
  return unwebvpn(await r.text())
}

/** 校内专用网站对校外来的请求回的页面（403，「该网站仅限校内,请使用webvpn访问」） */
const OFF_CAMPUS = /仅限校内|accessible by campus/

/** 直连失败的原因说成人话：界面按原因归组，用户据此能看出是网络没走校内，而不是笼统的"没读到" */
function reasonOf(error: unknown): string {
  const m = error instanceof Error ? error.message : String(error)
  if (/resolve host|NAME_NOT_RESOLVED|No address associated|ENOTFOUND/i.test(m)) return '解析不到域名'
  if (m === '超时' || /timed? ?out|TIMED_OUT/i.test(m)) return '连接超时'
  if (/refused|unreachable|CONNECTION_|ENETUNREACH|ECONNRESET/i.test(m)) return '连不上'
  return m
}

/** 直连；校内域名直连失败，或取到的不是这个页面（校外时被解析到 WebVPN 或别处，判断交给 usable）时走 WebVPN */
async function loadPage(url: string, usable: (html: string) => boolean = () => true): Promise<{ url: string; html: string }> {
  let direct: { url: string; html: string } | null = null
  let reason = ''
  try {
    const r = await withTimeout(zjuFetch(url, { headers: HEADERS, relogin: false }), DIRECT_TIMEOUT)
    const html = await r.text()
    if (OFF_CAMPUS.test(html)) throw new Error('仅限校内访问')
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`)
    direct = { url: r.url, html }
    if (usable(html)) return direct
    if (new URL(r.url).hostname === 'webvpn.zju.edu.cn') reason = '被转到 WebVPN 登录页'
  } catch (e) {
    reason = reasonOf(e)
  }
  if (!isCampusHost(url)) {
    if (direct) return direct
    throw new Error(reason)
  }
  try {
    return { url, html: await viaWebvpn(url) }
  } catch (e) {
    // WebVPN 也不行：直连拿到过正常页面就交给上层照常判断，否则直连与 WebVPN 的原因一起报
    if (direct && !reason) return direct
    throw new Error(`${reason || '页面里没有列表'}（${reasonOf(e)}）`)
  }
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        try {
          out[i] = { status: 'fulfilled', value: await fn(items[i]) }
        } catch (reason) {
          out[i] = { status: 'rejected', reason }
        }
      }
    })
  )
  return out
}

export const allSources = (): WebSource[] => WEB_SOURCES

/** 默认关注：全部部处 */
export const defaultSources = (): string[] => WEB_SOURCES.filter((s) => s.kind === 'office').map((s) => s.id)

const label = (s: WebSource): string => `${s.org} · ${s.column}`

/** 同一通知常同时挂在几个栏目、几个部处（学工部「最新通知」与「活动预告」、团委与研工部……）：
 *  标题去掉空白与标点后相同的只留最新、排在前面的那条 */
function sameTitleOnce(): (item: NewsItem) => boolean {
  const seen = new Set<string>()
  return (item) => {
    const key = item.title.replace(/[\s\p{P}\p{S}]/gu, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
}

let cached: { key: string; feed: NewsFeed } | null = null

export async function fetchWebFeed(settings: NewsSettings, force = false): Promise<NewsFeed> {
  const chosen = WEB_SOURCES.filter(
    (s) => settings.sources.includes(s.id) && (settings.audience === 'all' || s.audience === 'all' || s.audience === settings.audience)
  )
  const key = chosen.map((s) => s.id).join(',')
  if (!force && cached && cached.key === key && Date.now() - cached.feed.fetchedAt < FRESH) return cached.feed

  const results = await pool(chosen, 6, async (s) => {
    const page = await loadPage(s.url, (html) => parseList(html, s.url).entries.length > 0)
    return { source: s, entries: parseList(page.html, page.url).entries }
  })
  const failed: NewsFeed['failed'] = []
  const seen = new Set<string>()
  const items: NewsItem[] = []
  const cutoff = Date.now() - RECENT_DAYS * 86_400_000
  results.forEach((r, i) => {
    const s = chosen[i]
    if (r.status === 'rejected') {
      failed.push({ from: label(s), message: r.reason instanceof Error ? r.reason.message : String(r.reason) })
      return
    }
    if (!r.value.entries.length) failed.push({ from: label(s), message: '页面结构变了，没读到条目' })
    for (const e of r.value.entries) {
      if (e.date && Date.parse(e.date) < cutoff) continue
      const dedupe = e.url.replace(/^https?:/, '')
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      items.push({ id: `web:${s.id}:${dedupe}`, kind: 'web', title: e.title, url: e.url, time: e.date, from: label(s), sourceId: s.id, audience: s.audience })
    }
  })
  if (failed.length) logDiagnostic('news-web', { failed: failed.length, sources: chosen.length })

  const kept = items
    .filter((item) => judgeByRules(item.title) !== 'drop')
    .sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))
    .filter(sameTitleOnce())
  const feed: NewsFeed = { items: kept, failed, hidden: items.length - kept.length, fetchedAt: Date.now() }
  cached = { key, feed }
  return feed
}

/** 应用内阅读：只读校内页面（*.zju.edu.cn）与公众号文章 */
export async function fetchArticle(url: string): Promise<NewsArticle> {
  const host = new URL(url).hostname
  if (!host.endsWith('.zju.edu.cn') && host !== 'mp.weixin.qq.com') throw new Error('只能打开校内网页与公众号文章')
  const page = await loadPage(url, (html) => parseArticle(html).text.length > 40)
  return parseArticle(page.html)
}
