import { useEffect, useState, type ComponentType } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Masthead } from './components/Masthead'
import { useApp, type PageId } from './store'
import { Home } from './pages/Home'
import { Schedule } from './pages/Schedule'
import { Replay } from './pages/Replay'
import { Settings } from './pages/Settings'
import { Tools } from './pages/Tools'
import { AssignmentSheet } from './components/AssignmentSheet'
import { CourseSheet } from './components/CourseSheet'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toast } from './components/Toast'
import { LoginPanel } from './components/LoginPanel'
import { AgentConfirm } from './components/AgentConfirm'
import { FormPrompt } from './components/FormPrompt'
import { FilePreview } from './components/FilePreview'
import { Logo } from './components/Logo'
import { LiquidGlass } from './components/LiquidGlass'
import { dur } from '@renderer/lib/motion'
import { MOBILE } from '@renderer/lib/platform'

const PAGES: Record<PageId, ComponentType> = {
  home: Home,
  schedule: Schedule,
  replay: Replay,
  tools: Tools,
  settings: Settings
}

export function App() {
  const page = useApp((s) => s.page)
  const emblem = useApp((s) => s.settings.emblem)
  const style = useApp((s) => s.settings.style)
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
      {/* 钟鹰衬底：左下角越出窗口、半透明，回放页不放（让位给视频） */}
      <AnimatePresence>
        {emblem && page !== 'replay' && (
          // 与 Reveal 同一套"上浮 + 去模糊"；它挂在页面外层，在都有衬底的页面之间切换时保持不动，不重播动画
          <motion.div
            key="emblem"
            className="page-emblem"
            // 衬底很大，只上浮淡入不模糊（大面积 filter 动画在部分显卡上会闪烁）
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0, transitionEnd: { transform: 'none' } }}
            exit={{ opacity: 0, transition: { duration: dur(0.22), ease: [0.22, 1, 0.36, 1] } }}
            transition={{ duration: dur(0.75), ease: [0.22, 1, 0.36, 1], delay: dur(0.08) }}
          >
            <Logo />
          </motion.div>
        )}
      </AnimatePresence>
      <Masthead scroller={scroller} />
      <main ref={setScroller} className="app-scroller relative z-0 h-full overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            // 整页退场只淡出：全窗口的 filter 动画要把整页离屏渲染再模糊，切页时卡片闪烁、显卡负担重
            exit={{ opacity: 0 }}
            transition={{ duration: dur(0.22), ease: [0.22, 1, 0.36, 1] }}
          >
            <ErrorBoundary>
              <Page />
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </main>
      <ErrorBoundary>
        <CourseSheet />
      </ErrorBoundary>
      <ErrorBoundary>
        <AssignmentSheet />
      </ErrorBoundary>
      <LoginPanel />
      <AgentConfirm />
      {!MOBILE && <FormPrompt />}
      <FilePreview />
      <Toast />
      {style === 'glass' && <LiquidGlass />}
    </>
  )
}
