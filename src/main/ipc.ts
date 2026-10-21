import { BrowserWindow, ipcMain } from 'electron'
import type { ZjuApi, ZjuChannel } from '@shared/ipc'
import type { AuthState } from '@shared/types'
import { hasCasCookie, login, logout } from './auth/zjuam'
import {
  fetchSchedule,
  fetchExams,
  fetchProfile,
  reset as resetZdbk
} from './services/zdbk'
import { fetchAssignments, reset as resetCourses } from './services/courses'
import { fetchReplays, reset as resetClassroom } from './services/classroom'
import { mock, mockAssignments, mockExams, mockReplays, mockSchedule } from './services/demo'

type Handlers = { [K in ZjuChannel]: (win: BrowserWindow | null) => ReturnType<ZjuApi[K]> }

async function getAuthState(): Promise<AuthState> {
  if (!(await hasCasCookie())) {
    return { loggedIn: false, user: null }
  }

  try {
    const { data: user } = await fetchProfile()
    return { loggedIn: true, user }
  } catch {
    // 教务接口尚待实测，个人信息失败不否定 CAS cookie 状态。
    return { loggedIn: true, user: null }
  }
}

const handlers: Handlers = {
  'auth:state': () => getAuthState(),
  'auth:login': async (win) => {
    await login(win ?? undefined)
    return getAuthState()
  },
  'auth:logout': async () => {
    await logout()
    resetZdbk()
    resetCourses()
    resetClassroom()
    return { loggedIn: false, user: null }
  },

  'data:schedule': () => fetchSchedule(),
  'data:exams': () => fetchExams(),
  'data:assignments': () => fetchAssignments(),
  'data:replays': () => fetchReplays()
}

if (process.env['ZJU_DEMO'] === '1') {
  Object.assign(handlers, {
    'data:schedule': async () => mock(mockSchedule),
    'data:exams': async () => mock(mockExams),
    'data:assignments': async () => mock(mockAssignments),
    'data:replays': async () => mock(mockReplays)
  } satisfies Partial<Handlers>)
}

export function registerIpc(): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (e) => handler(BrowserWindow.fromWebContents(e.sender)))
  }
}
