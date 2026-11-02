import type { XkSection, XkSlot } from '@shared/xk'

// 选课的志愿结构与冲突判断。
// 志愿组：普通课同一门课的几个教学班为一组（1/2/3 志愿，最终最多选上一个）；通识按上课时间分组，同一时间的不同课程互为备选。
// 同组之间互为备选，不算冲突；不同组之间按 学期段（秋 / 冬 / 秋冬…）、星期、节次、单双周判断是否撞上。

const WEEK = '一二三四五六日'

/** 学期段是否重叠：秋冬 与 秋、冬 都重叠；缺失时按重叠算 */
const halves = (part: string): string[] => [...part].filter((ch) => '秋冬春夏'.includes(ch))
export const halvesOverlap = (a: string, b: string): boolean => {
  const x = halves(a)
  const y = halves(b)
  return !x.length || !y.length || x.some((ch) => y.includes(ch))
}

export const slotsOverlap = (a: XkSlot, b: XkSlot): boolean =>
  a.weekday === b.weekday &&
  a.start <= b.end &&
  b.start <= a.end &&
  !((a.parity === 'odd' && b.parity === 'even') || (a.parity === 'even' && b.parity === 'odd'))

export const sectionsOverlap = (a: XkSection, b: XkSection): boolean =>
  halvesOverlap(a.semesterPart, b.semesterPart) && a.slots.some((x) => b.slots.some((y) => slotsOverlap(x, y)))

/** 志愿里每组「领头」的那个：已选上的，或第一志愿；只有它真正占时间，后面的志愿是备选 */
export const isLead = (s: XkSection): boolean => s.state === 'selected' || (s.order ?? 1) === 1

/** 冲突的轻重：hard 与已选上的课冲突，lead 与别组第一志愿冲突，backup 只与别组的备选冲突 */
export type ClashLevel = 'hard' | 'lead' | 'backup'

export interface Clash {
  section: XkSection
  level: ClashLevel
}

const LEVEL: Record<ClashLevel, number> = { hard: 0, lead: 1, backup: 2 }

/** 与志愿里其他组的冲突（同组互为备选不算），按轻重排序，同一门课只留最重的一条 */
export function clashesOf(section: XkSection, chosen: XkSection[], group: string): Clash[] {
  const byCourse = new Map<string, Clash>()
  for (const other of chosen) {
    if (other.id === section.id || (other.group ?? other.courseCode) === group || !sectionsOverlap(section, other)) continue
    const level: ClashLevel = other.state === 'selected' ? 'hard' : isLead(other) ? 'lead' : 'backup'
    const prev = byCourse.get(other.courseCode)
    if (!prev || LEVEL[level] < LEVEL[prev.level]) byCourse.set(other.courseCode, { section: other, level })
  }
  return [...byCourse.values()].sort((a, b) => LEVEL[a.level] - LEVEL[b.level])
}

/** 教学班加入志愿后会落在哪个组：已有同课志愿就跟它同组；通识按第一段上课时间 */
export function groupFor(section: XkSection, chosen: XkSection[], general: boolean): string {
  const same = chosen.find((s) => s.courseCode === section.courseCode)
  if (same?.group) return same.group
  const slot = section.slots[0]
  return general && slot ? `通识 周${WEEK[slot.weekday - 1]}${slot.start}-${slot.end}节` : section.courseCode
}

export interface PrefGroup {
  key: string
  /** 通识的时间组（组里可以是不同课程） */
  byTime: boolean
  items: XkSection[]
  selected: boolean
}

/** 志愿按组归拢，组内按志愿次序；已选上的组排前面，其余按第一志愿的上课时间 */
export function groupChosen(chosen: XkSection[]): PrefGroup[] {
  const map = new Map<string, XkSection[]>()
  for (const s of chosen) {
    const key = s.group ?? s.courseCode
    map.set(key, [...(map.get(key) ?? []), s])
  }
  const firstSlot = (g: PrefGroup): number => {
    const t = g.items[0]?.slots[0]
    return t ? t.weekday * 100 + t.start : 9999
  }
  return [...map.entries()]
    .map(([key, items]) => ({
      key,
      byTime: items.some((s) => s.courseCode !== key) || key.startsWith('通识'),
      items: items.sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
      selected: items.some((s) => s.state === 'selected')
    }))
    .sort((a, b) => Number(b.selected) - Number(a.selected) || firstSlot(a) - firstSlot(b))
}

/** 周一 3–5；单节写一个数 */
export const slotLabel = (s: XkSlot): string => `周${WEEK[s.weekday - 1]} ${s.start === s.end ? s.start : `${s.start}–${s.end}`}`

export const parityLabel = (s: XkSlot): string | null => (s.parity === 'odd' ? '单周' : s.parity === 'even' ? '双周' : null)

/** 只上半学期的课：秋 / 冬 / 春 / 夏（整学期返回 null） */
export const halfOf = (part: string): string | null => {
  const halves = [...part].filter((ch) => '秋冬春夏'.includes(ch))
  return halves.length === 1 ? halves[0] : null
}

/** 时间组的标题：通识 + 第一段时间 */
export const groupTitle = (g: PrefGroup): string => {
  const slot = g.items[0]?.slots[0]
  return slot ? `通识 ${slotLabel(slot)} 节` : g.key
}
