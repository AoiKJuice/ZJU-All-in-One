import type { CourseSession } from '@shared/types'
import { useZju } from '@renderer/hooks/useZju'
import { OutlineWord, Quiet, Reveal, SectionHead } from '@renderer/components/Type'
import { classState, periodStart } from '@renderer/lib/periods'
import { clock, dotDate, isUrgent, relativeTo, todayWeekday, weekdayLabel } from '@renderer/lib/format'

/** 主页即全部：今日课程、截止、考试、回放汇在一屏，一句话总结放在最上面 */
export function Home() {
  const schedule = useZju('data:schedule')
  const assignments = useZju('data:assignments')
  const exams = useZju('data:exams')
  const replays = useZju('data:replays')

  const now = new Date()
  const wd = todayWeekday()
  const byDay = (d: number): CourseSession[] =>
    (schedule.data ?? []).filter((c) => c.weekday === d).sort((a, b) => a.startPeriod - b.startPeriod)
  const today = byDay(wd)
  const remaining = today.filter((c) => classState(c.startPeriod, c.endPeriod) !== 'past')
  // 今天的课上完了就看明天
  const showTomorrow = today.length > 0 ? remaining.length === 0 : true
  const dayList = showTomorrow ? byDay((wd % 7) + 1) : today

  const pending = (assignments.data ?? [])
    .filter((a) => !a.submitted && new Date(a.deadline) > now)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
  const upcoming = (exams.data ?? [])
    .filter((e) => new Date(e.endTime) > now)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const recent = (replays.data ?? []).slice(0, 5)

  return (
    <div className="page">
      <OutlineWord text="Today" />
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

      <div className="mt-14 grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-x-16 gap-y-14">
        <Reveal i={2}>
          <SectionHead title={showTomorrow ? '明日' : '今日'} />
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
        </Reveal>

        <Reveal i={3}>
          <SectionHead title="截止" />
          {pending.length === 0 ? (
            <Quiet loading={assignments.loading} error={assignments.error} empty="无" />
          ) : (
            <ul className="rows">
              {pending.map((a) => (
                <li key={a.id}>
                  <a className="row" href={a.url} target="_blank" rel="noreferrer">
                    <span className="row-time">
                      {dotDate(a.deadline)} {clock(a.deadline)}
                    </span>
                    <span>
                      <span className="row-title">{a.title}</span>
                      <span className="row-sub">{a.courseName}</span>
                    </span>
                    <span className="row-end" data-hot={isUrgent(a.deadline) || undefined}>
                      {relativeTo(a.deadline)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Reveal>

        <Reveal i={4}>
          <SectionHead title="回放" />
          {recent.length === 0 ? (
            <Quiet loading={replays.loading} error={replays.error} empty="无" />
          ) : (
            <ul className="rows">
              {recent.map((r) => (
                <li key={r.id}>
                  <a className="row" href={r.url} target="_blank" rel="noreferrer">
                    <span className="row-time">{dotDate(r.recordedAt)}</span>
                    <span>
                      <span className="row-title">{r.courseName}</span>
                      <span className="row-sub">{r.title}</span>
                    </span>
                    <span className="row-end">{r.durationMinutes} 分</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Reveal>

        <Reveal i={5}>
          <SectionHead title="考试" />
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
                      {e.seat && ` · ${e.seat} 座`}
                    </span>
                  </span>
                  <span className="row-end">{relativeTo(e.startTime)}</span>
                </li>
              ))}
            </ul>
          )}
        </Reveal>
      </div>
    </div>
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
  } else {
  }
  if (props.urgent) parts.push(<span key="a"><em>{props.urgent}</em> 项作业将截止</span>)
  if (props.exam) parts.push(<span key="e">{props.exam.courseName}考试 {relativeTo(props.exam.startTime)}</span>)
  return <>{parts.flatMap((p, i) => (i ? ['　·　', p] : [p]))}</>
}
