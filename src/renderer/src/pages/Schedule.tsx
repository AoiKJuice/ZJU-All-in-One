import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { LectureReplay, TermCalendar } from '@shared/types'
import { useZju } from '@renderer/hooks/useZju'
import { useApp } from '@renderer/store'
import { Quiet, Reveal, Sep } from '@renderer/components/Type'
import { PERIOD_COUNT, periodStart } from '@renderer/lib/periods'
import { weekdayLabel } from '@renderer/lib/format'
import { addDays, findLecture, mergeSessions, mondayOf, sessionsOn, teachingWeek, ymd } from '@renderer/lib/calendar'
import { cached, peek } from '@renderer/lib/cache'

const DAYS = [1, 2, 3, 4, 5, 6, 7]
const EASE = [0.22, 1, 0.36, 1] as const

// 滚轮累计到这么多像素翻一周；翻页后冷却一段时间，一次快速滑动只翻一周
const WHEEL_STEP = 60
const WHEEL_COOLDOWN = 380

const lecturesKey = (monday: string): string => `lectures:${monday}`

/** 周视图：按周翻页（按钮、滚轮，中键回本周）；细线网格占满可用高度；有智云课次的课可点进视频。校历与各周课次走缓存 */
export function Schedule() {
  const { data, loading, error } = useZju('data:schedule')
  // 演示模式不登录也取数，与 useZju 一致
  const loggedIn = useApp((s) => s.auth.loggedIn) || import.meta.env.VITE_ZJU_DEMO === '1'
  const epoch = useApp((s) => s.epoch)
  const openReplay = useApp((s) => s.openReplay)
  const [cal, setCal] = useState<TermCalendar | null>(() => peek<TermCalendar>('calendar', true) ?? null)
  const [offset, setOffset] = useState(0)
  const [dir, setDir] = useState(0)

  const monday = useMemo(() => addDays(mondayOf(new Date()), offset * 7), [offset])
  const dates = DAYS.map((d) => ymd(addDays(monday, d - 1)))
  const today = ymd(new Date())
  const [lectures, setLectures] = useState<LectureReplay[]>(() => peek<LectureReplay[]>(lecturesKey(dates[0])) ?? [])

  useEffect(() => {
    if (loggedIn) void cached('calendar', epoch, () => window.zju['data:calendar'](), true).then(setCal, () => {})
  }, [loggedIn, epoch])

  // 本周课次先用缓存，过期再取；顺带预取前后一周，翻页时不必等
  useEffect(() => {
    if (!loggedIn) return
    let alive = true
    const load = (start: string): Promise<LectureReplay[]> =>
      cached(lecturesKey(start), epoch, () => window.zju['data:lectures'](start, ymd(addDays(new Date(start + 'T00:00'), 6))))
    setLectures(peek<LectureReplay[]>(lecturesKey(dates[0])) ?? [])
    load(dates[0]).then((l) => alive && setLectures(l), () => {})
    for (const step of [-7, 7]) void load(ymd(addDays(monday, step))).catch(() => {})
    return () => {
      alive = false
    }
  }, [loggedIn, epoch, dates[0]])

  const page = (step: number): void => {
    setDir(step)
    setOffset((o) => (step === 0 ? 0 : o + step))
  }

  // 滚轮翻周：向下下一周，向上上一周
  const wheel = useRef({ acc: 0, until: 0 })
  const onWheel = (e: React.WheelEvent): void => {
    const w = wheel.current
    if (Date.now() < w.until) return
    w.acc += e.deltaY
    if (Math.abs(w.acc) < WHEEL_STEP) return
    page(w.acc > 0 ? 1 : -1)
    w.acc = 0
    w.until = Date.now() + WHEEL_COOLDOWN
  }

  const tw = cal && dates.map((d) => teachingWeek(cal, d)).find(Boolean)

  return (
    <div
      className="page page-wide page-fit schedule-page"
      onWheel={onWheel}
      // 中键回本周；按下时就拦住，免得出现自动滚动
      onMouseDown={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        if (offset !== 0) page(0)
      }}
    >
      <Reveal className="mt-2 flex items-end justify-between">
        <h1 className="page-title !text-[clamp(1.75rem,2.5vw+1.5vh,2.75rem)]">
          {tw ? (
            <>
              {tw.half}
              <Sep />第 {tw.week} 周
            </>
          ) : (
            '课表'
          )}
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

      <Reveal i={1} className="mt-4 flex min-h-0 flex-1 flex-col">
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
              className="grid flex-1 border-t border-[var(--rule)]"
              style={{ gridTemplateColumns: '3.5rem repeat(7, minmax(0, 1fr))', gridTemplateRows: `3.25rem repeat(${PERIOD_COUNT}, minmax(2.2rem, 1fr))` }}
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
                mergeSessions(sessionsOn(cal, data, date)).map((c) => {
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
