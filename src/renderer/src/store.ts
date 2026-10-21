import { create } from 'zustand'
import type { AuthState } from '@shared/types'

export type PageId = 'dashboard' | 'schedule' | 'exams' | 'assignments' | 'replays' | 'tools'

interface AppStore {
  page: PageId
  auth: AuthState
  authBusy: boolean
  go: (page: PageId) => void
  refreshAuth: () => Promise<void>
  login: () => Promise<void>
  logout: () => Promise<void>
}

export const useApp = create<AppStore>((set) => {
  const runAuth = async (call: () => Promise<AuthState>): Promise<void> => {
    set({ authBusy: true })
    try {
      set({ auth: await call() })
    } finally {
      set({ authBusy: false })
    }
  }

  return {
    page: 'dashboard',
    auth: { loggedIn: false, user: null },
    authBusy: false,
    go: (page) => set({ page }),
    refreshAuth: () => runAuth(() => window.zju['auth:state']()),
    login: () => runAuth(() => window.zju['auth:login']()),
    logout: () => runAuth(() => window.zju['auth:logout']())
  }
})
