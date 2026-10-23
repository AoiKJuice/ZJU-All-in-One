import { useEffect, useState, type ComponentType } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Masthead } from './components/Masthead'
import { useApp, type PageId } from './store'
import { Home } from './pages/Home'
import { Schedule } from './pages/Schedule'
import { Replay } from './pages/Replay'
import { Settings } from './pages/Settings'
import { AssignmentSheet } from './components/AssignmentSheet'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toast } from './components/Toast'
import { LoginPanel } from './components/LoginPanel'

const PAGES: Record<PageId, ComponentType> = {
  home: Home,
  schedule: Schedule,
  replay: Replay,
  settings: Settings
}

export function App() {
  const page = useApp((s) => s.page)
  const refreshAuth = useApp((s) => s.refreshAuth)
  const back = useApp((s) => s.back)
  const forward = useApp((s) => s.forward)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const Page = PAGES[page]

  useEffect(() => {
    void refreshAuth()
  }, [refreshAuth])

  // 鼠标侧键：3 返回，4 前进
  useEffect(() => {
    const onUp = (e: MouseEvent): void => {
      if (e.button === 3) back()
      else if (e.button === 4) forward()
      else return
      e.preventDefault()
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [back, forward])

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
            <ErrorBoundary>
              <Page />
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </main>
      <ErrorBoundary>
        <AssignmentSheet />
      </ErrorBoundary>
      <LoginPanel />
      <Toast />
    </>
  )
}
