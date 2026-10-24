import { create } from 'zustand'
import type { Assignment, AuthState, ConfirmRequest, LectureReplay, TaskProgress, TranscriptSegment } from '@shared/types'
import type { Theme } from './lib/theme'
import { applySettings, initialSettings, type Settings } from './lib/settings'

export type PageId = 'home' | 'schedule' | 'replay' | 'settings'

/** 一条浏览记录：页面 + 回放页所开的课次 */
interface Visit {
  page: PageId
  replay: LectureReplay | null
}

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
  settings: Settings
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  auth: AuthState
  authBusy: boolean
  /** 首次 auth:state 返回前为 false，数据 hook 等它再决定是否取数 */
  authReady: boolean
  /** 每次登录状态变化 +1，数据 hook 据此重新拉取 */
  epoch: number
  /** 浏览记录，鼠标侧键前进 / 返回 */
  past: Visit[]
  future: Visit[]
  back: () => void
  forward: () => void
  go: (page: PageId) => void
  openReplay: (replay: LectureReplay) => void
  openAssignment: (assignment: Assignment | null) => void
  /** 让所有数据 hook 重新拉取（如提交作业后） */
  refresh: () => void
  /** 底部轻提示；action 为可选的文字按钮 */
  toast: { id: number; text: string; action?: { label: string; run: () => void } } | null
  notify: (text: string, action?: { label: string; run: () => void }) => void
  toggleTheme: () => void
  refreshAuth: () => Promise<void>
  /** 正在预览的本机文件路径 */
  preview: string | null
  openPreview: (path: string | null) => void
  /** 待用户确认的 Agent 提交 / 撤回，排队逐个显示 */
  confirms: ConfirmRequest[]
  answerConfirm: (id: string, approve: boolean) => void
  /** 登录面板是否展开 */
  loginOpen: boolean
  setLoginOpen: (open: boolean) => void
  /** 带账号密码为程序内登录，不带为网页登录；失败时抛出 */
  login: (account?: { username: string; password: string }) => Promise<void>
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

  // 换页时把当前页记入 past，清空 future；同一页同一课次不记
  const visit = (next: Visit): void => {
    const { page, replay, past } = get()
    if (page === next.page && replay?.id === next.replay?.id) return
    set({ ...next, past: [...past, { page, replay }].slice(-50), future: [] })
  }

  const settings = initialSettings()
  applySettings(settings)

  return {
    page: 'home',
    replay: null,
    assignment: null,
    tasks: {},
    partials: {},
    clearPartials: (key) => set((s) => ({ partials: { ...s.partials, [key]: [] } })),
    theme: settings.theme,
    settings,
    setSetting: (key, value) => {
      const next = { ...get().settings, [key]: value }
      applySettings(next)
      set({ settings: next, theme: next.theme })
    },
    auth: { loggedIn: false, user: null, account: null },
    authBusy: false,
    authReady: false,
    epoch: 0,
    past: [],
    future: [],
    back: () => {
      const { past, future, page, replay, assignment } = get()
      // 作业侧页开着时，返回先关侧页
      if (assignment) return set({ assignment: null })
      const prev = past.at(-1)
      if (prev) set({ ...prev, past: past.slice(0, -1), future: [{ page, replay }, ...future] })
    },
    forward: () => {
      const { past, future, page, replay } = get()
      const next = future[0]
      if (next) set({ ...next, past: [...past, { page, replay }], future: future.slice(1) })
    },
    go: (page) => visit({ page, replay: get().replay }),
    openReplay: (replay) => visit({ page: 'replay', replay }),
    openAssignment: (assignment) => set({ assignment }),
    refresh: () => set((s) => ({ epoch: s.epoch + 1 })),
    toast: null,
    notify: (text, action) => {
      const id = Date.now()
      set({ toast: { id, text, action } })
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null })
      }, 5000)
    },
    toggleTheme: () => get().setSetting('theme', get().theme === 'dark' ? 'light' : 'dark'),
    refreshAuth: () => runAuth(() => window.zju['auth:state']()),
    preview: null,
    openPreview: (preview) => set({ preview }),
    confirms: [],
    answerConfirm: (id, approve) => {
      void window.zju['mcp:answer'](id, approve)
      set((s) => ({ confirms: s.confirms.filter((c) => c.id !== id) }))
    },
    loginOpen: false,
    setLoginOpen: (loginOpen) => set({ loginOpen }),
    login: async (account) => {
      await runAuth(() => window.zju['auth:login'](account))
      if (get().auth.loggedIn) set({ loginOpen: false })
    },
    logout: () => runAuth(() => window.zju['auth:logout']())
  }
})

// 本地 Agent 经 MCP 调 refresh 时，界面跟着重拉
window.zju.onRefresh(() => {
  void useApp.getState().refreshAuth()
  useApp.getState().refresh()
})

// 本地 Agent 经 MCP 的 open_in_app 打开页面 / 课次 / 作业 / 登录面板
window.zju.onOpen((request) => {
  const s = useApp.getState()
  if ('page' in request) s.go(request.page)
  else if ('login' in request) s.setLoginOpen(true)
  else if ('assignment' in request) s.openAssignment(request.assignment)
  else s.openReplay(request.replay)
})

// 后台自动重登成功后主进程通知，刊头与数据随之更新
window.zju.onAuth(() => void useApp.getState().refreshAuth())

// 未登录时（如开机网络还没好导致自动重登失败）在这些时机重试；没有保存账号时主进程只查一下 cookie，开销很小
const retryAuth = (): void => {
  const s = useApp.getState()
  if (s.authReady && !s.auth.loggedIn && !s.authBusy) void s.refreshAuth()
}
window.addEventListener('focus', retryAuth)
window.addEventListener('online', retryAuth)
setInterval(retryAuth, 60_000)

// Agent 发起的提交 / 撤回进入确认队列
window.zju.onConfirm((request) => useApp.setState((s) => ({ confirms: [...s.confirms, request] })))

// 进度事件全局订阅一次，离开回放页也不丢
window.zju.onProgress((p) =>
  useApp.setState((s) => ({
    tasks: { ...s.tasks, [p.key]: p },
    partials: p.partial?.length ? { ...s.partials, [p.key]: [...(s.partials[p.key] ?? []), ...p.partial] } : s.partials
  }))
)
