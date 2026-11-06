// 部处 / 学院官网的通用解析（多数站点是 WebPlus CMS，少数是博达 VSB 与本科生院的 redir.php）。
// 只做字符串处理、不 import 任何模块：桌面、安卓与生成来源表的 scripts/news-sources.mjs（Node 直接加载 .ts）共用。
//
// WebPlus 的列表页：栏目名在 `<li class="col_title"><h2>…</h2>`，面包屑在 `col_path`；条目是
// `<li class="news n1"><span class="news_title"><a href='/2026/1030/c30845a3221066/page.htm' title='标题'>…</a></span><span class="news_meta">2026-10-30</span></li>`，
// 地址里的 /2026/1030/ 是建稿日期，news_meta 才是发布日期（两者可差几个月）。静态 list.htm 没生成时会跳到动态 list.psp。

export interface WebLink {
  name: string
  url: string
}

export interface WebEntry {
  title: string
  url: string
  /** YYYY-MM-DD；列表上没写日期时取 WebPlus 地址里的建稿日期，都没有为 null */
  date: string | null
}

export interface WebListPage {
  /** 栏目名（col_title / 标题），认不出为 null */
  column: string | null
  /** 面包屑上级栏目名（不含首页与本栏目） */
  parents: string[]
  entries: WebEntry[]
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', hellip: '…' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
      return Number.isFinite(n) ? String.fromCodePoint(n) : all
    }
    return ENTITIES[code.toLowerCase()] ?? all
  })
}

/** 去标签、解实体、压空白 */
export function plainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t　 ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

const oneLine = (html: string): string => plainText(html).replace(/\s+/g, ' ').trim()

function absolute(href: string, base: string): string | null {
  const h = decodeEntities(href.trim())
  if (!h || h.startsWith('#') || /^(javascript|mailto|tel):/i.test(h)) return null
  try {
    return new URL(h, base).href
  } catch {
    return null
  }
}

const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
const attr = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs)
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined
}

/** 页面上的全部链接（去重，名称取锚文字，没有时取 title） */
export function links(html: string, base: string): WebLink[] {
  const out = new Map<string, WebLink>()
  for (const m of html.matchAll(ANCHOR)) {
    const url = absolute(attr(m[1], 'href') ?? '', base)
    if (!url) continue
    const name = oneLine(m[2]) || decodeEntities(attr(m[1], 'title') ?? '').trim()
    if (name && !out.has(url)) out.set(url, { name, url })
  }
  return [...out.values()]
}

/** 是不是栏目列表页的地址（WebPlus 的 /xxx/list.htm、list.psp，带分页的 list2.htm） */
export const isColumnUrl = (url: string): boolean => /\/list\d*\.(htm|psp)(\?|$)/i.test(url) || /redir\.php\?catalog_id=\d+$/i.test(url)

/** 文章地址：WebPlus /2026/1030/c123a456/page.htm、VSB /info/123/456.htm、本科生院 redir.php?catalog_id&object_id、公众号文章 */
const ARTICLE = /\/c\d+a\d+\/page\.(htm|psp)|\/info\/\d+\/\d+\.htm|redir\.php\?catalog_id=\d+&(amp;)?object_id=\d+|mp\.weixin\.qq\.com\/s|\/content\.jsp\?|\/article\/|\/detail\//i

const pad = (n: string | number): string => String(n).padStart(2, '0')

function dateIn(chunk: string): string | null {
  const text = plainText(chunk)
  let m = /(20\d{2})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})/.exec(text)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  // 日、年月分开写的：<span class="day">03</span><span class="ym">2026-11</span>
  m = /(?:^|\D)(\d{1,2})\s+(20\d{2})[-./](\d{1,2})(?:\D|$)/.exec(text)
  if (m) return `${m[2]}-${pad(m[3])}-${pad(m[1])}`
  m = /(20\d{2})[-./](\d{1,2})\s+(\d{1,2})(?:\D|$)/.exec(text)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  // 只写月日（当年）
  m = /(?:^|[^\d-])(\d{1,2})-(\d{1,2})(?:[^\d-]|$)/.exec(text)
  if (m && Number(m[1]) <= 12 && Number(m[2]) <= 31) {
    // 只写月日：默认当年，晚于今天的算去年
    const year = new Date().getFullYear()
    const date = `${year}-${pad(m[1])}-${pad(m[2])}`
    return future(date) ? `${year - 1}-${pad(m[1])}-${pad(m[2])}` : date
  }
  return null
}

/** 晚于明天：多半是列表上写的活动日期而非发布日期 */
const future = (date: string): boolean => Date.parse(date) > Date.now() + 86_400_000

function urlDate(url: string): string | null {
  const m = /\/(20\d{2})\/(\d{2})(\d{2})\/c\d+a\d+\//.exec(url)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function column(html: string): string | null {
  const m = /class=["'][^"']*col_title[^"']*["'][^>]*>([\s\S]{0,200}?)<\/(li|div|h\d|span)>/i.exec(html)
  const fromCol = m ? oneLine(m[1]) : ''
  if (fromCol) return fromCol
  const t = /<title>([\s\S]*?)<\/title>/i.exec(html)
  if (!t) return null
  const title = oneLine(t[1]).split(/[-_|－—]/)[0].trim()
  return title || null
}

function breadcrumb(html: string, base: string): string[] {
  const m = /(?:col_path|当前位置|您的位置|position|breadcrumb)([\s\S]{0,1200}?)<\/(ul|div|li|p)>/i.exec(html)
  if (!m) return []
  const names = links(m[1], base).map((l) => l.name)
  return names.filter((n) => !/^(首页|主页|home)$/i.test(n)).slice(0, -1)
}

/** 解析栏目列表页：一段 <li> / <tr> 里有文章链接的算一条 */
export function parseList(html: string, base: string): WebListPage {
  const entries = new Map<string, WebEntry>()
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  for (const part of body.split(/<(?:li|tr|dd)[\s>]/i).slice(1)) {
    const chunk = part.split(/<\/(?:li|tr|dd)>/i)[0]
    for (const m of chunk.matchAll(ANCHOR)) {
      const url = absolute(attr(m[1], 'href') ?? '', base)
      if (!url || !ARTICLE.test(url)) continue
      const title = (decodeEntities(attr(m[1], 'title') ?? '').trim() || oneLine(m[2])).replace(/\s+/g, ' ')
      if (title.length < 4) continue
      const listed = dateIn(chunk)
      const date = listed && future(listed) ? (urlDate(url) ?? listed) : (listed ?? urlDate(url))
      if (!entries.has(url)) entries.set(url, { title, url, date })
      break
    }
  }
  return { column: column(html), parents: breadcrumb(html, base), entries: [...entries.values()] }
}

/**
 * 入口页（选择语言、或「中文网 / 办公网 / English」几个入口，常是图片链接；或脚本 / meta 跳转）：返回中文网与办公网的入口，
 * 本身就是带栏目的首页时返回空数组
 */
export function entryLinks(html: string, base: string): string[] {
  const jump = /(?:location(?:\.href)?\s*=\s*|http-equiv=["']?refresh["']?[^>]*url=)["']?([^"'\s;>]+)/i.exec(html)
  const all = links(html, base)
  if (all.filter((l) => isColumnUrl(l.url)).length >= 6) return []
  const host = new URL(base).hostname.replace(/^www\./, '')
  const out = new Set<string>()
  if (jump) {
    const u = absolute(jump[1], base)
    if (u) out.add(u)
  }
  const anchors = [...html.matchAll(ANCHOR)].map((m) => ({ url: absolute(attr(m[1], 'href') ?? '', base), name: oneLine(m[2]) }))
  for (const a of anchors) {
    if (!a.url) continue
    const u = new URL(a.url)
    const sameOrg = u.hostname.replace(/^www\./, '').endsWith(host) || host.endsWith(u.hostname.replace(/^www\./, ''))
    if (!sameOrg || /english|\/en\/|\/eng|_en\b|mobile/i.test(a.url) || /english/i.test(a.name)) continue
    if (/(^|\/)main\.(htm|psp)$/i.test(u.pathname) || /^(中文|中文版|简体中文|中文网站?|chinese|办公网)$/i.test(a.name)) out.add(a.url)
  }
  return [...out].filter((u) => u.replace(/\/$/, '') !== base.replace(/\/$/, ''))
}

/** 文章正文：WebPlus 的 wp_articlecontent / v_news_content / 公众号 js_content，取不到时为整页文字 */
export function parseArticle(html: string): { title: string | null; text: string } {
  const t = /class=["'][^"']*(?:arti_title|article-title|news_title|title)[^"']*["'][^>]*>([\s\S]{0,300}?)<\//i.exec(html)
  const zone = /class=["'][^"']*(?:wp_articlecontent|v_news_content|article-content|js_content|rich_media_content)[^"']*["'][^>]*>([\s\S]*)/i.exec(html)
  const raw = zone ? zone[1].split(/<div[^>]*class=["'][^"']*(?:wp_entry|page_nav|arti_bottom|footer)/i)[0] : html
  return { title: t ? oneLine(t[1]) || null : null, text: plainText(raw).slice(0, 20000) }
}

/** 页面声明的编码（meta charset），认不出为 utf-8 */
export function charsetOf(head: string): string {
  const m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)
  return m ? m[1].toLowerCase() : 'utf-8'
}
