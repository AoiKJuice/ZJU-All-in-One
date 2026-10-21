import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useApp, type PageId } from '@renderer/store'

const NAV: { id: PageId; label: string }[] = [
  { id: 'home', label: '主页' },
  { id: 'schedule', label: '课表' },
  { id: 'tools', label: '工具' }
]

/** 刊头：字标、三项导航（朱点随切换滑动）、登录与昼夜切换 */
export function Masthead({ scroller }: { scroller: HTMLElement | null }) {
  const { page, go, auth, authBusy, login, logout, theme, toggleTheme } = useApp()
  const [solid, setSolid] = useState(false)
  // 退出需两次点击：第一次把名字换成"退出"，3 秒内再点才生效
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  const onAuth = (): void => {
    if (!auth.loggedIn) void login()
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

  return (
    <header className="masthead drag" data-solid={solid || undefined}>
      <span className="wordmark">
        ZJU <i>All</i> in One
      </span>
      <nav className="mast-nav">
        {NAV.map(({ id, label }) => (
          <button key={id} className="mast-link" data-active={page === id || undefined} onClick={() => go(id)}>
            {label}
            {page === id && (
              <motion.span layoutId="mark-dot" className="mark-dot" transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
            )}
          </button>
        ))}
      </nav>
      <div className="mast-meta">
        <button disabled={authBusy} onClick={onAuth} data-armed={armed || undefined} className="data-[armed]:text-[var(--shu)]">
          {!auth.loggedIn ? '登录' : armed ? '退出' : (auth.user?.name ?? '已登录')}
        </button>
        <button onClick={toggleTheme} aria-label="切换昼夜" className="grid w-5 place-items-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={theme}
              initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              {theme === 'dark' ? '夜' : '昼'}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </header>
  )
}
