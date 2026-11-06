import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { XkSection, XkSlot } from '@shared/xk'
import { useApp } from '@renderer/store'
import { halfOf, parityLabel, slotLabel } from './xkLogic'

export function Chevron({ className = 'xk-chevron' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className="xk-icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}

export const CrossPath = () => <path d="M7 7l10 10M17 7L7 17" />

/** 写操作按钮：第一次点击变成「确认…」，3 秒内再点才执行 */
export function ArmedButton({ label, confirm, onRun, disabled, className = 'act' }: { className?: string; label: ReactNode; confirm: ReactNode; onRun: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <button
      className={className}
      data-on={armed || undefined}
      data-armed={armed || undefined}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        if (!armed) return setArmed(true)
        setArmed(false)
        onRun()
      }}
    >
      {armed ? confirm : label}
    </button>
  )
}

/** 时间：每段一枚小标签（撞上别的课时主题色），单双周与半学期跟在后面 */
export function When({ s, clash }: { s: XkSection; clash?: (slot: XkSlot) => 'hard' | 'lead' | null }) {
  const half = halfOf(s.semesterPart)
  return (
    <span className="xk-when">
      {s.slots.length
        ? s.slots.map((t, i) => (
            <span key={i} className="xk-slot" data-clash={clash?.(t) ?? undefined}>
              {slotLabel(t)}
              <small>节</small>
              {parityLabel(t) && <em>{parityLabel(t)}</em>}
            </span>
          ))
        : s.times.map((t) => (
            <span key={t} className="xk-slot">
              {t}
            </span>
          ))}
      {half && <span className="xk-slot xk-half">{half}</span>}
    </span>
  )
}

/** 2027年01月15日(08:00-10:00) → 1月15日 08:00 */
export const examLabel = (exam: string): string => {
  const m = /(\d{4})年(\d{1,2})月(\d{1,2})日\s*\((\d{1,2}:\d{2})/.exec(exam)
  return m ? `${Number(m[2])}月${Number(m[3])}日 ${m[4]}` : exam
}

/** 考试时间的比较键（同一天同一开考时刻即撞） */
export const examKey = (exam: string): string | null => {
  const m = /(\d{4})年(\d{1,2})月(\d{1,2})日\s*\((\d{1,2}:\d{2})/.exec(exam)
  return m ? `${m[1]}-${Number(m[2])}-${Number(m[3])} ${m[4]}` : null
}

export const fmt = (n: number): string => String(Number(n.toFixed(2)))

/**
 * 筛选栏里的一枚控件：浅底胶囊，左边小字是条件名、右边是当前值，带下拉箭头；点开在下方弹出面板。
 * 面板点别处、Esc、窗口变化时收起
 */
export function Dropdown({
  label,
  value,
  active,
  wide,
  children
}: {
  label: string
  value: ReactNode
  /** 已设了非默认值：主题色 */
  active?: boolean
  wide?: boolean
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !button.current || !panel.current) return
    const r = button.current.getBoundingClientRect()
    const w = panel.current.offsetWidth
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + 6 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    const onDown = (e: PointerEvent): void => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [open])

  return (
    <>
      <button ref={button} className="xk-ctl" data-on={active || undefined} data-open={open || undefined} onClick={() => setOpen((x) => !x)}>
        <span className="xk-ctl-label">{label}</span>
        <span className="xk-ctl-value">{value}</span>
        <Chevron className="xk-ctl-chevron" />
      </button>
      {open && (
        <div ref={panel} className="xk-pop" data-wide={wide || undefined} style={at ?? { visibility: 'hidden', left: 0, top: 0 }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </>
  )
}

/** 开关类条件：同样的浅底胶囊，打开后主题色 */
export function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className="xk-ctl" data-on={on || undefined} aria-pressed={on} onClick={onClick}>
      <span className="xk-ctl-value">{children}</span>
    </button>
  )
}

/** 面板里的一个选项 */
export function Option({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className="xk-opt" data-active={active || undefined} onClick={onClick}>
      {children}
    </button>
  )
}

/**
 * 出错时的一行状态，每种都给能直接做的下一步：未登录 → 登录；选课首页没有选课参数 → 不在选课时间、刷新；其余 → 原因、重试
 */
export function XkStatus({ error, onRetry }: { error: string; onRetry: () => void }) {
  const setLoginOpen = useApp((s) => s.setLoginOpen)
  if (/未登录/.test(error))
    return (
      <div className="xk-empty">
        <p className="quiet">未登录</p>
        <button className="btn btn-solid" onClick={() => setLoginOpen(true)}>
          登录
        </button>
      </div>
    )
  return (
    <div className="xk-empty">
      <p className="quiet">{/未开放/.test(error) ? '不在选课时间' : error}</p>
      <button className="btn" onClick={onRetry}>
        {/未开放/.test(error) ? '刷新' : '重试'}
      </button>
    </div>
  )
}
