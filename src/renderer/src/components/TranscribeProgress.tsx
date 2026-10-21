import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { SystemStats, TaskProgress } from '@shared/types'

const STEPS = [
  ['engine', '引擎'],
  ['model', '模型'],
  ['audio', '音频'],
  ['transcribe', '识别']
] as const

const mb = (n: number): string => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : `${Math.round(n / (1 << 20))} MB`)
const pct = (r: number): string => `${Math.round(r * 100)}%`
const duration = (sec: number): string => {
  const s = Math.max(0, Math.round(sec))
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 转写进度：步骤、细线、速度/大小/剩余时间；悬停显示 CPU、内存、显存 */
export function TranscribeProgress({ task }: { task: TaskProgress }) {
  const [hover, setHover] = useState(false)
  const current = STEPS.findIndex(([k]) => k === task.stage)

  const detail = [
    task.bytes && `${mb(task.bytes.done)} / ${mb(task.bytes.total)}`,
    task.speed !== undefined && `${mb(task.speed)}/s`,
    task.ratio !== undefined && !task.bytes && pct(task.ratio),
    task.eta !== undefined && `剩余 ${duration(task.eta)}`
  ].filter(Boolean)

  return (
    <div className="relative mt-3" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <ol className="steps">
        {STEPS.map(([key, label], i) => (
          <li key={key} data-state={i < current ? 'done' : i === current ? 'now' : 'todo'}>
            {label}
          </li>
        ))}
      </ol>
      <div className="progress mt-2">
        <span style={{ width: pct(task.ratio ?? 0) }} />
      </div>
      <p className="quiet !py-2 tabular-nums">{detail.join('　·　') || '…'}</p>
      <AnimatePresence>{hover && <Stats />}</AnimatePresence>
    </div>
  )
}

function Stats() {
  const [stats, setStats] = useState<SystemStats | null>(null)

  useEffect(() => {
    let alive = true
    const tick = (): void => {
      void window.zju['system:stats']().then((s) => alive && setStats(s))
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const rows: [string, string][] = stats
    ? [
        ['CPU', pct(stats.cpu)],
        ['内存', `${mb(stats.memory.used)} / ${mb(stats.memory.total)}`],
        ['本应用', mb(stats.appMemory)],
        ...(stats.gpu
          ? ([
              ['GPU', `${pct(stats.gpu.util)}　${stats.gpu.name.replace(/^NVIDIA GeForce /, '')}`],
              ['显存', `${mb(stats.gpu.memUsed)} / ${mb(stats.gpu.memTotal)}`]
            ] as [string, string][])
          : [])
      ]
    : []

  return (
    <motion.dl
      className="stats"
      initial={{ opacity: 0, y: -4, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -4, filter: 'blur(4px)' }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      {stats ? rows.map(([k, v]) => [<dt key={`${k}t`}>{k}</dt>, <dd key={`${k}d`}>{v}</dd>]) : <dd>…</dd>}
    </motion.dl>
  )
}
