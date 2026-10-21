import { useZju } from '@renderer/hooks/useZju'
import { useApp } from '@renderer/store'
import { Card, Empty, PageHeader, Stagger, StaggerItem } from '@renderer/components/ui'
import { formatDateTime, isUrgent, relativeTo, todayWeekday } from '@renderer/lib/format'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 18) return '下午好'
  return '晚上好'
}

export function Dashboard() {
  const go = useApp((s) => s.go)
  const schedule = useZju('data:schedule')
  const assignments = useZju('data:assignments')
  const exams = useZju('data:exams')

  const today = (schedule.data ?? [])
    .filter((c) => c.weekday === todayWeekday())
    .sort((a, b) => a.startPeriod - b.startPeriod)
  const pending = (assignments.data ?? [])
    .filter((a) => !a.submitted)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
  const upcoming = (exams.data ?? [])
    .filter((e) => new Date(e.endTime).getTime() > Date.now())
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  const source = [schedule, assignments, exams].some((r) => r.source === 'mock') ? 'mock' : 'live'

  return (
    <>
      <PageHeader title={greeting()} subtitle={new Date().toLocaleDateString('zh-CN', { dateStyle: 'full' })} source={source} />
      <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StaggerItem className="lg:col-span-2">
          <Card>
            <SectionTitle title="今日课程" onMore={() => go('schedule')} />
            {today.length === 0 ? (
              <Empty text="今天没有课，好好休息" />
            ) : (
              <ul className="divide-y divide-line">
                {today.map((c) => (
                  <li key={c.id} className="flex items-center gap-4 py-3">
                    <span className="w-16 text-xs tabular-nums text-muted">
                      第 {c.startPeriod}–{c.endPeriod} 节
                    </span>
                    <span className="flex-1 font-medium">{c.name}</span>
                    <span className="text-sm text-muted">{c.location}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card className="h-full">
            <SectionTitle title="即将到来的考试" onMore={() => go('exams')} />
            {upcoming.length === 0 ? (
              <Empty text="暂无考试安排" />
            ) : (
              <ul className="space-y-3">
                {upcoming.slice(0, 3).map((e) => (
                  <li key={e.id}>
                    <div className="font-medium">{e.courseName}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {formatDateTime(e.startTime)} · <span className="text-accent">{relativeTo(e.startTime)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-3">
          <Card>
            <SectionTitle title="待完成作业" onMore={() => go('assignments')} />
            {pending.length === 0 ? (
              <Empty text="作业全部完成 🎉" />
            ) : (
              <ul className="divide-y divide-line">
                {pending.map((a) => (
                  <li key={a.id} className="flex items-center gap-4 py-3">
                    <span className="flex-1">
                      <span className="font-medium">{a.title}</span>
                      <span className="ml-2 text-sm text-muted">{a.courseName}</span>
                    </span>
                    <span className={`text-sm tabular-nums ${isUrgent(a.deadline) ? 'text-warn' : 'text-muted'}`}>
                      {relativeTo(a.deadline)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </StaggerItem>
      </Stagger>
    </>
  )
}

function SectionTitle({ title, onMore }: { title: string; onMore: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
      <button onClick={onMore} className="text-xs text-muted transition-colors hover:text-accent">
        查看全部 →
      </button>
    </div>
  )
}
