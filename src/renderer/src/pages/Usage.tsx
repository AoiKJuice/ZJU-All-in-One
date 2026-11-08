import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { beijingDay, HEAT_WEEKS, heatStart, shiftDay, type HomeworkUsage, type LibraryUsage, type SubmitHabit, type SubmitTiming } from '@shared/usage'
import { useApp } from '@renderer/store'
import { useZju } from '@renderer/hooks/useZju'
import { IconButton } from '@renderer/components/IconButton'
import { OutlineWord, Quiet, Reveal } from '@renderer/components/Type'
import './usage.css'

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

const dayLabel = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number)
  return `${y}年${m}月${d}日 周${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`
}

const trim = (n: number): string => String(Number(n.toFixed(1)))
const percent = (r: number | null): string => (r === null ? '–' : `${Math.round(r * 100)}%`)

const LIBRARY_STEPS = [2, 4, 8]
const HOMEWORK_STEPS = [2, 3, 4]

/** 0 为空；steps 是 2、3、4 档的下限 */
const levelOf = (value: number, steps: number[]): number => (value <= 0 ? 0 : 1 + steps.filter((s) => value >= s).length)

interface Range {
  weeks: number
  /** 这一档每列至少要多宽（rem），放不下就换下一档 */
  pitch: number
  /** 两张热图并排还是上下排 */
  columns: 1 | 2
  label: string
}

// 格子始终是正方形并铺满宽度：周数少时一张图放到整行会大得离谱，所以三个月优先两张并排
const RANGES: Range[] = [
  { weeks: HEAT_WEEKS, pitch: 1.3, columns: 1, label: '近一年' },
  { weeks: 14, pitch: 1.25, columns: 2, label: '近三个月' },
  { weeks: 14, pitch: 1.25, columns: 1, label: '近三个月' },
  { weeks: 6, pitch: 0, columns: 1, label: '近一个月' }
]

/** 与 usage.css 一致（rem）：星期列加间距、面板左右内边距、面板间距 */
const WEEKDAY_COLUMN = 1.75
const BLOCK_PADDING = 2.5
const BLOCK_GAP = 0.75

function rangeFor(width: number): Range {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const fits = (r: Range): boolean => ((width / rem - (r.columns - 1) * BLOCK_GAP) / r.columns - BLOCK_PADDING - WEEKDAY_COLUMN) / r.weeks >= r.pitch
  return RANGES.find(fits) ?? RANGES[RANGES.length - 1]
}

/** 数据统计（设置的二级页面）：进来才取数，作业要请求很多次 */
export function Usage() {
  const go = useApp((s) => s.go)
  return (
    <div className="page usage-page">
      <OutlineWord text="Stats" />
      <Reveal className="tool-head">
        <button className="tool-back" aria-label="返回设置" title="返回设置" onClick={() => go('settings')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14.5 6l-6 6 6 6" />
          </svg>
        </button>
        <h1 className="page-title">数据统计</h1>
      </Reveal>
      <Reveal i={1} flat>
        <Blocks />
      </Reveal>
    </div>
  )
}

function Blocks() {
  const ready = useApp((s) => s.authReady)
  const loggedIn = useApp((s) => s.auth.loggedIn)
  if (ready && !loggedIn && !import.meta.env.VITE_ZJU_DEMO) return <Quiet loading={false} error={null} empty="无" />
  return <Stats />
}

function Stats() {
  const list = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState(RANGES[0])
  const [barHover, setBarHover] = useState<string | null>(null)
  const library = useZju('data:libraryUsage')
  const homework = useZju('data:homeworkUsage')
  const timing = homework.data?.timing

  // 两张热图的范围、并排与否由整列的宽度一起决定
  useLayoutEffect(() => {
    const element = list.current
    if (!element) return
    const fit = (): void => setRange(rangeFor(element.clientWidth))
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="usage-list" ref={list} data-columns={range.columns}>
      <Summary library={library.data} homework={homework.data} />
      {/* 换了范围就回到最近一页 */}
      <HeatBlock key={`library-${range.weeks}`} title="图书馆" days={library.data?.days} steps={LIBRARY_STEPS} unit="小时" range={range} error={library.error} retry={() => void library.reload()} />
      <HeatBlock key={`homework-${range.weeks}`} title="提交作业" days={homework.data?.days} steps={HOMEWORK_STEPS} unit="次" range={range} error={homework.error} retry={() => void homework.reload()} />
      {(homework.data || !homework.error) && (
        <Block title="提交时点" wide read={barHover ?? (timing ? (timing.count > 0 ? <Averages timing={timing} /> : '') : '…')}>
          {timing && timing.count === 0 ? <Quiet loading={false} error={null} empty="无" /> : <TimingBars timing={timing} onRead={setBarHover} />}
        </Block>
      )}
    </div>
  )
}

const WEEKDAY_NAME = ['一', '二', '三', '四', '五', '六', '日']
const HABIT_NAME: Record<SubmitHabit, string> = { early: '作业刚发布', middle: '作业进行中', late: '临近DDL' }

const monthDay = (day: string): string => {
  const [, m, d] = day.split('-').map(Number)
  return `${m}月${d}日`
}

/** 离截止还剩多久：不足一分钟写秒，不足一小时写分钟，其余写小时 */
function leftText(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${Math.max(1, seconds)} 秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`
  return `${Math.floor(seconds / 3600)} 小时`
}

function Summary({ library, homework }: { library?: LibraryUsage; homework?: HomeworkUsage }) {
  const favorite = library?.favorite
  const habit = homework?.habit
  const closest = homework?.closest
  if (!favorite && !habit) return null
  const name = favorite ? `周${WEEKDAY_NAME[favorite.weekday]}` : ''
  return (
    <div className="panel usage-wide usage-summary">
      {favorite && library && (
        <p>
          你最喜欢在<b>{name}</b>去图书馆，过去一年内，你一共在图书馆学习了 <b>{trim(library.hours)}</b> 小时，其中的 <b>{trim(favorite.hours)}</b> 小时是在<b>{name}</b>度过的。
        </p>
      )}
      {habit && (
        <p>
          你最喜欢在<b>{HABIT_NAME[habit]}</b>时提交作业
          {closest ? (
            <>
              ，其中最紧张的一次是<b>{monthDay(beijingDay(closest.at))}</b>的「<b>{closest.title}</b>」，直到最后 <b>{leftText(closest.left)}</b> 才提交！
            </>
          ) : (
            '。'
          )}
        </p>
      )}
    </div>
  )
}

function Block({ title, read, wide, nav, children }: { title: string; read: ReactNode; wide?: boolean; nav?: ReactNode; children: ReactNode }) {
  return (
    <div className={wide ? 'panel usage-block usage-wide' : 'panel usage-block'}>
      <div className="usage-head">
        <h3 className="usage-title">{title}</h3>
        <span className="usage-side">
          <span className="usage-read">{read}</span>
          {nav}
        </span>
      </div>
      {children}
    </div>
  )
}

function Failed({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="usage-failed">
      <Quiet loading={false} error={error} empty="无" />
      <button className="act" onClick={retry}>
        重试
      </button>
    </div>
  )
}

/** 热图一块：右上角是当前显示范围的合计，悬停 / 轻触时换成那一天；缩短到三个月 / 一个月时可以前后翻页 */
function HeatBlock({
  title,
  days,
  steps,
  unit,
  range,
  error,
  retry
}: {
  title: string
  days?: Record<string, number>
  steps: number[]
  unit: string
  range: Range
  error: string | null
  retry: () => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const today = useMemo(() => beijingDay(Date.now()), [])
  const pages = Math.ceil((HEAT_WEEKS - range.weeks) / range.weeks)
  // 最早一页对齐到一年的开头，会和后一页重叠几周
  const back = Math.min(page * range.weeks, HEAT_WEEKS - range.weeks)
  const start = useMemo(() => shiftDay(heatStart(today, range.weeks), -back * 7), [today, range, back])
  const end = useMemo(() => (back === 0 ? today : shiftDay(start, range.weeks * 7 - 1)), [today, start, range, back])
  const total = useMemo(() => Object.entries(days ?? {}).reduce((sum, [day, n]) => (day >= start && day <= end ? sum + n : sum), 0), [days, start, end])
  const summary = days ? (
    <>
      <span>{page === 0 ? range.label : `${monthDay(start)} – ${monthDay(end)}`}</span>
      <span>
        {trim(total)} {unit}
      </span>
    </>
  ) : error ? (
    ''
  ) : (
    '…'
  )
  const nav =
    pages > 0 && (days || !error) ? (
      <span className="usage-nav">
        <IconButton label="更早" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          <path d="M14.5 6l-6 6 6 6" />
        </IconButton>
        <IconButton label="更近" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          <path d="M9.5 6l6 6-6 6" />
        </IconButton>
      </span>
    ) : undefined
  return (
    <Block title={title} read={hover ?? summary} nav={nav}>
      {!days && error ? <Failed error={error} retry={retry} /> : <Heat days={days} steps={steps} unit={unit} weeks={range.weeks} start={start} end={end} onRead={setHover} />}
    </Block>
  )
}

function Averages({ timing }: { timing: SubmitTiming }) {
  return (
    <>
      <span>中位 {percent(timing.median)}</span>
      <span>平均 {percent(timing.mean)}</span>
    </>
  )
}

/** 热图：一列一周（周一在上），最后一列是本周；范围由 rangeFor 选，格子是铺满宽度的正方形。悬停 / 轻触把这一天写到右上角，取消后回到合计 */
const Heat = memo(function Heat({
  days,
  steps,
  unit,
  weeks,
  start,
  end,
  onRead
}: {
  days?: Record<string, number>
  steps: number[]
  unit: string
  weeks: number
  start: string
  end: string
  onRead: (text: string | null) => void
}) {
  const cells = useMemo(() => {
    const list: string[] = []
    for (let d = start; d <= end; d = shiftDay(d, 1)) list.push(d)
    return list
  }, [start, end])
  // 月份标签占的列数：一年时列窄要多占几列
  const span = weeks === HEAT_WEEKS ? 4 : 2
  const months = useMemo(() => monthLabels(start, weeks, span - 1), [start, weeks, span])
  const lastColumn = weeks - span + 1

  const text = (day: string): string => `${dayLabel(day)} ${trim(days?.[day] ?? 0)} ${unit}`
  const over = (e: PointerEvent<HTMLDivElement>): void => {
    const day = (e.target as HTMLElement).dataset['day']
    if (day) onRead(text(day))
  }
  const leave = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse') onRead(null)
  }

  return (
    <>
      <div className="usage-heat" style={{ '--weeks': weeks } as CSSProperties}>
        <div className="usage-weekdays" aria-hidden>
          {/* 第一格对着月份那一行 */}
          {['', '一', '二', '三', '四', '五', '六', '日'].map((w, i) => (
            <span key={i}>{w}</span>
          ))}
        </div>
        <div>
          <div className="usage-months" aria-hidden>
            {months.map((m) => (
              // 最后几列放不下时靠右对齐到表格边上。写明 gridRow 才允许与前一个月的格子重叠，否则会被挤到下一行
              <span key={m.week} style={{ gridRow: 1, gridColumn: `${Math.min(m.week + 1, lastColumn)} / span ${span}`, justifySelf: m.week + 1 > lastColumn ? 'end' : 'start' }}>
                {m.month}月
              </span>
            ))}
          </div>
          <div className="usage-cells" onPointerOver={over} onPointerLeave={leave}>
            {cells.map((day) => (
              <i key={day} data-day={day} data-l={levelOf(days?.[day] ?? 0, steps)} title={text(day)} />
            ))}
          </div>
        </div>
      </div>
      <div className="usage-legend" aria-hidden>
        少
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} data-l={l} />
        ))}
        多
      </div>
    </>
  )
})

/** 每月第一次出现的那一周写月份；开头那个月只露一两列时不写，免得和下个月挤在一起 */
function monthLabels(start: string, weeks: number, minWeeks: number): { week: number; month: number }[] {
  const month = (w: number): number => Number(shiftDay(start, w * 7).slice(5, 7))
  const labels: { week: number; month: number }[] = []
  for (let w = 1; w < weeks; w++) if (month(w) !== month(w - 1)) labels.push({ week: w, month: month(w) })
  if ((labels[0]?.week ?? weeks) >= minWeeks) labels.unshift({ week: 0, month: month(0) })
  return labels
}

const BUCKET_LABELS = Array.from({ length: 10 }, (_, i) => `${i * 10}–${(i + 1) * 10}%`)

/** 提交时点分布：开放 → 截止十档，另加一列逾期；中位数所在的那一档用实色 */
function TimingBars({ timing, onRead }: { timing?: SubmitTiming; onRead: (text: string | null) => void }) {
  const counts = timing ? [...timing.buckets, timing.late] : Array.from({ length: 11 }, () => 0)
  const peak = Math.max(1, ...counts)
  const medianBin = timing?.median === null || timing?.median === undefined ? -1 : Math.min(9, Math.floor(timing.median * 10))
  const leave = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse') onRead(null)
  }

  return (
    <div className="usage-timing">
      <div className="usage-bars" onPointerLeave={leave}>
        {counts.map((n, i) => {
          const label = `${i === 10 ? '>100%' : BUCKET_LABELS[i]} ${n} 次`
          return (
            <div key={i} className="usage-bar" title={label} data-late={i === 10 || undefined} onPointerOver={() => onRead(label)}>
              <i style={{ height: n ? `max(3px, ${(n / peak) * 100}%)` : undefined }} data-median={i === medianBin || undefined} data-zero={n === 0 || undefined} />
            </div>
          )
        })}
      </div>
      <div className="usage-axis" aria-hidden>
        <span style={{ gridColumn: 1 }}>0%</span>
        <span style={{ gridColumn: 6, transform: 'translateX(-50%)' }}>50%</span>
        <span style={{ gridColumn: 10, justifySelf: 'end' }}>100%</span>
        <span className="usage-axis-late">&gt;100%</span>
      </div>
    </div>
  )
}
