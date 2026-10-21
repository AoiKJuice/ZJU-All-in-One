import { motion } from 'motion/react'
import { useZju } from '@renderer/hooks/useZju'
import { PageHeader } from '@renderer/components/ui'
import { todayWeekday, weekdayLabel } from '@renderer/lib/format'

const PERIODS = 13
const DAYS = [1, 2, 3, 4, 5, 6, 7]

export function Schedule() {
  const { data, source, loading, reload } = useZju('data:schedule')
  const today = todayWeekday()

  return (
    <>
      <PageHeader title="课表" subtitle="本学期课程安排" source={source} onReload={reload} loading={loading} />
      <div
        className="grid gap-1.5 rounded-2xl border border-line bg-surface p-3"
        style={{ gridTemplateColumns: '2.5rem repeat(7, minmax(0, 1fr))', gridTemplateRows: `2rem repeat(${PERIODS}, 2.6rem)` }}
      >
        <div />
        {DAYS.map((d) => (
          <div
            key={d}
            className={`flex items-center justify-center text-xs font-medium ${d === today ? 'text-accent' : 'text-muted'}`}
          >
            {weekdayLabel(d)}
          </div>
        ))}
        {Array.from({ length: PERIODS }, (_, i) => (
          <div key={i} className="flex items-center justify-center text-xs tabular-nums text-muted" style={{ gridColumn: 1, gridRow: i + 2 }}>
            {i + 1}
          </div>
        ))}
        {(data ?? []).map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.03, duration: 0.3 }}
            className="flex flex-col overflow-hidden rounded-lg bg-accent-soft p-2 text-xs"
            style={{ gridColumn: c.weekday + 1, gridRow: `${c.startPeriod + 1} / ${c.endPeriod + 2}` }}
          >
            <span className="font-semibold text-accent">{c.name}</span>
            <span className="mt-auto text-muted">{c.location}</span>
          </motion.div>
        ))}
      </div>
    </>
  )
}
