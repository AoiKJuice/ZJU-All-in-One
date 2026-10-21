import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { RotateCw } from 'lucide-react'

export function PageHeader(props: {
  title: string
  subtitle?: string
  source?: 'live' | 'mock'
  onReload?: () => void
  loading?: boolean
}) {
  return (
    <header className="mb-6 flex items-end justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
        {props.subtitle && <p className="mt-1 text-sm text-muted">{props.subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {props.source === 'mock' && (
          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">示例数据</span>
        )}
        {props.onReload && (
          <button
            onClick={props.onReload}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-surface hover:text-ink"
            title="刷新"
          >
            <RotateCw size={16} className={props.loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>
    </header>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${className}`}>
      {children}
    </div>
  )
}

/** Staggered fade-up list; wrap each child in <StaggerItem>. */
export function Stagger({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.05 } } }}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 8 },
        show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }
      }}
    >
      {children}
    </motion.div>
  )
}

export function Empty({ text }: { text: string }) {
  return <p className="py-10 text-center text-sm text-muted">{text}</p>
}
