import { create } from 'zustand'
import type { Assignment, AuthState, LectureReplay, TaskProgress, TranscriptSegment } from '@shared/types'
import { applyTheme, initialTheme, type Theme } from './lib/theme'

export type PageId = 'home' | 'schedule' | 'replay'

interface AppStore {
  page: PageId
  /** 回放页当前打开的课次 */
  replay: LectureReplay | null
  /** 侧页中打开的作业 */
  assignment: Assignment | null
  /** 主进程推送的长任务进度，按 key 存最新一条 */
  tasks: Record<string, TaskProgress>
  /** 转写中实时识别出的段落，按任务 key 累积 */
  partials: Record<string, TranscriptSegment[]>
  clearPartials: (key: string) => void
  theme: Theme
  auth: AuthState
  authBusy: boolean
  /** 首次 auth:state 返回前为 false，数据 hook 等它再决定是否取数 */
  authReady: boolean
  /** 每次登录状态变化 +1，数据 hook 据此重新拉取 */
  epoch: number
  go: (page: PageId) => void
  openReplay: (replay: LectureReplay) => void
  openAssignment: (assignment: Assignment | null) => void
  /** 让所有数据 hook 重新拉取（如提交作业后） */
  refresh: () => void
  toggleTheme: () => void
  refreshAuth: () => Promise<void>
  login: () => Promise<void>
  logout: () => Promise<void>
}

export const useApp = create<AppStore>((set, get) => {
  const runAuth = async (call: () => Promise<AuthState>): Promise<void> => {
    set({ authBusy: true })
    try {
      const auth = await call()
      set((s) => ({ auth, authReady: true, epoch: s.auth.loggedIn === auth.loggedIn ? s.epoch : s.epoch + 1 }))
    } finally {
      set({ authBusy: false })
    }
  }

  const theme = initialTheme()
  applyTheme(theme)

  return {
    page: 'home',
    replay: null,
    assignment: null,
    tasks: {},
    partials: {},
    clearPartials: (key) => set((s) => ({ partials: { ...s.partials, [key]: [] } })),
    theme,
    auth: { loggedIn: false, user: null },
    authBusy: false,
    authReady: false,
    epoch: 0,
    go: (page) => set({ page }),
    openReplay: (replay) => set({ replay, page: 'replay' }),
    openAssignment: (assignment) => set({ assignment }),
    refresh: () => set((s) => ({ epoch: s.epoch + 1 })),
    toggleTheme: () => {
      const next = get().theme === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      set({ theme: next })
    },
    refreshAuth: () => runAuth(() => window.zju['auth:state']()),
    login: () => runAuth(() => window.zju['auth:login']()),
    logout: () => runAuth(() => window.zju['auth:logout']())
  }
})

// 进度事件全局订阅一次，离开回放页也不丢
window.zju.onProgress((p) =>
  useApp.setState((s) => ({
    tasks: { ...s.tasks, [p.key]: p },
    partials: p.partial?.length ? { ...s.partials, [p.key]: [...(s.partials[p.key] ?? []), ...p.partial] } : s.partials
  }))
)
