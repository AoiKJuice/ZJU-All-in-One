import { useEffect, type ComponentType } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Sidebar } from './components/Sidebar'
import { useApp, type PageId } from './store'
import { Dashboard } from './pages/Dashboard'
import { Schedule } from './pages/Schedule'
import { Assignments, Exams, Replays } from './pages/Lists'
import { Tools } from './pages/Tools'

const PAGES: Record<PageId, ComponentType> = {
  dashboard: Dashboard,
  schedule: Schedule,
  exams: Exams,
  assignments: Assignments,
  replays: Replays,
  tools: Tools
}

export function App() {
  const page = useApp((s) => s.page)
  const refreshAuth = useApp((s) => s.refreshAuth)
  const Page = PAGES[page]

  useEffect(() => {
    void refreshAuth()
  }, [refreshAuth])

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative flex-1 overflow-y-auto">
        <div className="drag sticky top-0 z-10 h-10" />
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(2px)' }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto max-w-5xl px-8 pb-12"
          >
            <Page />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
