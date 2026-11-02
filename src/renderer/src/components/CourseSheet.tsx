import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import type { Assignment, CourseSession } from '@shared/types'
import { useApp, type CourseOpen } from '@renderer/store'
import { useZju } from '@renderer/hooks/useZju'
import { Joined, Quiet } from './Type'
import { mergeSessions } from '@renderer/lib/calendar'
import { periodEnd, periodStart } from '@renderer/lib/periods'
import { clock, dotDate, weekdayLabel } from '@renderer/lib/format'
import { colorVar, courseColors } from '@renderer/lib/courseColor'
import { dur } from '@renderer/lib/motion'

const EASE = [0.22, 1, 0.36, 1] as const

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

const weeks = (s: CourseSession): string =>
  `${s.semesterPart} 第 ${s.weekRange[0]}–${s.weekRange[1]} 周${s.weekParity === 'odd' ? ' 单周' : s.weekParity === 'even' ? ' 双周' : ''}`

/** 课程详情：从底部上拉。智云入口、这门课每周的上课时间地点、全部作业（含已交）；下拉或点遮罩关闭 */
export function CourseSheet() {
  const course = useApp((s) => s.course)
  const openCourse = useApp((s) => s.openCourse)
  // 只有顶部把手能拖，面板内容照常滚动
  const drag = useDragControls()
  return (
    <AnimatePresence>
      {course && (
        <>
          <motion.div
            key="veil"
            className="sheet-veil course-veil"
            onClick={() => openCourse(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.section
            key="sheet"
            className="course-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: dur(0.5), ease: EASE }}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) openCourse(null)
            }}
          >
            <span className="sheet-handle" aria-hidden onPointerDown={(e) => drag.start(e)} />
            <Body key={`${course.session.id}@${course.date}`} course={course} />
          </motion.section>
        </>
      )}
    </AnimatePresence>
  )
}

function Body({ course }: { course: CourseOpen }) {
  const { session, lecture } = course
  const { openReplay, openAssignment, openCourse } = useApp()
  const schedule = useZju('data:schedule')
  const [homework, setHomework] = useState<Assignment[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.zju['data:courseHomework'](session.name).then(
      (list) => alive && setHomework(list),
      (e) => alive && setError(errorText(e))
    )
    return () => {
      alive = false
    }
  }, [session.name])

  const color = useMemo(() => courseColors(schedule.data ?? []).get(session.name), [schedule.data, session.name])
  const times = mergeSessions((schedule.data ?? []).filter((s) => s.name === session.name))
  const now = Date.now()
  // 未交且未截止的排前面（按截止先后），其余按截止时间倒序
  const open = (a: Assignment): boolean => !a.submitted && (!a.deadline || Date.parse(a.deadline) > now)
  const sorted = [...(homework ?? [])].sort((a, b) =>
    open(a) !== open(b) ? (open(a) ? -1 : 1) : open(a) ? a.deadline.localeCompare(b.deadline) : b.deadline.localeCompare(a.deadline)
  )
  const playable = lecture && (lecture.status === 'replay' || lecture.status === 'live')

  return (
    <div className="course-sheet-body" style={{ ['--cc' as string]: colorVar(color) }}>
      <header className="course-sheet-head">
        <span className="course-dot" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="course-sheet-title">{session.name}</h2>
          <p className="course-sheet-meta">
            <Joined parts={[session.teacher, `${dotDate(course.date)} ${weekdayLabel(session.weekday)}`, `${periodStart(session.startPeriod)}–${periodEnd(session.endPeriod)}`, session.location]} />
          </p>
        </div>
        <button className="act" onClick={() => openCourse(null)}>
          关闭
        </button>
      </header>

      {lecture && (
        <div className="course-replay">
          {playable ? (
            <button className="btn btn-solid" onClick={() => openReplay(lecture)}>
              {lecture.status === 'live' ? '进入直播' : '观看录播'}
            </button>
          ) : (
            <span className="text-[var(--ink-3)]">{lecture.status === 'generating' ? '录播生成中' : lecture.status === 'upcoming' ? '尚未开始' : '无录播'}</span>
          )}
          <span className="course-replay-title">{lecture.title}</span>
        </div>
      )}

      <section className="sheet-group">
        <h3 className="group-title">上课时间</h3>
        <ul className="rows">
          {times.map((s) => (
            <li key={s.id} className="row course-time-row">
              <span className="row-time">{weekdayLabel(s.weekday)}</span>
              <span>
                <span className="row-title">
                  {periodStart(s.startPeriod)}–{periodEnd(s.endPeriod)}
                  <span className="row-inline">
                    {s.startPeriod}–{s.endPeriod} 节
                  </span>
                </span>
                <span className="row-sub">
                  <Joined parts={[s.location, weeks(s)]} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="sheet-group">
        <h3 className="group-title">作业</h3>
        {homework === null || sorted.length === 0 ? (
          <Quiet loading={homework === null && !error} error={error} empty="无" />
        ) : (
          <ul className="rows">
            {sorted.map((a) => {
              const state = a.submitted ? 'done' : open(a) ? 'open' : 'missed'
              return (
                <li key={a.id}>
                  <button className="row homework-row" onClick={() => openAssignment(a)}>
                    <span className="row-time">{a.deadline ? `${dotDate(a.deadline)} ${clock(a.deadline)}` : '不限'}</span>
                    <span className="row-title">{a.title}</span>
                    <span className="status-chip" data-state={state}>
                      {state === 'done' ? '已交' : state === 'open' ? '进行中' : '未交'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
