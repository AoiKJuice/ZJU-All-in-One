import type { TermCalendar } from '@shared/types'
import { zjuSession } from '../auth/zjuam'

interface CalendarResponse {
  startEnd: [string, string, string, string]
  holiday: Record<string, string>
  dummy: Record<string, string>
  exchange: Record<string, string>
}

let cached: TermCalendar | undefined

function currentTerm(): { id: string; names: string[] } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric'
  }).formatToParts(new Date())

  const year = Number(parts.find((part) => part.type === 'year')!.value)
  const month = Number(parts.find((part) => part.type === 'month')!.value)
  const startYear = month >= 9 ? year : year - 1
  const first = month >= 9 || month === 1

  return {
    id: `${startYear}-${startYear + 1}-${first ? 1 : 2}`,
    names: first ? ['秋', '冬'] : ['春', '夏']
  }
}

function formatDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

export async function fetchCalendar(): Promise<TermCalendar> {
  const { id, names } = currentTerm()
  if (cached?.id === id) return cached

  const response = await zjuSession().fetch(`http://calendar.celechron.top/${id}.json`)
  if (!response.ok) throw new Error('校历请求失败')

  const data = await response.json() as CalendarResponse
  const calendar: TermCalendar = {
    id,
    halves: names.map((name, index) => ({
      name,
      start: formatDate(data.startEnd[index * 2]),
      end: formatDate(data.startEnd[index * 2 + 1])
    })),
    holidays: Object.fromEntries([
      ...Object.entries({ ...data.holiday, ...data.dummy })
        .map(([date, name]) => [formatDate(date), name]),
      ...Object.entries(data.exchange)
        .map(([dates, name]) => [formatDate(dates.slice(0, 8)), name])
    ]),
    exchanges: Object.entries(data.exchange).map(([dates, name]) => ({
      date: formatDate(dates.slice(8, 16)),
      follows: formatDate(dates.slice(0, 8)),
      name
    }))
  }

  cached = calendar
  return calendar
}
