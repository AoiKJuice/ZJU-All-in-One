import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useApp, type PageId } from '@renderer/store'
import { MOBILE } from '@renderer/lib/platform'

// 工具页目前为空，手机端先不放
const NAV: { id: PageId; label: string }[] = [
  { id: 'home', label: '主页' },
  { id: 'schedule', label: '课表' },
  ...(MOBILE ? [] : [{ id: 'tools' as const, label: '工具' }]),
  { id: 'settings', label: '设置' }
]

/** 刊头：字标、三项导航（朱点随切换滑动）、登录与昼夜切换；手机端导航移到底部标签栏，回放页整条收起让位给视频 */
export function Masthead({ scroller }: { scroller: HTMLElement | null }) {
  const { page, go, auth, authBusy, loginOpen, setLoginOpen, logout, theme, toggleTheme } = useApp()
  const [solid, setSolid] = useState(false)
  // 退出需两次点击：第一次把名字换成"退出"，3 秒内再点才生效
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  const onAuth = (): void => {
    if (!auth.loggedIn) setLoginOpen(!loginOpen)
    else if (armed) {
      setArmed(false)
      void logout()
    } else setArmed(true)
  }

  useEffect(() => {
    if (!scroller) return
    const onScroll = (): void => setSolid(scroller.scrollTop > 12)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [scroller])

  const nav = NAV.map(({ id, label }) => (
    <button key={id} className="mast-link" data-active={page === id || undefined} onClick={() => go(id)}>
      {label}
      {page === id && <motion.span layoutId="mark-dot" className="mark-dot" transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />}
    </button>
  ))

  if (MOBILE && page === 'replay') return null

  return (
    <>
    {MOBILE && <nav className="tabbar">{nav}</nav>}
    <header className="masthead drag" data-solid={solid || undefined}>
      <span className="wordmark">
        ZJU <i>All</i> in One
      </span>
      {MOBILE ? <span className="mr-auto" /> : <nav className="mast-nav">{nav}</nav>}
      <div className="mast-meta">
        <button
          data-login-toggle
          disabled={authBusy}
          onClick={onAuth}
          data-armed={armed || loginOpen || undefined}
          className="data-[armed]:text-[var(--shu)]"
        >
          {!auth.loggedIn ? '登录' : armed ? '退出' : (auth.account ?? '已登录')}
        </button>
        <button onClick={toggleTheme} aria-label="切换深浅色" title="切换深浅色" className="theme-toggle">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={theme}
              initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </header>
    </>
  )
}

// 深浅色切换：细线日 / 月图标，比单个「昼」「夜」字好认
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  )
}
