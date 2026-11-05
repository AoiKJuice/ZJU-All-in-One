import type { AuditNode } from '@shared/types'
import type { XkCourse, XkSection } from '@shared/xk'
import { chanceOf, sectionRating } from './xkData'
import { clashesOf, groupFor } from './xkLogic'

// 找课的筛选条件。范围（类别）决定取哪份课程列表；其余条件在本地过滤：
// 课程一级（关键词）直接看课程行，教学班一级（评分、早八、冲突、余量、时间段）要等这门课的教学班取到

/** 范围：一个类别页签 / 一个大类的全部小类 / 搜全部课程 / 培养方案里还没修的必修课 */
export type Scope = { kind: 'cat'; key: string } | { kind: 'group'; id: string } | { kind: 'search' } | { kind: 'plan' }

/** 上午 1–5 / 下午 6–10 / 晚上 11–13 */
export const DAY_PARTS: [number, number][] = [
  [1, 5],
  [6, 10],
  [11, 13]
]
export const DAY_PART_NAMES = ['上午', '下午', '晚上']
export const partOf = (period: number): number => (period <= 5 ? 0 : period <= 10 ? 1 : 2)

export type SortKey = 'default' | 'rating' | 'chance' | 'remaining' | 'credit'
export const SORTS: { id: SortKey; label: string }[] = [
  { id: 'default', label: '默认' },
  { id: 'rating', label: '评分' },
  { id: 'chance', label: '选中概率' },
  { id: 'remaining', label: '余量' },
  { id: 'credit', label: '学分' }
]
export const RATINGS = [0, 7, 8, 9]

export interface Filters {
  scope: Scope | null
  keyword: string
  available: boolean
  noEarly: boolean
  noClash: boolean
  /** 评分下限，0 为不限 */
  minRating: number
  /** 时间段：星期几的上午 / 下午 / 晚上（点课表空白处设定） */
  when: { weekday: number; part: number } | null
  sort: SortKey
}

const STORE = 'xk-find'

/** 关键词与时间段不记；其余记在本机，下次打开照旧 */
export function loadFilters(): Filters {
  const base: Filters = { scope: null, keyword: '', available: false, noEarly: false, noClash: false, minRating: 0, when: null, sort: 'default' }
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Filters> | null
    if (saved) return { ...base, ...saved, keyword: '', when: null }
  } catch {
    // 读不到就用默认
  }
  return base
}

export function saveFilters(f: Filters): void {
  try {
    const { keyword: _k, when: _w, ...rest } = f
    localStorage.setItem(STORE, JSON.stringify(rest))
  } catch {
    // 存不了不影响使用
  }
}

/** 教学班一级的筛选条件 */
export const sectionFilters = (f: Filters): boolean => f.available || f.noEarly || f.noClash || f.minRating > 0 || f.when !== null

/** 需要整份列表的教学班（筛选或按教学班的数据排序） */
export const needsSections = (f: Filters): boolean => sectionFilters(f) || f.sort === 'rating' || f.sort === 'chance' || f.sort === 'remaining'

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '')

export const courseMatches = (c: XkCourse, keyword: string): boolean => {
  const k = norm(keyword)
  return !k || [c.name, c.code, c.displayCode ?? '', c.college].some((x) => norm(x).includes(k))
}

export interface SectionContext {
  chosen: XkSection[]
  general: boolean
  college: string
  ratings: Record<string, number | null>
}

/** 教学班是否满足教学班一级的条件（关键词没对上课程时，按教师名对） */
export function sectionPasses(s: XkSection, f: Filters, ctx: SectionContext, byTeacher: boolean): boolean {
  const mine = ctx.chosen.some((x) => x.id === s.id)
  if (byTeacher && !s.teachers.some((t) => norm(t).includes(norm(f.keyword)))) return false
  if (f.available && !mine && !s.remaining) return false
  if (f.noEarly && s.slots.some((t) => t.start === 1)) return false
  if (f.minRating > 0 && (sectionRating(s, ctx.college, ctx.ratings) ?? 0) < f.minRating) return false
  if (f.when) {
    const [a, b] = DAY_PARTS[f.when.part]
    if (!s.slots.some((t) => t.weekday === f.when!.weekday && t.start <= b && t.end >= a)) return false
  }
  if (f.noClash && !mine) {
    const group = groupFor(s, ctx.chosen, ctx.general)
    if (clashesOf(s, ctx.chosen, group).some((c) => c.level !== 'backup')) return false
  }
  return true
}

export interface CourseView {
  course: XkCourse
  /** undefined：教学班还没取到 */
  sections: XkSection[] | undefined
  /** 满足条件的教学班（排在前面）；其余的淡显 */
  matching: XkSection[]
  rating: number | null
  chance: number | null
  remaining: number | null
}

const maxOf = (xs: (number | null | undefined)[]): number | null => {
  const ns = xs.filter((x): x is number => typeof x === 'number')
  return ns.length ? Math.max(...ns) : null
}

/** 一门课在当前条件下的样子；不满足条件返回 null（教学班还没取到、又需要它判断时也先不显示） */
export function viewCourse(c: XkCourse, sections: XkSection[] | undefined, f: Filters, ctx: SectionContext): CourseView | null {
  const byName = courseMatches(c, f.keyword)
  if (!sections && (!byName || sectionFilters(f))) return null
  const matching = sections ? sections.filter((s) => sectionPasses(s, f, ctx, !byName)) : []
  if (sections && !matching.length) return null
  const basis = sections ? matching : []
  return {
    course: c,
    sections,
    matching,
    rating: maxOf(basis.map((s) => sectionRating(s, ctx.college, ctx.ratings))),
    chance: maxOf(basis.map((s) => (s.state === 'selected' ? null : chanceOf(s)))),
    remaining: sections ? basis.reduce((n, s) => n + (s.remaining ?? 0), 0) : null
  }
}

/** 排序：没有数据的排在后面；同值保持教务给的顺序 */
export function sortViews(views: CourseView[], sort: SortKey): CourseView[] {
  if (sort === 'default') return views
  const value = (v: CourseView): number | null =>
    sort === 'rating' ? v.rating : sort === 'chance' ? v.chance : sort === 'remaining' ? v.remaining : v.course.credit
  return views
    .map((v, i) => ({ v, i, x: value(v) }))
    .sort((a, b) => (a.x === null ? 1 : 0) - (b.x === null ? 1 : 0) || (b.x ?? 0) - (a.x ?? 0) || a.i - b.i)
    .map((x) => x.v)
}

/** 培养方案：还没修完的必修课（本身或上级标为必修），按名称去重；已修过的课程代码与名称 */
export function planOf(nodes: AuditNode[]): { todo: AuditNode[]; done: Set<string> } {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const required = (n: AuditNode): boolean => {
    for (let cur: AuditNode | undefined = n; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (cur.kind?.includes('必修') || (!cur.code && cur.name.includes('必修'))) return true
    }
    return false
  }
  const seen = new Set<string>()
  const todo = nodes.filter((n) => n.code && (n.status === 'none' || n.status === 'failed') && required(n) && !seen.has(n.name) && seen.add(n.name))
  const done = new Set(nodes.filter((n) => n.code && (n.status === 'passed' || n.status === 'replaced')).flatMap((n) => [n.code!, n.name]))
  return { todo, done }
}

/** 课程是否对得上培养方案里的某条（代码、选课页代码或名称） */
export const inPlan = (c: XkCourse, set: Set<string>): boolean => set.has(c.code) || (!!c.displayCode && set.has(c.displayCode)) || set.has(c.name)
