import { useZju } from '@renderer/hooks/useZju'
import { Card, Empty, PageHeader, Stagger, StaggerItem } from '@renderer/components/ui'
import { formatDateTime, isUrgent, relativeTo } from '@renderer/lib/format'

export function Exams() {
  const { data, source, loading, reload } = useZju('data:exams')
  const exams = [...(data ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime))

  return (
    <>
      <PageHeader title="考试" subtitle="来自本科教务系统" source={source} onReload={reload} loading={loading} />
      {exams.length === 0 && !loading && <Empty text="暂无考试安排" />}
      <Stagger className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {exams.map((e) => (
          <StaggerItem key={e.id}>
            <Card>
              <div className="flex items-start justify-between">
                <h3 className="font-semibold">{e.courseName}</h3>
                <span className="text-sm text-accent">{relativeTo(e.startTime)}</span>
              </div>
              <p className="mt-2 text-sm text-muted">{formatDateTime(e.startTime)}</p>
              <p className="text-sm text-muted">
                {e.location}
                {e.seat && ` · 座位 ${e.seat}`}
              </p>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
    </>
  )
}

export function Assignments() {
  const { data, source, loading, reload } = useZju('data:assignments')
  const items = [...(data ?? [])].sort(
    (a, b) => Number(a.submitted) - Number(b.submitted) || a.deadline.localeCompare(b.deadline)
  )

  return (
    <>
      <PageHeader title="作业" subtitle="来自学在浙大" source={source} onReload={reload} loading={loading} />
      {items.length === 0 && !loading && <Empty text="暂无作业" />}
      <Stagger className="space-y-2">
        {items.map((a) => (
          <StaggerItem key={a.id}>
            <Card className={`flex items-center gap-4 py-4 ${a.submitted ? 'opacity-50' : ''}`}>
              <span className={`size-2 rounded-full ${a.submitted ? 'bg-line' : isUrgent(a.deadline) ? 'bg-warn' : 'bg-accent'}`} />
              <span className="flex-1">
                <span className="font-medium">{a.title}</span>
                <span className="ml-2 text-sm text-muted">{a.courseName}</span>
              </span>
              <span className="text-sm tabular-nums text-muted">
                {a.submitted ? '已提交' : `${formatDateTime(a.deadline)} 截止`}
              </span>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
    </>
  )
}

export function Replays() {
  const { data, source, loading, reload } = useZju('data:replays')

  return (
    <>
      <PageHeader title="课程回放" subtitle="来自智云课堂" source={source} onReload={reload} loading={loading} />
      {(data ?? []).length === 0 && !loading && <Empty text="暂无回放" />}
      <Stagger className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data ?? []).map((r) => (
          <StaggerItem key={r.id}>
            <Card className="group cursor-pointer transition-transform duration-300 ease-out-soft hover:-translate-y-0.5">
              <div className="mb-3 aspect-video rounded-xl bg-gradient-to-br from-accent-soft to-line" />
              <h3 className="font-semibold">{r.title}</h3>
              <p className="mt-1 text-sm text-muted">
                {r.courseName} · {r.teacher}
              </p>
              <p className="mt-1 text-xs text-muted">
                {formatDateTime(r.recordedAt)} · {r.durationMinutes} 分钟
              </p>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
    </>
  )
}
