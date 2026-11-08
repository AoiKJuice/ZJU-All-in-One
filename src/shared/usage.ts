// 数据统计：图书馆时长、提交作业数、提交时点。发给界面的是按天聚合后的数字，外加最紧张那一次的作业标题。
// 这里是不碰网络的纯计算，桌面、安卓与演示数据共用

/** 热图的周数：本周（可能没过完）加前 52 周 */
export const HEAT_WEEKS = 53

const DAY = 864e5

/** 某一时刻在北京时间是哪一天（YYYY-MM-DD） */
export const beijingDay = (ms: number): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(ms))

const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`)

export const shiftDay = (day: string, offset: number): string => new Date(dayMs(day) + offset * DAY).toISOString().slice(0, 10)

/** 热图第一格：today 所在周（周一开始）往前 weeks − 1 周的周一 */
export function heatStart(today: string, weeks = HEAT_WEEKS): string {
  const weekday = (new Date(dayMs(today)).getUTCDay() + 6) % 7
  return shiftDay(today, -weekday - (weeks - 1) * 7)
}

export interface LibraryUsage {
  /** 日期 → 当天预约时长（小时），没有的日期不出现 */
  days: Record<string, number>
  hours: number
  visits: number
  /** 去得最多的星期（按时长，0 为周一）和那一天累计的小时数；没有记录时为 null */
  favorite: { weekday: number; hours: number } | null
}

export interface SubmitTiming {
  /** 按提交时点分 10 档：0–10%、…、90–100%（截止那一刻算在最后一档） */
  buckets: number[]
  /** 截止之后才交的次数 */
  late: number
  count: number
  /** 0–1；逾期的按 1 计，免得一次补交几个月前的作业把平均数拉飞 */
  median: number | null
  mean: number | null
}

export interface HomeworkUsage {
  /** 日期 → 当天提交次数，没有的日期不出现 */
  days: Record<string, number>
  total: number
  timing: SubmitTiming
  /** 最常在作业的哪个阶段提交（按时长三等分，每项作业算第一次提交） */
  habit: SubmitHabit | null
  /** 离截止最近的一次提交（绝对时间），逾期的不算 */
  closest: { title: string; at: number; left: number } | null
}

export type SubmitHabit = 'early' | 'middle' | 'late'

/** 与 LibBooking 同形：begin / end 为北京时间 YYYY-MM-DD HH:MM */
export interface UsageBooking {
  begin: string
  end: string
  status: string
}

export interface UsageSubmission {
  activityId: string
  title: string
  at: number
  /** 作业开放、截止时刻；取不到时只计入热图，不计入提交时点 */
  open?: number
  end?: number
}

// 状态原文只实测见过「已使用」（Elychron），其余写法是按同类系统推测的：
// 取消、违约一类不算；还没生效的（待签到、预约成功、已预约）也不算，到点后状态会变成别的
const NOT_COUNTED = /取消|违约|失约|爽约|未签|未使用|未入馆|超时|逾期|失效|待|预约成功|已预约/

export const parseBeijing = (s: string): number => Date.parse(`${s.replace(' ', 'T')}:00+08:00`)
const round = (n: number, digits: number): number => Number(n.toFixed(digits))

export function summarizeLibrary(bookings: UsageBooking[], now: number): LibraryUsage {
  const start = heatStart(beijingDay(now))
  const days: Record<string, number> = {}
  let visits = 0
  for (const b of bookings) {
    if (NOT_COUNTED.test(b.status)) continue
    const from = parseBeijing(b.begin)
    // 进行中的预约只算到现在
    const hours = (Math.min(parseBeijing(b.end), now) - from) / 36e5
    if (!Number.isFinite(hours) || hours <= 0) continue
    const day = beijingDay(from)
    if (day < start) continue
    days[day] = (days[day] ?? 0) + hours
    visits++
  }
  for (const day of Object.keys(days)) days[day] = round(days[day], 1)
  return { days, hours: round(Object.values(days).reduce((a, b) => a + b, 0), 1), visits, favorite: favoriteWeekday(days) }
}

/** 周一为 0 */
const weekdayOf = (day: string): number => (new Date(dayMs(day)).getUTCDay() + 6) % 7

function favoriteWeekday(days: Record<string, number>): LibraryUsage['favorite'] {
  const totals = Array.from({ length: 7 }, () => 0)
  for (const [day, hours] of Object.entries(days)) totals[weekdayOf(day)] += hours
  const peak = Math.max(...totals)
  return peak > 0 ? { weekday: totals.indexOf(peak), hours: round(peak, 1) } : null
}

export function summarizeTiming(ratios: number[]): SubmitTiming {
  const buckets = Array.from({ length: 10 }, () => 0)
  let late = 0
  for (const r of ratios) {
    if (r > 1) late++
    else buckets[Math.min(9, Math.floor(Math.max(r, 0) * 10))]++
  }
  const clamped = ratios.map((r) => Math.min(Math.max(r, 0), 1)).sort((a, b) => a - b)
  const n = clamped.length
  const median = n === 0 ? null : n % 2 ? clamped[(n - 1) / 2] : (clamped[n / 2 - 1] + clamped[n / 2]) / 2
  const mean = n === 0 ? null : clamped.reduce((a, b) => a + b, 0) / n
  return { buckets, late, count: n, median: median === null ? null : round(median, 3), mean: mean === null ? null : round(mean, 3) }
}

export function summarizeHomework(submissions: UsageSubmission[], now: number, ignored: ReadonlySet<string> = new Set()): HomeworkUsage {
  const today = beijingDay(now)
  const start = heatStart(today)
  const days: Record<string, number> = {}
  const ratios: number[] = []
  const first = new Map<string, UsageSubmission>()
  let total = 0
  for (const s of submissions) {
    if (ignored.has(s.activityId)) continue
    const day = beijingDay(s.at)
    if (day < start || day > today) continue
    days[day] = (days[day] ?? 0) + 1
    total++
    if (s.open !== undefined && s.end !== undefined && s.end > s.open) ratios.push((s.at - s.open) / (s.end - s.open))
    const earlier = first.get(s.activityId)
    if (!earlier || s.at < earlier.at) first.set(s.activityId, s)
  }
  return { days, total, timing: summarizeTiming(ratios), ...submitHabits([...first.values()]) }
}

/** 每项作业只看第一次提交：早就交了、临截止又改一版不算「临近才交」 */
function submitHabits(submissions: UsageSubmission[]): Pick<HomeworkUsage, 'habit' | 'closest'> {
  const counts: Record<SubmitHabit, number> = { early: 0, middle: 0, late: 0 }
  let closest: HomeworkUsage['closest'] = null
  for (const s of submissions) {
    if (s.end === undefined || s.at > s.end) continue
    const left = s.end - s.at
    if (!closest || left < closest.left) closest = { title: s.title, at: s.at, left }
    if (s.open === undefined || s.end <= s.open) continue
    const ratio = (s.at - s.open) / (s.end - s.open)
    counts[ratio < 1 / 3 ? 'early' : ratio < 2 / 3 ? 'middle' : 'late']++
  }
  const peak = Math.max(counts.early, counts.middle, counts.late)
  const habit = peak === 0 ? null : (['late', 'middle', 'early'] as const).find((k) => counts[k] === peak) ?? null
  return { habit, closest }
}

/** 已取过的提交记录（存本地，见 services/usage.ts） */
export interface SubmissionCache {
  /** 这份记录属于哪个学在浙大账号，换账号时整份作废 */
  owner?: string
  /** 作业 id → 这项作业的提交记录 */
  activities: Record<string, UsageSubmission[]>
  /** 已结课、作业列表不会再变的课程 */
  doneCourses: string[]
}
