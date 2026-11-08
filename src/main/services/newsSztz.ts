import type { NewsFeed, NewsItem, SztzActivity } from '@shared/news'
import { fetchActivityPage, fetchNoticePage, fileUrl, type TzggRecord, type XmRecord } from './sztz'
import { plainText } from './newsWebplus'

// 校园资讯 · 来源 A：素拓数智平台。组织单位开展记点活动前须在平台立项（浙大发本〔2024〕6 号第 12 条），
// 这里是唯一能读到的官方活动登记库；不记点的活动、社团内部活动与招新不会出现。接口见 sztz.ts 末尾

const MAX_PAGES = 6

/** 平台时间 → ISO 北京时间。带时区的（实测接口给的是 UTC，如「…T16:00:00.000+0000」）按时区换算；
 *  不带时区的「2026-11-06 14:00:00」按北京时间。曾把前者的时区丢掉，所有时间早了 8 小时 */
function iso(value?: string | null): string | null {
  if (!value) return null
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())
  const m = zoned ? null : /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value)
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}+08:00`
  const d = new Date(value.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  if (Number.isNaN(d.getTime())) return null
  const bj = new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 19)
  return `${bj}+08:00`
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
    // 9999 是平台上「不限人数」的写法
    quota: r.zmrs && Number(r.zmrs) < 9999 ? Number(r.zmrs) : null,
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

/** 活动：逐页取到平台说的总页数（最多 6 页、120 个）。排序：正在报名（按截止早晚）→ 还没开始报名（按开始报名）
 *  → 报名已截止但活动没结束（按活动开始）→ 已结束。真实数据里大半是报名已截止的，原先按截止时间排时它们全堆在最前面 */
export async function fetchActivities(keyword = ''): Promise<SztzActivity[]> {
  const all: SztzActivity[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, totalPages } = await fetchActivityPage(page, keyword)
    all.push(...data.map(toActivity))
    if (!data.length || page >= totalPages) break
  }
  const now = Date.now()
  const t = (v: string | null): number => (v ? Date.parse(v) : NaN)
  const rank = (a: SztzActivity): [number, number] => {
    if (a.end && t(a.end) < now) return [3, -t(a.end)]
    const open = Number.isNaN(t(a.signupStart)) || t(a.signupStart) <= now
    const closed = !Number.isNaN(t(a.signupEnd)) && t(a.signupEnd) < now
    if (open && !closed) return [0, t(a.signupEnd) || Infinity]
    if (!open) return [1, t(a.signupStart)]
    return [2, t(a.start) || Infinity]
  }
  const seen = new Set<string>()
  return all
    .filter((a) => a.id && !seen.has(a.id) && seen.add(a.id))
    .map((a) => [a, rank(a)] as const)
    .sort((x, y) => x[1][0] - y[1][0] || x[1][1] - y[1][1])
    .map(([a]) => a)
}

function toNotice(r: TzggRecord, i: number): NewsItem {
  const body = text(r.nr)
  return {
    id: `sztz:tzgg:${r.id ?? `${r.fbsj}-${i}`}`,
    kind: 'sztz',
    title: r.mc?.trim() ?? '',
    time: iso(r.fbsj),
    // fbr 是发布者的平台账号（如「STS261/某某」），不显示
    from: '素拓平台',
    text: body.slice(0, 4000),
    // 附件只能在平台上下载
    url: 'https://sztz.zju.edu.cn/dekt/'
  }
}

export async function fetchSztzNotices(): Promise<NewsFeed> {
  const { data } = await fetchNoticePage(1, 30)
  return { items: data.map(toNotice).filter((n) => n.title), failed: [], hidden: 0, fetchedAt: Date.now() }
}
