import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { LectureReplay } from '@shared/types'
import { useZju } from '@renderer/hooks/useZju'
import { useCalendar } from '@renderer/hooks/useCalendar'
import { useApp } from '@renderer/store'
import { Quiet, Reveal } from '@renderer/components/Type'
import { PERIOD_COUNT, periodStart } from '@renderer/lib/periods'
import { cnNumber, weekdayLabel } from '@renderer/lib/format'
import { Roll } from '@renderer/components/Roll'
import { addDays, findLecture, mergeSessions, mondayOf, sessionsOn, teachingWeek, ymd } from '@renderer/lib/calendar'
import { colorVar, courseColors } from '@renderer/lib/courseColor'
import { cached, peek } from '@renderer/lib/cache'
import { MOBILE } from '@renderer/lib/platform'
import { dur } from '@renderer/lib/motion'

const DAYS = [1, 2, 3, 4, 5, 6, 7]
const EASE = [0.22, 1, 0.36, 1] as const

// 滚轮累计到这么多像素翻一周；翻页后冷却一段时间，一次快速滑动只翻一周
const WHEEL_STEP = 60
const WHEEL_COOLDOWN = 380
// 触屏横向滑动这么多像素翻一周
const SWIPE_STEP = 56

const lecturesKey = (monday: string): string => `lectures:${monday}`

// 上午 1–5、下午 6–10、晚上 11–13 节各是一块卡片，块与块之间空一行；节次 → 网格行（第 1 行是星期）
const BLOCKS: [number, number][] = [
  [1, 5],
  [6, 10],
  [11, 13]
]
const rowOf = (period: number): number => period + 1 + (period >= 6 ? 1 : 0) + (period >= 11 ? 1 : 0)

// 翻周时网格不动：周数与日期按位滚动（Roll），两周都有的课原地不动，只有出现、消失的课淡入淡出
const cellFade = {
  initial: { opacity: 0, scale: 0.94 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.94 }
}

/**
 * 周视图：按周翻页（底部悬浮按钮、滚轮，中键回本周；手机端左右滑动）；上午、下午、晚上三块卡片占满可用高度，左侧节次与开始时刻。
 * 课程按课名配色，有录播的课右上角带标志；点课程打开课程详情（上课时间地点、作业、智云入口）。校历与各周课次走缓存。
 * 空间够时七天都画；手机或窄窗口里周六、周日只有这一周确实有课（含调休上课）时才加上那一列
 */
export function Schedule() {
  const { data, loading, error } = useZju('data:schedule')
  // 演示模式不登录也取数，与 useZju 一致
  const loggedIn = useApp((s) => s.auth.loggedIn) || import.meta.env.VITE_ZJU_DEMO === '1'
  const epoch = useApp((s) => s.epoch)
  const openCourse = useApp((s) => s.openCourse)
  const cal = useCalendar()
  const [offset, setOffset] = useState(0)
  const [dir, setDir] = useState(0)

  const monday = useMemo(() => addDays(mondayOf(new Date()), offset * 7), [offset])
  const dates = DAYS.map((d) => ymd(addDays(monday, d - 1)))
  const today = ymd(new Date())
  const [lectures, setLectures] = useState<LectureReplay[]>(() => peek<LectureReplay[]>(lecturesKey(dates[0])) ?? [])
  const colors = useMemo(() => courseColors(data ?? []), [data])

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

  // step 0 为回本周：从未来几周回来算向前翻（-1），从过去几周回来算向后翻（+1）
  const page = (step: number): void => {
    setDir(step !== 0 ? step : offset > 0 ? -1 : 1)
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

  // 触屏左右滑动翻周：横向位移超过阈值且明显大于纵向
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent): void => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const onTouchEnd = (e: React.TouchEvent): void => {
    const start = touch.current
    touch.current = null
    if (!start) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    if (Math.abs(dx) >= SWIPE_STEP && Math.abs(dx) > Math.abs(dy) * 1.5) page(dx < 0 ? 1 : -1)
  }

  const tw = cal && dates.map((d) => teachingWeek(cal, d)).find(Boolean)
  // 每列：日期与星期（1–7）；窄屏时周末没课的那天不占列
  const narrow = useNarrow()
  const shown = dates
    .map((date, i) => ({ date, weekday: i + 1 }))
    .filter(({ date, weekday }) => !narrow || weekday <= 5 || (!!cal && !!data && sessionsOn(cal, data, date).length > 0))

  return (
    <div
      className="page page-wide page-fit schedule-page"
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      // 中键回本周；按下时就拦住，免得出现自动滚动
      onMouseDown={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        if (offset !== 0) page(0)
      }}
    >
      <Reveal className="mt-2">
        {/* 秋七周：半学期 + 汉字周数 */}
        <h1 className="page-title schedule-title">
          <Roll text={tw ? `${tw.half}${cnNumber(tw.week)}周` : '课表'} dir={dir} />
        </h1>
      </Reveal>

      <Reveal i={1} flat className="schedule-board mt-4 flex min-h-0 flex-1 flex-col">
        {!data?.length || !cal ? (
          <Quiet loading={loading || (loggedIn && !cal)} error={error} empty="无" />
        ) : (
            <div
              className="grid flex-1"
              style={{
                gridTemplateColumns: `${MOBILE ? '2.375rem' : '4rem'} repeat(${shown.length}, minmax(0, 1fr))`,
                gridTemplateRows: `${MOBILE ? '2.75rem' : '3.25rem'} ${BLOCKS.map(([a, b]) => `repeat(${b - a + 1}, minmax(${MOBILE ? '3.25rem' : '2rem'}, 1fr))`).join(' 0.625rem ')}`
              }}
            >
              {BLOCKS.map(([a, b]) => (
                <div key={a} className="period-block" style={{ gridColumn: '1 / -1', gridRow: `${rowOf(a)} / ${rowOf(b) + 1}` }} />
              ))}
              <AnimatePresence initial={false}>
                {shown.flatMap(({ date }, i) =>
                  date === today
                    ? BLOCKS.map(([a, b]) => (
                        <motion.div
                          key={`today-${a}`}
                          className="today-col"
                          // 最右一列贴着块的圆角，右侧两角跟着圆
                          data-last={i === shown.length - 1 || undefined}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: dur(0.35) }}
                          style={{ gridColumn: i + 2, gridRow: `${rowOf(a)} / ${rowOf(b) + 1}` }}
                        />
                      ))
                    : []
                )}
              </AnimatePresence>
              {shown.map(({ date, weekday }, i) => (
                <div key={weekday} className="day-head" data-today={date === today || undefined} style={{ gridColumn: i + 2, gridRow: 1 }}>
                  <span className="day-name">{weekdayLabel(weekday)}</span>
                  <span className="day-date">
                    <Roll text={date.slice(5).replace('-', '.')} dir={dir} />
                    {cal.holidays[date] && <span className="ml-1.5 text-[var(--shu)]">{cal.holidays[date]}</span>}
                  </span>
                </div>
              ))}
              {Array.from({ length: PERIOD_COUNT }, (_, i) => (
                <div key={i} className="period-head" style={{ gridColumn: 1, gridRow: rowOf(i + 1) }}>
                  <span className="period-no">{i + 1}</span>
                  <span className="period-time">{periodStart(i + 1)}</span>
                </div>
              ))}
              <AnimatePresence initial={false}>
                {shown.flatMap(({ date, weekday }, i) =>
                  mergeSessions(sessionsOn(cal, data, date)).map((c) => {
                    const lecture = findLecture(lectures, c, date)
                    const recorded = lecture?.status === 'replay' || lecture?.status === 'live'
                    return (
                      <motion.button
                        // 按星期、节次、课名与教室认课：两周都有的同一节课不重建，原地不动
                        key={`${weekday}:${c.startPeriod}-${c.endPeriod}:${c.name}:${c.location}`}
                        {...cellFade}
                        transition={{ duration: dur(0.35), ease: EASE }}
                        onClick={() => openCourse({ session: c, date, lecture })}
                        className="course-cell"
                        style={{ gridColumn: i + 2, gridRow: `${rowOf(c.startPeriod)} / ${rowOf(c.endPeriod) + 1}`, ['--cc' as string]: colorVar(colors.get(c.name)) }}
                      >
                        {recorded && lecture &&
                          (lecture.status === 'live' ? (
                            <span className="cell-live">直播</span>
                          ) : (
                            <span className="cell-replay" aria-label="有录播">
                              <svg viewBox="0 0 12 12" aria-hidden>
                                <path d="M4.2 2.9v6.2L9.2 6z" fill="currentColor" />
                              </svg>
                            </span>
                          ))}
                        <span className="course-name">{c.name}</span>
                        <span className="course-place">{c.location}</span>
                      </motion.button>
                    )
                  })
                )}
              </AnimatePresence>
            </div>
        )}
      </Reveal>

      {/* 翻周：底部居中的半透明悬浮按钮，长度固定；中间在本周时写「本周」（不可点），离开本周时换成「回到本周」 */}
      <div className="week-float">
        <button aria-label="上一周" onClick={() => page(-1)}>
          <Chevron dir={-1} />
        </button>
        <button className="week-today" data-away={offset !== 0 || undefined} disabled={offset === 0} onClick={() => page(0)}>
          <span>本周</span>
          <span>回到本周</span>
        </button>
        <button aria-label="下一周" onClick={() => page(1)}>
          <Chevron dir={1} />
        </button>
      </div>
    </div>
  )
}

// 七列放不下（手机，或窗口窄到每列不足一个课名宽）时折叠没课的周末
const NARROW = '(max-width: 760px)'
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => MOBILE || matchMedia(NARROW).matches)
  useEffect(() => {
    if (MOBILE) return
    const query = matchMedia(NARROW)
    const onChange = (): void => setNarrow(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return narrow
}

function Chevron({ dir }: { dir: 1 | -1 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir < 0 ? 'M14.5 6l-6 6 6 6' : 'M9.5 6l6 6-6 6'} />
    </svg>
  )
}
