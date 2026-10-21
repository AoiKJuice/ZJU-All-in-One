import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { LectureReplay, TermCalendar } from '@shared/types'
import { useZju } from '@renderer/hooks/useZju'
import { useApp } from '@renderer/store'
import { OutlineWord, Quiet, Reveal } from '@renderer/components/Type'
import { PERIOD_COUNT, periodStart } from '@renderer/lib/periods'
import { weekdayLabel } from '@renderer/lib/format'
import { addDays, findLecture, mondayOf, sessionsOn, teachingWeek, ymd } from '@renderer/lib/calendar'

const DAYS = [1, 2, 3, 4, 5, 6, 7]
const EASE = [0.22, 1, 0.36, 1] as const

/** 周视图：按周翻页；细线网格，课程是排在格子里的文字；有智云课次的课可点进视频 */
export function Schedule() {
  const { data, loading, error } = useZju('data:schedule')
  const loggedIn = useApp((s) => s.auth.loggedIn)
  const openReplay = useApp((s) => s.openReplay)
  const [cal, setCal] = useState<TermCalendar | null>(null)
  const [offset, setOffset] = useState(0)
  const [dir, setDir] = useState(0)
  const [lectures, setLectures] = useState<LectureReplay[]>([])

  const monday = useMemo(() => addDays(mondayOf(new Date()), offset * 7), [offset])
  const dates = DAYS.map((d) => ymd(addDays(monday, d - 1)))
  const today = ymd(new Date())

  useEffect(() => {
    if (loggedIn) void window.zju['data:calendar']().then(setCal, () => {})
  }, [loggedIn])

  useEffect(() => {
    if (!loggedIn) return
    let alive = true
    setLectures([])
    window.zju['data:lectures'](dates[0], dates[6]).then((l) => alive && setLectures(l), () => {})
    return () => {
      alive = false
    }
  }, [loggedIn, dates[0]])

  const page = (step: number): void => {
    setDir(step)
    setOffset((o) => (step === 0 ? 0 : o + step))
  }

  const tw = cal && dates.map((d) => teachingWeek(cal, d)).find(Boolean)

  return (
    <div className="page">
      <OutlineWord text="Week" />
      <Reveal className="mt-16 flex items-end justify-between">
        <h1 className="page-title !text-[clamp(1.75rem,2.5vw+1.5vh,2.75rem)]">
          {tw ? `${tw.half} · 第 ${tw.week} 周` : '课表'}
          <span className="ml-5 text-[0.45em] tracking-[0.06em] text-[var(--ink-3)]">
            {dates[0].slice(5).replace('-', '.')} – {dates[6].slice(5).replace('-', '.')}
          </span>
        </h1>
        <div className="acts pb-2">
          <button className="act" onClick={() => page(-1)}>
            ←
          </button>
          <button className="act" disabled={offset === 0} onClick={() => page(0)}>
            本周
          </button>
          <button className="act" onClick={() => page(1)}>
            →
          </button>
        </div>
      </Reveal>

      <Reveal i={1} className="mt-8">
        {!data?.length || !cal ? (
          <Quiet loading={loading || (loggedIn && !cal)} error={error} empty="无" />
        ) : (
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={dates[0]}
              custom={dir}
              initial={{ opacity: 0, x: dir * 24, filter: 'blur(4px)' }}
              animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, x: dir * -24, filter: 'blur(4px)' }}
              transition={{ duration: 0.45, ease: EASE }}
              className="grid border-t border-[var(--rule)]"
              style={{ gridTemplateColumns: '3.5rem repeat(7, minmax(0, 1fr))', gridTemplateRows: `3.25rem repeat(${PERIOD_COUNT}, 2.6rem)` }}
            >
              {dates.map((date, i) =>
                date === today ? <div key="today" className="bg-[var(--tint)]" style={{ gridColumn: i + 2, gridRow: `1 / ${PERIOD_COUNT + 2}` }} /> : null
              )}
              {dates.map((date, i) => (
                <div
                  key={date}
                  className="flex flex-col justify-center px-3 leading-tight"
                  style={{ gridColumn: i + 2, gridRow: 1, color: date === today ? 'var(--shu)' : 'var(--ink-3)' }}
                >
                  <span className="text-[0.9375rem] tracking-[0.14em]">{weekdayLabel(i + 1)}</span>
                  <span className="text-xs tabular-nums">
                    {date.slice(5).replace('-', '.')}
                    {cal.holidays[date] && <span className="ml-2 text-[var(--shu)]">{cal.holidays[date]}</span>}
                  </span>
                </div>
              ))}
              {Array.from({ length: PERIOD_COUNT }, (_, i) => (
                <div key={i} className="border-t border-[var(--rule)] pt-1 text-xs tabular-nums text-[var(--ink-3)]" style={{ gridColumn: '1 / -1', gridRow: i + 2 }}>
                  {periodStart(i + 1)}
                </div>
              ))}
              {dates.flatMap((date, i) =>
                sessionsOn(cal, data, date).map((c) => {
                  const lecture = findLecture(lectures, c, date)
                  const playable = lecture && (lecture.status === 'replay' || lecture.status === 'live')
                  const Tag = playable ? 'button' : 'div'
                  return (
                    <Tag
                      key={`${date}:${c.id}`}
                      onClick={playable ? () => openReplay(lecture) : undefined}
                      className="course-cell"
                      data-playable={playable || undefined}
                      style={{ gridColumn: i + 2, gridRow: `${c.startPeriod + 1} / ${c.endPeriod + 2}` }}
                    >
                      <span className="course-name">{c.name}</span>
                      <span className="mt-auto text-xs tracking-wide text-[var(--ink-3)]">
                        {lecture?.status === 'live' ? <span className="live-mark">直播</span> : c.location}
                      </span>
                    </Tag>
                  )
                })
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </Reveal>
    </div>
  )
}
