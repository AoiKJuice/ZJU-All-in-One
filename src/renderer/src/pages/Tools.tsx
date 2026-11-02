import { AnimatePresence, motion } from 'motion/react'
import { OutlineWord, Reveal } from '@renderer/components/Type'
import { useApp } from '@renderer/store'
import { TOOLS } from '@renderer/tools'
import { dur } from '@renderer/lib/motion'

/** 工具：入口网格（徽标 + 名称，悬停时徽标动起来）；点开后整页是该工具，标题左侧返回入口 */
export function Tools() {
  const tool = useApp((s) => s.tool)
  const openTool = useApp((s) => s.openTool)
  const current = TOOLS.find((t) => t.id === tool)

  return (
    <div className="page tools-page">
      <OutlineWord text="Tools" />
      <AnimatePresence mode="wait" initial={false}>
        {current ? (
          <motion.div key={current.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: dur(0.25) }}>
            <Reveal className="tool-head">
              <button className="tool-back" aria-label="返回工具" onClick={() => openTool(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14.5 6l-6 6 6 6" />
                </svg>
              </button>
              <h1 className="page-title">{current.name}</h1>
            </Reveal>
            <current.View />
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: dur(0.25) }}>
            <Reveal>
              <h1 className="page-title">工具</h1>
            </Reveal>
            <div className="tool-grid">
              {TOOLS.map((t, i) => (
                <Reveal key={t.id} i={i + 1} flat>
                  <button className="tool-card" onClick={() => openTool(t.id)}>
                    <span className="tool-icon">
                      <t.Icon />
                    </span>
                    <span className="tool-name">{t.name}</span>
                  </button>
                </Reveal>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
