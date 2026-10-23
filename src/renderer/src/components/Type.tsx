import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { useApp } from '@renderer/store'

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
export function Reveal({ i = 0, children, className }: { i?: number; children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14, filter: 'blur(5px)' }}
      // 动画结束后去掉 filter/transform：它们会让内部 position: fixed（如铺满的播放器）只相对本块定位
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none', transform: 'none' } }}
      transition={{ duration: 1.1, ease: EASE, delay: i * 0.06 }}
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
  const { auth, login } = useApp()
  if (loading) return <p className="quiet">…</p>
  if (!auth.loggedIn && !import.meta.env.VITE_ZJU_DEMO)
    return (
      <p className="quiet">
        <button onClick={login}>登录</button>
      </p>
    )
  return <p className="quiet">{error ?? empty}</p>
}
