import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import type { Assignment, CourseSession } from '@shared/types'
import { useZju } from '@renderer/hooks/useZju'
import { useApp } from '@renderer/store'
import { usePullRefresh } from '@renderer/hooks/usePullRefresh'
import { mergeSessions } from '@renderer/lib/calendar'
import { Joined, OutlineWord, Quiet, Reveal, SectionHead, Sep } from '@renderer/components/Type'
import { classState, periodStart } from '@renderer/lib/periods'
import { clock, dotDate, isSoon, isUrgent, relativeTo, todayWeekday, weekdayLabel, weekdayOf } from '@renderer/lib/format'

/** 主页即全部：今日课程、截止、回放、考试汇在一屏；每块内部滚动，窗口再小也不必整页下滑 */
export function Home() {
  const schedule = useZju('data:schedule')
  const assignments = useZju('data:assignments')
  const exams = useZju('data:exams')
  const replays = useZju('data:replays')
  const { openReplay, openAssignment, refresh, todos, ignoreTodo } = useApp()
  const pull = usePullRefresh(refresh)
  // 显示已忽略的待办（淡显，可右键恢复）
  const [showIgnored, setShowIgnored] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; a: Assignment } | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const now = new Date()
  const wd = todayWeekday()
  const byDay = (d: number): CourseSession[] =>
    mergeSessions((schedule.data ?? []).filter((c) => c.weekday === d))
  const today = byDay(wd)
  const remaining = today.filter((c) => classState(c.startPeriod, c.endPeriod) !== 'past')
  // 今天的课上完了就看明天
  const showTomorrow = today.length > 0 ? remaining.length === 0 : true
  const dayList = showTomorrow ? byDay((wd % 7) + 1) : today

  const ignored = new Set(todos.ignored)
  const open = (assignments.data ?? [])
    .filter((a) => !a.submitted && new Date(a.deadline) > now)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
  const pending = open.filter((a) => !ignored.has(a.id))
  const hasIgnored = open.length > pending.length
  const listed = showIgnored && hasIgnored ? open : pending
  const openMenu = (e: MouseEvent, a: Assignment): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, a })
  }
  const upcoming = (exams.data ?? [])
    .filter((e) => new Date(e.endTime) > now)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const recent = replays.data ?? []

  return (
    <div className="page page-fit">
      <OutlineWord text="Today" />
      <span className="pull-line" data-done={pull === 1 || undefined} style={{ ['--p' as string]: pull }} />
      <Reveal>
        <h1 className="page-title">
          {now.getMonth() + 1}月{now.getDate()}日<span className="ml-4 text-[0.55em] text-[var(--ink-3)]">{weekdayLabel(wd)}</span>
        </h1>
      </Reveal>
      <Reveal i={1}>
        <p className="page-lede">
          <Summary next={remaining[0]} urgent={pending.filter((a) => isUrgent(a.deadline)).length} exam={upcoming[0]} />
        </p>
      </Reveal>

      <div className="panes grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
        <Pane i={2} title={showTomorrow ? '明日' : '今日'}>
          {dayList.length === 0 ? (
            <Quiet loading={schedule.loading} error={schedule.error} empty="无课" />
          ) : (
            <ul className="rows">
              {dayList.map((c) => {
                const state = showTomorrow ? 'later' : classState(c.startPeriod, c.endPeriod)
                return (
                  <li key={c.id} className="row" data-past={state === 'past' || undefined} data-now={state === 'now' || undefined}>
                    <span className="row-time">{periodStart(c.startPeriod)}</span>
                    <span>
                      <span className="row-title">{c.name}</span>
                      <span className="row-sub">{c.location}</span>
                    </span>
                    <span className="row-end">
                      {c.startPeriod}–{c.endPeriod} 节
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Pane>

        <Pane
          i={3}
          title="截止"
          note={
            hasIgnored && (
              <button className="act" data-on={showIgnored || undefined} onClick={() => setShowIgnored((x) => !x)}>
                已忽略
              </button>
            )
          }
        >
          {listed.length === 0 ? (
            <Quiet loading={assignments.loading} error={assignments.error} empty="无" />
          ) : (
            <ul className="rows">
              {listed.map((a) => (
                <li key={a.id}>
                  {/* 不用 button：尾注格里还要放「忽略」按钮 */}
                  <div
                    className="row todo"
                    role="button"
                    tabIndex={0}
                    data-past={ignored.has(a.id) || undefined}
                    onClick={() => openAssignment(a)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        openAssignment(a)
                      }
                    }}
                    onContextMenu={(e) => openMenu(e, a)}
                  >
                    <span className="row-time">
                      {isSoon(a.deadline) ? (
                        <span className="swap">
                          <span>
                            {weekdayOf(a.deadline)} {clock(a.deadline)}
                          </span>
                          <span>
                            {dotDate(a.deadline)} {clock(a.deadline)}
                          </span>
                        </span>
                      ) : (
                        `${dotDate(a.deadline)} ${clock(a.deadline)}`
                      )}
                    </span>
                    <span>
                      <span className="row-title">{a.title}</span>
                      <span className="row-sub">
                        <Joined parts={[a.courseName, a.progress && `${a.progress.done}/${a.progress.total} 题`]} />
                      </span>
                    </span>
                    <span className="row-end" data-hot={isUrgent(a.deadline) || undefined}>
                      {/* 悬停时「忽略」与剩余时间在同一格里互换 */}
                      <span className="swap">
                        <span>{relativeTo(a.deadline)}</span>
                        <button
                          className="act"
                          onClick={(e) => {
                            e.stopPropagation()
                            void ignoreTodo(a.id, !ignored.has(a.id))
                          }}
                        >
                          {ignored.has(a.id) ? '恢复' : '忽略'}
                        </button>
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Pane>

        {menu && (
          <ul className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
            <li>
              <button
                onClick={() => {
                  void ignoreTodo(menu.a.id, !ignored.has(menu.a.id))
                  setMenu(null)
                }}
              >
                {ignored.has(menu.a.id) ? '恢复' : '忽略'}
              </button>
            </li>
          </ul>
        )}

        <Pane i={4} title="回放">
          {recent.length === 0 ? (
            <Quiet loading={replays.loading} error={replays.error} empty="无" />
          ) : (
            <ul className="rows">
              {recent.map((r) => (
                <li key={r.id}>
                  <button className="row" onClick={() => openReplay(r)}>
                    <span className="row-time">{r.status === 'live' ? <span className="live-mark">直播</span> : dotDate(r.recordedAt)}</span>
                    <span>
                      <span className="row-title">{r.courseName}</span>
                      <span className="row-sub">{r.title}</span>
                    </span>
                    <span className="row-end">{r.status === 'live' ? r.teacher : `${r.durationMinutes} 分`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Pane>

        <Pane i={5} title="考试">
          {upcoming.length === 0 ? (
            <Quiet loading={exams.loading} error={exams.error} empty="无" />
          ) : (
            <ul className="rows">
              {upcoming.map((e) => (
                <li key={e.id} className="row">
                  <span className="row-time">
                    {dotDate(e.startTime)} {clock(e.startTime)}
                  </span>
                  <span>
                    <span className="row-title">{e.courseName}</span>
                    <span className="row-sub">
                      {e.location}
                      {e.seat && (
                        <>
                          <Sep />
                          {e.seat} 座
                        </>
                      )}
                    </span>
                  </span>
                  <span className="row-end">{relativeTo(e.startTime)}</span>
                </li>
              ))}
            </ul>
          )}
        </Pane>
      </div>
    </div>
  )
}

function Pane({ i, title, note, children }: { i: number; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <Reveal i={i} className="pane">
      <SectionHead title={title} note={note} />
      <div className="pane-scroll">{children}</div>
    </Reveal>
  )
}

function Summary(props: { next?: CourseSession; urgent: number; exam?: { courseName: string; startTime: string } }) {
  const parts = []
  if (props.next) {
    parts.push(
      <span key="c">
        下一节 {periodStart(props.next.startPeriod)} {props.next.name}
      </span>
    )
  }
  if (props.urgent) parts.push(<span key="a"><em>{props.urgent}</em> 项作业将截止</span>)
  if (props.exam) parts.push(<span key="e">{props.exam.courseName}考试 {relativeTo(props.exam.startTime)}</span>)
  return <Joined parts={parts} />
}
