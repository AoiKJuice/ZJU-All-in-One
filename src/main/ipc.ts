import { BrowserWindow, ipcMain } from 'electron'
import type { ZjuApi, ZjuChannel } from '@shared/ipc'
import { getAuthState, login, logout } from './auth/zjuam'
import { fetchSchedule, fetchExams } from './services/zdbk'
import { fetchAssignments } from './services/courses'
import { fetchReplays } from './services/classroom'

type Handlers = { [K in ZjuChannel]: (win: BrowserWindow | null) => ReturnType<ZjuApi[K]> }

const handlers: Handlers = {
  'auth:state': () => getAuthState(),
  'auth:login': (win) => login(win ?? undefined),
  'auth:logout': () => logout(),

  'data:schedule': () => fetchSchedule(),
  'data:exams': () => fetchExams(),
  'data:assignments': () => fetchAssignments(),
  'data:replays': () => fetchReplays()
}

export function registerIpc(): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (e) => handler(BrowserWindow.fromWebContents(e.sender)))
  }
}
