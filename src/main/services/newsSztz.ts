import type { NewsFeed, NewsItem, SztzActivity } from '@shared/news'
import { fetchActivityPage, fetchNoticePage, fileUrl, type TzggRecord, type XmRecord } from './sztz'
import { plainText } from './newsWebplus'

// 校园资讯 · 来源 A：素拓数智平台。组织单位开展记点活动前须在平台立项（浙大发本〔2024〕6 号第 12 条），
// 这里是唯一能读到的官方活动登记库；不记点的活动、社团内部活动与招新不会出现。接口见 sztz.ts 末尾

const MAX_PAGES = 6

/** 平台时间「2026-11-06 14:00:00」→ ISO（北京时间） */
function iso(value?: string | null): string | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value)
  if (!m) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}+08:00`
}

const text = (html?: string | null): string => (html ? plainText(html) : '')

function points(min?: number | string | null, max?: number | string | null): string | null {
  const a = min === null || min === undefined || min === '' ? null : Number(min)
  const b = max === null || max === undefined || max === '' ? null : Number(max)
  if (a === null && b === null) return null
  if (a === null || b === null || a === b) return String(a ?? b)
  return `${a}–${b}`
}

export function toActivity(r: XmRecord): SztzActivity {
  const external = r.bmfs?.value === 3 || /不在本平台/.test(r.bmfs?.label ?? '')
  return {
    id: String(r.id ?? ''),
    title: r.mc?.trim() ?? '',
    org: r.lxdw?.mc ?? '',
    category: [r.xmlb?.mc, r.xmfl?.mc ? `（${r.xmfl.mc}）` : ''].filter(Boolean).join(''),
    type: r.xmlx?.mc ?? '',
    aesthetic: Boolean(r.xmlx?.my),
    labor: Boolean(r.xmlx?.ly),
    start: iso(r.hdkssj),
    end: iso(r.hdjssj),
    signupStart: iso(r.bmkssj),
    signupEnd: iso(r.bmjssj),
    place: r.hddd?.trim() ?? '',
    quota: r.zmrs ? Number(r.zmrs) : null,
    signed: Number(r.bmrs ?? 0),
    points: points(r.zxfs, r.zdfs),
    contact: [r.fzr, r.lxdh].filter(Boolean).join(' '),
    intro: text(r.lxsx),
    notes: text(r.hdzysx),
    signup: r.bmfs?.label ?? '',
    external: external ? text(r.jtbmfs) || null : null,
    poster: r.hdhb ? fileUrl(r.hdhb) : null,
    joined: Boolean(r.sfbm)
  }
}

/** 活动：逐页取到平台说的总页数（最多 6 页、120 个），未结束的按报名截止排前，已结束的放后 */
export async function fetchActivities(keyword = ''): Promise<SztzActivity[]> {
  const all: SztzActivity[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, totalPages } = await fetchActivityPage(page, keyword)
    all.push(...data.map(toActivity))
    if (!data.length || page >= totalPages) break
  }
  const now = Date.now()
  const over = (a: SztzActivity): boolean => (a.end ? Date.parse(a.end) < now : false)
  const key = (a: SztzActivity): number => Date.parse(a.signupEnd ?? a.start ?? '') || Infinity
  const seen = new Set<string>()
  return all
    .filter((a) => a.id && !seen.has(a.id) && seen.add(a.id))
    .sort((a, b) => Number(over(a)) - Number(over(b)) || key(a) - key(b))
}

function toNotice(r: TzggRecord, i: number): NewsItem {
  const body = text(r.nr)
  return {
    id: `sztz:tzgg:${r.id ?? `${r.fbsj}-${i}`}`,
    kind: 'sztz',
    title: r.mc?.trim() ?? '',
    time: iso(r.fbsj),
    from: r.fbr ? `素拓平台 ${r.fbr}` : '素拓平台',
    text: body.slice(0, 4000),
    // 附件只能在平台上下载
    url: 'https://sztz.zju.edu.cn/dekt/'
  }
}

export async function fetchSztzNotices(): Promise<NewsFeed> {
  const { data } = await fetchNoticePage(1, 30)
  return { items: data.map(toNotice).filter((n) => n.title), failed: [], hidden: 0, fetchedAt: Date.now() }
}
