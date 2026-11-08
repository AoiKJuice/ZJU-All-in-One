import type { DataResult } from '@shared/types'
import { beijingDay, heatStart, parseBeijing, summarizeHomework, summarizeLibrary, type HomeworkUsage, type LibraryUsage, type SubmissionCache, type UsageBooking, type UsageSubmission } from '@shared/usage'
import { clearSecret, loadSecret, saveSecret } from '../secure'
import { getSubmissionHistory } from './courses'
import { getBookingHistory } from './library'

// 数据统计的取数。取过的记录加密存在本地（usage-history.bin），之后只补新的：
// 图书馆翻到整页都是已存且早已结束的预约就停；作业跳过已结课的课程、已截止且有定论的作业（见 courses.getSubmissionHistory）。
// 这一次的结果在内存里留 10 分钟；被忽略的作业每次现算，不影响存下来的记录

const TTL = 10 * 60_000

function memo<T>(compute: () => Promise<T>): { get: () => Promise<DataResult<T>>; clear: () => void } {
  let entry: { at: number; value: Promise<DataResult<T>> } | undefined
  return {
    get() {
      if (entry && Date.now() - entry.at < TTL) return entry.value
      const at = Date.now()
      const value: Promise<DataResult<T>> = compute().then((data) => ({ data, source: 'live', fetchedAt: Date.now() }))
      const current = { at, value }
      entry = current
      value.catch(() => {
        if (entry === current) entry = undefined
      })
      return value
    },
    clear() {
      entry = undefined
    }
  }
}

const FILE = 'usage-history.bin'
/** 预约结束这么久以后状态才算定下来（是否违约、是否算已使用），之前的每次重取 */
const SETTLE = 2 * 864e5

interface History {
  v: 1
  bookings: Record<string, UsageBooking>
  submissions: SubmissionCache
}

const emptyHistory = (): History => ({ v: 1, bookings: {}, submissions: { activities: {}, doneCourses: [] } })

let history: Promise<History> | undefined
let writing: Promise<unknown> = Promise.resolve()

function loadHistory(): Promise<History> {
  history ??= loadSecret(FILE)
    .then((raw) => {
      const parsed = raw ? (JSON.parse(raw) as History) : null
      return parsed?.v === 1 ? parsed : emptyHistory()
    })
    .catch(() => emptyHistory())
  return history
}

function saveHistory(value: History): Promise<unknown> {
  writing = writing.then(() => saveSecret(FILE, JSON.stringify(value))).catch(() => undefined)
  return writing
}

const library = memo<UsageBooking[]>(async () => {
  const now = Date.now()
  const stored = await loadHistory()
  const settled = (id: string): boolean => {
    const known = stored.bookings[id]
    return !!known && parseBeijing(known.end) < now - SETTLE
  }
  for (const b of await getBookingHistory(heatStart(beijingDay(now)), (b) => settled(b.id))) {
    stored.bookings[b.id] = { begin: b.begin, end: b.end, status: b.status }
  }
  await saveHistory(stored)
  return Object.values(stored.bookings)
})

const homework = memo<UsageSubmission[]>(async () => {
  const now = Date.now()
  const stored = await loadHistory()
  const owner = stored.submissions.owner
  // 窗口第一天的北京时间零点
  const rows = await getSubmissionHistory(Date.parse(`${heatStart(beijingDay(now))}T00:00:00+08:00`), stored.submissions)
  // 换了账号：图书馆的记录也不是这个人的
  if (owner && owner !== stored.submissions.owner) stored.bookings = {}
  await saveHistory(stored)
  return rows
})

export async function fetchLibraryUsage(): Promise<DataResult<LibraryUsage>> {
  const result = await library.get()
  return { ...result, data: summarizeLibrary(result.data, Date.now()) }
}

/** ignored：用户忽略的待办 id（与作业 id 相同），不计入统计 */
export async function fetchHomeworkUsage(ignored: string[]): Promise<DataResult<HomeworkUsage>> {
  const result = await homework.get()
  return { ...result, data: summarizeHomework(result.data, Date.now(), new Set(ignored)) }
}

/** 退出登录时删掉本地记录；自动重登只清内存 */
export function clearHistory(): void {
  history = undefined
  writing = writing.then(() => clearSecret(FILE)).catch(() => undefined)
}

export function reset(): void {
  library.clear()
  homework.clear()
}
