// 浙大紫金港作息：每节的开始、结束时刻（分钟数，自 0 点起）
const PERIODS: [string, string][] = [
  ['08:00', '08:45'],
  ['08:50', '09:35'],
  ['10:00', '10:45'],
  ['10:50', '11:35'],
  ['11:40', '12:25'],
  ['13:25', '14:10'],
  ['14:15', '15:00'],
  ['15:05', '15:50'],
  ['16:15', '17:00'],
  ['17:05', '17:50'],
  ['18:50', '19:35'],
  ['19:40', '20:25'],
  ['20:30', '21:15']
]

export const PERIOD_COUNT = PERIODS.length

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export const periodStart = (p: number): string => PERIODS[p - 1][0]
export const periodEnd = (p: number): string => PERIODS[p - 1][1]

/** 课程相对此刻的状态 */
export function classState(start: number, end: number, now = new Date()): 'past' | 'now' | 'later' {
  const minutes = now.getHours() * 60 + now.getMinutes()
  if (minutes >= toMinutes(periodEnd(end))) return 'past'
  if (minutes >= toMinutes(periodStart(start))) return 'now'
  return 'later'
}
