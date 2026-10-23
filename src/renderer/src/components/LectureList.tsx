import { useEffect, useRef, useState } from 'react'
import type { LectureReplay } from '@shared/types'
import { useApp } from '@renderer/store'
import { ymd } from '@renderer/lib/calendar'
import { dotDate } from '@renderer/lib/format'

/** 选集：本门课本学期所有可看的节次（回放 / 直播），竖排，当前节次主题色下划线 */
export function LectureList({ current }: { current: LectureReplay }) {
  const openReplay = useApp((s) => s.openReplay)
  const [lectures, setLectures] = useState<LectureReplay[] | null>(null)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const cal = await window.zju['data:calendar']()
      const today = ymd(new Date())
      const all = await window.zju['data:lectures'](cal.halves[0]?.start ?? today, today)
      if (!alive) return
      setLectures(
        all
          .filter((l) => l.courseId === current.courseId && (l.status === 'replay' || l.status === 'live'))
          .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      )
    })().catch(() => alive && setLectures([]))
    return () => {
      alive = false
    }
  }, [current.courseId])

  useEffect(() => {
    list.current?.querySelector('[data-current]')?.scrollIntoView({ block: 'nearest' })
  }, [lectures, current.id])

  if (lectures === null) return <p className="quiet">…</p>
  if (lectures.length === 0) return <p className="quiet">无</p>

  return (
    <ul ref={list} className="rows">
      {lectures.map((l) => (
        <li key={l.id}>
          <button className="row lecture-row" data-current={l.id === current.id || undefined} onClick={() => l.id !== current.id && openReplay(l)}>
            <span className="row-time">{l.status === 'live' ? <span className="live-mark">直播</span> : dotDate(l.recordedAt)}</span>
            <span className="row-title">{l.startPeriod !== undefined ? `第 ${l.startPeriod}${l.endPeriod && l.endPeriod !== l.startPeriod ? `–${l.endPeriod}` : ''} 节` : l.title}</span>
            <span className="row-end">{l.status === 'live' ? '' : `${l.durationMinutes} 分`}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
