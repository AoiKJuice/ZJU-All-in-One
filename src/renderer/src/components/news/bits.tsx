// 校园资讯界面共用的小件：日期文字、展开箭头

const pad = (n: number): string => String(n).padStart(2, '0')
const WEEK = '日一二三四五六'

/** 列表上的日期：今天 / 昨天 / 11月6日 */
export function dayText(time: string | null): string {
  if (!time) return ''
  const d = new Date(time.length === 10 ? `${time}T00:00:00+08:00` : time)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / 86_400_000)
  if (diff === 0) return '今天'
  if (diff === -1) return '昨天'
  if (diff === 1) return '明天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 活动时间：11月9日 周六 18:30 */
export function whenText(time: string | null): string {
  if (!time) return ''
  const d = new Date(time)
  return `${dayText(time)} 周${WEEK[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function Chevron() {
  return (
    <svg className="news-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 10l5 5 5-5" />
    </svg>
  )
}

