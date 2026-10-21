import { create } from 'zustand'
import type { AuthState } from '@shared/types'
import { applyTheme, initialTheme, type Theme } from './lib/theme'

export type PageId = 'home' | 'schedule' | 'tools'

interface AppStore {
  page: PageId
  theme: Theme
  auth: AuthState
  authBusy: boolean
  /** 首次 auth:state 返回前为 false，数据 hook 等它再决定是否取数 */
  authReady: boolean
  /** 每次登录状态变化 +1，数据 hook 据此重新拉取 */
  epoch: number
  go: (page: PageId) => void
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
    theme,
    auth: { loggedIn: false, user: null },
    authBusy: false,
    authReady: false,
    epoch: 0,
    go: (page) => set({ page }),
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
