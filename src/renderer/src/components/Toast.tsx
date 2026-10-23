import { AnimatePresence, motion } from 'motion/react'
import { useApp } from '@renderer/store'

/** 底部居中一行小字，5 秒后消失 */
export function Toast() {
  const toast = useApp((s) => s.toast)
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          className="toast"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          {toast.text}
          {toast.action && (
            <button className="act ml-4" onClick={toast.action.run}>
              {toast.action.label}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
