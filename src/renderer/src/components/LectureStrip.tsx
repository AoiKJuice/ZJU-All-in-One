import { useEffect, useRef, useState } from 'react'
import type { LectureReplay } from '@shared/types'
import { useApp } from '@renderer/store'
import { ymd } from '@renderer/lib/calendar'

/** 本门课本学期的全部可看节次（回放 / 直播），横排日期，点选切换；当前节次主题色 + 点 */
export function LectureStrip({ current }: { current: LectureReplay }) {
  const openReplay = useApp((s) => s.openReplay)
  const [lectures, setLectures] = useState<LectureReplay[]>([])
  const strip = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const cal = await window.zju['data:calendar']()
      const today = ymd(new Date())
      const from = cal.halves[0]?.start ?? today
      const all = await window.zju['data:lectures'](from, today)
      if (!alive) return
      setLectures(
        all
          .filter((l) => l.courseId === current.courseId && (l.status === 'replay' || l.status === 'live'))
          .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      )
    })().catch(() => {})
    return () => {
      alive = false
    }
  }, [current.courseId])

  // 当前节次滚到可见处
  useEffect(() => {
    strip.current?.querySelector('[data-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [lectures, current.id])

  if (lectures.length < 2) return null

  return (
    <div ref={strip} className="lecture-strip">
      {lectures.map((l) => (
        <button
          key={l.id}
          data-current={l.id === current.id || undefined}
          title={l.title}
          onClick={() => l.id !== current.id && openReplay(l)}
        >
          {l.status === 'live' ? <span className="live-mark">直播</span> : `${l.date.slice(5, 7)}.${l.date.slice(8)}`}
          {l.startPeriod !== undefined && <span className="ml-1 text-[0.75em] text-[var(--ink-3)]">{l.startPeriod}</span>}
        </button>
      ))}
    </div>
  )
}
