import { motion } from 'motion/react'
import { useZju } from '@renderer/hooks/useZju'
import { OutlineWord, Quiet, Reveal } from '@renderer/components/Type'
import { PERIOD_COUNT, periodStart } from '@renderer/lib/periods'
import { todayWeekday, weekdayLabel } from '@renderer/lib/format'

const DAYS = [1, 2, 3, 4, 5, 6, 7]

/** 周视图：细线网格，课程只是排在格子里的文字，今天一列轻轻垫底色 */
export function Schedule() {
  const { data, loading, error } = useZju('data:schedule')
  const today = todayWeekday()

  return (
    <div className="page">
      <OutlineWord text="Week" />
      <Reveal className="mt-24">
        {!data?.length ? (
          <Quiet loading={loading} error={error} empty="无" />
        ) : (
          <div
            className="grid border-t border-[var(--rule)]"
            style={{ gridTemplateColumns: '3.5rem repeat(7, minmax(0, 1fr))', gridTemplateRows: `2.75rem repeat(${PERIOD_COUNT}, 2.75rem)` }}
          >
            <div className="bg-[var(--tint)]" style={{ gridColumn: today + 1, gridRow: `1 / ${PERIOD_COUNT + 2}` }} />
            {DAYS.map((d) => (
              <div
                key={d}
                className="flex items-center px-3 text-[0.9375rem] tracking-[0.14em]"
                style={{ gridColumn: d + 1, gridRow: 1, color: d === today ? 'var(--shu)' : 'var(--ink-3)' }}
              >
                {weekdayLabel(d)}
              </div>
            ))}
            {Array.from({ length: PERIOD_COUNT }, (_, i) => (
              <div
                key={i}
                className="border-t border-[var(--rule)] pt-1 text-xs tabular-nums text-[var(--ink-3)]"
                style={{ gridColumn: '1 / -1', gridRow: i + 2 }}
              >
                {periodStart(i + 1)}
              </div>
            ))}
            {data.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, filter: 'blur(4px)' }}
                animate={{ opacity: 1, filter: 'blur(0px)' }}
                transition={{ delay: 0.2 + i * 0.03, duration: 0.8 }}
                className="relative z-[1] m-[3px] flex flex-col border-l border-[var(--shu)] py-1 pl-2.5 pr-1 leading-snug"
                style={{ gridColumn: c.weekday + 1, gridRow: `${c.startPeriod + 1} / ${c.endPeriod + 2}` }}
              >
                <span className="text-[0.9375rem] tracking-wide">{c.name}</span>
                <span className="mt-auto text-xs tracking-wide text-[var(--ink-3)]">
                  {c.location}
                  {c.semesterPart && ` · ${c.semesterPart}`}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </Reveal>
    </div>
  )
}
