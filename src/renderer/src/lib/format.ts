const WEEKDAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

export const weekdayLabel = (n: number): string => WEEKDAYS[n] ?? ''

/** JS getDay() (0 = Sunday) → 1 = Monday … 7 = Sunday */
export const todayWeekday = (): number => ((new Date().getDay() + 6) % 7) + 1

const pad = (n: number): string => String(n).padStart(2, '0')

/** "10.30" */
export const dotDate = (iso: string): string => {
  const d = new Date(iso)
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
}

/** "14:00" */
export const clock = (iso: string): string => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "周六" */
export const weekdayOf = (iso: string): string => weekdayLabel(((new Date(iso).getDay() + 6) % 7) + 1)

/** 3 天内（未过期）的时刻用星期表示 */
export const isSoon = (iso: string): boolean => {
  const diff = new Date(iso).getTime() - Date.now()
  return diff > 0 && diff < 72 * 3_600_000
}

/** "3 天后" / "5 小时后" / "已过期" */
export function relativeTo(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff < 0) return '已过期'
  const hours = diff / 3_600_000
  if (hours < 1) return `${Math.max(1, Math.round(diff / 60_000))} 分钟后`
  if (hours < 24) return `${Math.round(hours)} 小时后`
  return `${Math.round(hours / 24)} 天后`
}

export const isUrgent = (iso: string): boolean => {
  const diff = new Date(iso).getTime() - Date.now()
  return diff > 0 && diff < 48 * 3_600_000
}

const DIGITS = '零一二三四五六七八九'
/** 教学周等小整数写成汉字：7 → 七，12 → 十二，20 → 二十 */
export function cnNumber(n: number): string {
  if (n < 10) return DIGITS[n]
  const tens = Math.floor(n / 10)
  return `${tens > 1 ? DIGITS[tens] : ''}十${n % 10 ? DIGITS[n % 10] : ''}`
}

/** 学号等账号脱敏：留前三后三，中间打码；较短的只留首字 */
export function maskAccount(account: string): string {
  if (account.length >= 8) return `${account.slice(0, 3)}${'*'.repeat(account.length - 6)}${account.slice(-3)}`
  return account ? `${account.slice(0, 1)}${'*'.repeat(Math.max(account.length - 1, 2))}` : account
}
