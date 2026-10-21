import { motion } from 'motion/react'
import {
  BookOpenCheck,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  LogIn,
  LogOut,
  PlayCircle,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import { useApp, type PageId } from '@renderer/store'

const NAV: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: '概览', icon: LayoutDashboard },
  { id: 'schedule', label: '课表', icon: CalendarDays },
  { id: 'exams', label: '考试', icon: BookOpenCheck },
  { id: 'assignments', label: '作业', icon: ClipboardList },
  { id: 'replays', label: '课程回放', icon: PlayCircle },
  { id: 'tools', label: '工具箱', icon: Wrench }
]

export function Sidebar() {
  const { page, go, auth, authBusy, login, logout } = useApp()

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface/60 backdrop-blur-xl">
      <div className="drag flex h-16 items-end px-5 pb-2">
        <span className="text-[15px] font-semibold tracking-tight">
          ZJU <span className="text-accent">All in One</span>
        </span>
      </div>

      <nav className="mt-4 flex flex-1 flex-col gap-1 px-3">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = page === id
          return (
            <button
              key={id}
              onClick={() => go(id)}
              className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                active ? 'text-accent' : 'text-muted hover:text-ink'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-lg bg-accent-soft"
                  transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                />
              )}
              <Icon size={17} className="relative" />
              <span className="relative font-medium">{label}</span>
            </button>
          )
        })}
      </nav>

      <div className="border-t border-line p-3">
        <button
          disabled={authBusy}
          onClick={() => (auth.loggedIn ? logout() : login())}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-accent-soft hover:text-ink disabled:opacity-50"
        >
          {auth.loggedIn ? <LogOut size={17} /> : <LogIn size={17} />}
          <span className="font-medium">{auth.loggedIn ? '退出登录' : '统一身份认证登录'}</span>
        </button>
      </div>
    </aside>
  )
}
