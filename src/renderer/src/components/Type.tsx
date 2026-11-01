import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useApp } from '@renderer/store'
import { dur } from '@renderer/lib/motion'

/** 空心大字：描边逐笔绘出，按文字实际宽度设置画布 */
export function OutlineWord({ text, size = 200 }: { text: string; size?: number }) {
  const ref = useRef<SVGTextElement>(null)
  const [width, setWidth] = useState(text.length * size * 0.5)

  useLayoutEffect(() => {
    const measure = (): void => setWidth(Math.ceil(ref.current!.getBBox().width + size * 0.12))
    measure()
    void document.fonts.ready.then(measure)
  }, [text, size])

  return (
    <svg className="outline-word" viewBox={`0 0 ${width} ${size * 1.05}`} aria-hidden="true">
      <text ref={ref} x={size * 0.04} y={size * 0.8}>
        {text}
      </text>
    </svg>
  )
}

const EASE = [0.22, 1, 0.36, 1] as const

/** 轻微上浮 + 去模糊；i 决定错落延迟 */
/**
 * 进入动画：上浮 + 去模糊，按 i 错落。flat 用于大块面板（主页区块、设置面板、课表、回放两栏）：只上浮淡入不模糊——
 * 大面积 filter 动画每块都要离屏渲染，在部分显卡上会让面板闪烁（用户反馈：从设置回主页时四块卡片闪几下）
 */
export function Reveal({ i = 0, flat, children, className }: { i?: number; flat?: boolean; children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={flat ? { opacity: 0, y: 14 } : { opacity: 0, y: 14, filter: 'blur(5px)' }}
      // 动画结束后去掉 filter/transform：它们会让内部 position: fixed（如铺满的播放器）只相对本块定位
      animate={flat ? { opacity: 1, y: 0, transitionEnd: { transform: 'none' } } : { opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none', transform: 'none' } }}
      transition={{ duration: dur(0.7), ease: EASE, delay: dur(i * 0.045) }}
    >
      {children}
    </motion.div>
  )
}

export function SectionHead({ title, note }: { title: string; note?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 className="section-title">{title}</h2>
      {note && <span className="section-note">{note}</span>}
    </div>
  )
}

/** 区块的空 / 错 / 未登录状态，统一一行安静的小字 */
export function Quiet({ error, empty, loading }: { error: string | null; empty: string; loading: boolean }) {
  const { auth, setLoginOpen } = useApp()
  if (loading) return <p className="quiet">…</p>
  if (!auth.loggedIn && !import.meta.env.VITE_ZJU_DEMO)
    return (
      <p className="quiet">
        <button data-login-toggle onClick={() => setLoginOpen(true)}>
          登录
        </button>
      </p>
    )
  return <p className="quiet">{error ?? empty}</p>
}

/**
 * 并列的几段信息，空项跳过：不用竖线或点号分隔，段与段之间留白；在侧页 / 详情顶部（.sheet-meta 等）显示为浅底小标签。
 * 每段整体换行（.part），不会把「东1A-201」这类字段拆到两行
 */
export function Joined({ parts }: { parts: ReactNode[] }) {
  const items = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '')
  return (
    <>
      {items.map((p, i) => (
        <span key={i} className="part">
          {p}
        </span>
      ))}
    </>
  )
}

/**
 * 选项：选中项文字转为主题色，背后一块主题色浅底的圆角滑块；同一 group 的选项之间切换时滑块移动过去。
 * multi（可多选的开关组）时滑块不在选项间移动，只在原地淡入淡出
 */
export function Choice({
  group,
  active,
  onClick,
  multi = false,
  className = '',
  children
}: {
  group: string
  active: boolean
  onClick: () => void
  multi?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <button className={`choice ${className}`} data-active={active || undefined} onClick={onClick}>
      {multi ? (
        <AnimatePresence initial={false}>
          {active && (
            <motion.span
              key="pill"
              className="choice-pill"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: dur(0.3) }}
            />
          )}
        </AnimatePresence>
      ) : (
        active && <motion.span layoutId={`choice-${group}`} className="choice-pill" transition={{ duration: dur(0.45), ease: [0.22, 1, 0.36, 1] }} />
      )}
      <span className="choice-label">{children}</span>
    </button>
  )
}

/** 高度随内容平滑变化（展开 / 收起、数据到达时），用 ResizeObserver 量内层高度再让外层动画过去 */
export function AutoHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>('auto')
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <motion.div className="overflow-hidden" initial={false} animate={{ height }} transition={{ duration: dur(0.5), ease: EASE }}>
      <div ref={inner}>{children}</div>
    </motion.div>
  )
}
