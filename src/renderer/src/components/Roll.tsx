import { AnimatePresence, motion } from 'motion/react'
import { dur } from '@renderer/lib/motion'

const EASE = [0.22, 1, 0.36, 1] as const

// 往后翻时旧字向上滚走、新字从下面滚上来，往前翻反之
const roll = {
  enter: (dir: number) => ({ y: dir >= 0 ? '100%' : '-100%', opacity: 0 }),
  center: { y: '0%', opacity: 1 },
  exit: (dir: number) => ({ y: dir >= 0 ? '-100%' : '100%', opacity: 0 })
}

/**
 * 密码锁式滚动文字：按位比较，变了的那一位上下滚动换字，没变的不动（如「秋七周」→「秋八周」只滚「七」）。
 * dir 为滚动方向（1 向上，-1 向下）
 */
export function Roll({ text, dir }: { text: string; dir: number }) {
  return (
    <span className="roll" aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={i} className="roll-slot" aria-hidden>
          <AnimatePresence initial={false} custom={dir} mode="popLayout">
            <motion.span
              key={ch}
              className="roll-char"
              custom={dir}
              variants={roll}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: dur(0.45), ease: EASE, delay: dur(i * 0.03) }}
            >
              {ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  )
}
