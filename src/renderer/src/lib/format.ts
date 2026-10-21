const WEEKDAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

export const weekdayLabel = (n: number): string => WEEKDAYS[n] ?? ''

/** JS getDay() (0 = Sunday) → 1 = Monday … 7 = Sunday */
export const todayWeekday = (): number => ((new Date().getDay() + 6) % 7) + 1

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
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
