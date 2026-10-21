import type { CourseSession, LectureReplay, TermCalendar } from '@shared/types'

const pad = (n: number): string => String(n).padStart(2, '0')

/** 本地日期 → YYYY-MM-DD */
export const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const parseYmd = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** 该日期所在周的周一 */
export const mondayOf = (d: Date): Date => addDays(d, -((d.getDay() + 6) % 7))

/** 1 = 周一 … 7 = 周日 */
export const weekdayOf = (d: Date): number => ((d.getDay() + 6) % 7) + 1

const daysBetween = (a: string, b: string): number => Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86_400_000)

/** 某天属于哪个半学期的第几教学周；不在学期内返回 null */
export function teachingWeek(cal: TermCalendar, date: string): { half: string; week: number } | null {
  const half = cal.halves.find((h) => h.start <= date && date <= h.end)
  return half ? { half: half.name, week: Math.floor(daysBetween(half.start, date) / 7) + 1 } : null
}

/** 某天实际要上的课：节假日停课；调课日按被跟随那天的星期与教学周排课 */
export function sessionsOn(cal: TermCalendar, sessions: CourseSession[], date: string): CourseSession[] {
  if (cal.holidays[date]) return []
  const effective = cal.exchanges.find((e) => e.date === date)?.follows ?? date
  const tw = teachingWeek(cal, effective)
  if (!tw) return []
  const weekday = weekdayOf(parseYmd(effective))
  return sessions.filter(
    (s) =>
      s.weekday === weekday &&
      s.semesterPart.includes(tw.half) &&
      tw.week >= s.weekRange[0] &&
      tw.week <= s.weekRange[1] &&
      (s.weekParity === 'all' || (s.weekParity === 'odd') === (tw.week % 2 === 1))
  )
}

const norm = (name: string): string =>
  name
    .replace(/\s/g, '')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')

/** 课表上的一节课 → 智云对应课次：同日、同名、节次有重叠 */
export function findLecture(lectures: LectureReplay[], session: CourseSession, date: string): LectureReplay | undefined {
  const candidates = lectures.filter((l) => l.date === date && norm(l.courseName) === norm(session.name))
  return (
    candidates.find((l) => l.startPeriod === undefined || (l.startPeriod <= session.endPeriod && (l.endPeriod ?? l.startPeriod) >= session.startPeriod)) ??
    candidates[0]
  )
}
