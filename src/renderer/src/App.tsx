import { useEffect, useState, type ComponentType } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Masthead } from './components/Masthead'
import { useApp, type PageId } from './store'
import { Home } from './pages/Home'
import { Schedule } from './pages/Schedule'
import { Replay } from './pages/Replay'
import { AssignmentSheet } from './components/AssignmentSheet'

const PAGES: Record<PageId, ComponentType> = {
  home: Home,
  schedule: Schedule,
  replay: Replay
}

export function App() {
  const page = useApp((s) => s.page)
  const refreshAuth = useApp((s) => s.refreshAuth)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const Page = PAGES[page]

  useEffect(() => {
    void refreshAuth()
  }, [refreshAuth])

  useEffect(() => {
    scroller?.scrollTo({ top: 0 })
  }, [page, scroller])

  return (
    <>
      <Masthead scroller={scroller} />
      <main ref={setScroller} className="relative z-0 h-full overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            exit={{ opacity: 0, filter: 'blur(6px)' }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <Page />
          </motion.div>
        </AnimatePresence>
      </main>
      <AssignmentSheet />
    </>
  )
}
