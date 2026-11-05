import { create } from 'zustand'
import type { XkCourse, XkSection } from '@shared/xk'
import { errorText } from './TeacherSheet'

// 选课界面的数据层：各门课的教学班与查老师评分。
// 教学班按需取（列表里看到的课、展开的课；开了按教学班筛选 / 排序时取当前列表全部），同时最多 3 个请求，
// 结果在内存里留 3 分钟（余量会变）；评分攒一小批再经 cls:ratings 一次查本地索引

export type Loaded<T> = { data: T } | { error: string }

const TTL = 3 * 60_000
const CONCURRENCY = 3

interface Entry {
  at: number
  value: Loaded<XkSection[]>
}

interface XkData {
  sections: Record<string, Entry>
  /** 姓名|学院 → 评分；null 为查不到 */
  ratings: Record<string, number | null>
  /** 正在排队或请求中的数量，界面据此画进度 */
  queued: number
}

export const useXkData = create<XkData>(() => ({ sections: {}, ratings: {}, queued: 0 }))

export const courseKey = (c: Pick<XkCourse, 'tab' | 'pool'>): string => `${c.tab}|${c.pool}`
export const ratingKey = (name: string, college: string): string => `${name}|${college}`

const queue: XkCourse[] = []
/** 取过教学班的课，选课 / 退课后按教学班号找回来重取 */
const known = new Map<string, XkCourse>()
const inflight = new Set<string>()
let running = 0

const fresh = (key: string): boolean => {
  const e = useXkData.getState().sections[key]
  return !!e && 'data' in e.value && Date.now() - e.at < TTL
}

const syncCount = (): void => useXkData.setState({ queued: queue.length + running })

/** 请求一批课的教学班；front 为当前看得见的课，插到队首；force 忽略缓存（选课 / 退课后重取余量） */
export function requestSections(courses: XkCourse[], { front = false, force = false } = {}): void {
  for (const c of front ? [...courses].reverse() : courses) {
    const key = courseKey(c)
    known.set(key, c)
    if (inflight.has(key) || (!force && fresh(key))) continue
    const at = queue.findIndex((q) => courseKey(q) === key)
    if (at >= 0) {
      if (!front) continue
      queue.splice(at, 1)
    }
    if (front) queue.unshift(c)
    else queue.push(c)
  }
  pump()
}

function pump(): void {
  while (running < CONCURRENCY && queue.length) {
    const c = queue.shift()!
    const key = courseKey(c)
    inflight.add(key)
    running++
    window.zju['xk:sections'](c)
      .then(
        (data) => {
          useXkData.setState((s) => ({ sections: { ...s.sections, [key]: { at: Date.now(), value: { data } } } }))
          wantRatings(data.flatMap((x) => x.teachers.map((t) => ratingKey(t, c.college))))
        },
        (e) => useXkData.setState((s) => ({ sections: { ...s.sections, [key]: { at: Date.now(), value: { error: errorText(e) } } } }))
      )
      .finally(() => {
        inflight.delete(key)
        running--
        pump()
      })
  }
  syncCount()
}

const wanted = new Set<string>()
let ratingTimer: ReturnType<typeof setTimeout> | undefined

/** 评分攒 200 毫秒一批；查过的不再查 */
export function wantRatings(keys: string[]): void {
  const known = useXkData.getState().ratings
  for (const k of keys) if (!(k in known)) wanted.add(k)
  if (!wanted.size || ratingTimer) return
  ratingTimer = setTimeout(() => {
    ratingTimer = undefined
    const batch = [...wanted]
    wanted.clear()
    const list = batch.map((k) => {
      const [name, college] = k.split('|')
      return { name, college }
    })
    // 先记成查不到，避免重复请求；结果回来再覆盖
    useXkData.setState((s) => ({ ratings: { ...Object.fromEntries(batch.map((k) => [k, null])), ...s.ratings } }))
    window.zju['cls:ratings'](list).then(
      (r) => useXkData.setState((s) => ({ ratings: { ...s.ratings, ...r } })),
      () => undefined
    )
  }, 200)
}

/** 选课 / 退课后重取含这个教学班的课（余量、待定变了） */
export function refreshSection(sectionId: string): void {
  const { sections } = useXkData.getState()
  const hits = Object.entries(sections).flatMap(([key, e]) => ('data' in e.value && e.value.data.some((s) => s.id === sectionId) && known.get(key)) || [])
  if (hits.length) requestSections(hits, { front: true, force: true })
}

/** 登录变化时清空 */
export function resetXkData(): void {
  queue.length = 0
  known.clear()
  useXkData.setState({ sections: {}, queued: running })
}

/** 一个教学班的评分：几位老师里最高的；都查不到为 null，还没查为 undefined */
export function sectionRating(s: XkSection, college: string, ratings: Record<string, number | null>): number | null | undefined {
  let best: number | null | undefined
  for (const t of s.teachers) {
    const r = ratings[ratingKey(t, college)]
    if (r === undefined) continue
    if (r !== null && (best === undefined || best === null || r > best)) best = r
    else if (best === undefined) best = null
  }
  return best
}

/** 选上的人数：容量减余量（报满后超出的也算上） */
export const enrolledOf = (s: XkSection): number | null =>
  s.capacity === null || s.remaining === null ? null : s.capacity - s.remaining + (s.over ?? 0)

/** 选中概率：余量 ÷ 待定人数，封顶 1；不知道余量或待定人数时为 null */
export function chanceOf(s: XkSection): number | null {
  if (s.remaining === null || s.pending === null) return null
  if (s.remaining === 0) return 0
  return s.pending === 0 ? 1 : Math.min(1, s.remaining / s.pending)
}

export const percent = (x: number): string => `${Math.round(x * 100)}%`
