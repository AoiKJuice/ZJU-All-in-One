import { PERIOD_TIMES as PERIODS } from '@shared/periods'

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
