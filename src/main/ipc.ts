import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PROGRESS_EVENT, ZJU_CHANNELS, type ZjuApi, type ZjuChannel } from '@shared/ipc'
import type { AuthState, TaskProgress } from '@shared/types'
import { hasCasCookie, login, logout } from './auth/zjuam'
import { clearCredentials, loadCredentials, passwordLogin, relogin, saveCredentials } from './auth/password'
import { getMcpState, setMcp } from './mcp'
import { onCasExpired } from './http'
import {
  fetchSchedule,
  fetchExams,
  fetchProfile,
  reset as resetZdbk
} from './services/zdbk'
import {
  fetchAssignments,
  getAssignmentDetail,
  submitHomework,
  reset as resetCourses
} from './services/courses'
import {
  fetchReplays,
  fetchLectures,
  listSlides,
  getPlaybackUrl,
  getPlaybackSource,
  reset as resetClassroom
} from './services/classroom'
import { fetchCalendar } from './services/calendar'
import { getSystemStats } from './stats'
import { transcribe, readTranscript } from './asr/whisper'
import { logDiagnostic } from './diagnostics'
import { exportSlidesPdf, writeTranscript } from './export'
import { downloadToFile } from './download'
import { mock, mockAssignments, mockExams, mockReplays, mockSchedule, mockSlides, mockTranscript } from './services/demo'

type Handlers = {
  [K in ZjuChannel]: (
    win: BrowserWindow | null,
    ...args: Parameters<ZjuApi[K]>
  ) => ReturnType<ZjuApi[K]>
}

function resetServices(): void {
  resetZdbk()
  resetCourses()
  resetClassroom()
}

// 任何请求被 SSO 弹回登录页时，用保存的账号密码重登；各 service 的一次性登录态随之作废
onCasExpired(async () => {
  const ok = await relogin()
  if (ok) resetServices()
  return ok
})

async function getAuthState(): Promise<AuthState> {
  if (!(await hasCasCookie()) && !(await relogin())) {
    return { loggedIn: false, user: null, account: null }
  }

  const account = (await loadCredentials())?.username ?? null
  try {
    const { data: user } = await fetchProfile()
    return { loggedIn: true, user, account: user.studentId || account }
  } catch (error) {
    // 服务器端 CAS 会话已过期且无法用保存的密码重登：按未登录处理并清掉残留 cookie
    if (error instanceof Error && error.message === '未登录') {
      await logout()
      resetServices()
      return { loggedIn: false, user: null, account: null }
    }
    // 教务个人信息字段尚待实测，其他失败不否定 CAS 登录态
    return { loggedIn: true, user: null, account }
  }
}

async function chooseSavePath(
  win: BrowserWindow | null,
  title: string,
  extension: string
): Promise<string | null> {
  const options: SaveDialogOptions = {
    defaultPath: `${title}.${extension}`,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
  }
  const result = await (win
    ? dialog.showSaveDialog(win, options)
    : dialog.showSaveDialog(options))

  return result.canceled ? null : result.filePath
}

const handlers: Handlers = {
  'auth:state': () => getAuthState(),
  'auth:login': async (win, account) => {
    if (account) {
      await passwordLogin(account.username, account.password)
      await saveCredentials(account.username, account.password)
    } else {
      await login(win ?? undefined)
    }
    resetServices()
    return getAuthState()
  },
  'auth:logout': async () => {
    await logout()
    await clearCredentials()
    resetServices()
    return { loggedIn: false, user: null, account: null }
  },

  'data:schedule': () => fetchSchedule(),
  'data:exams': () => fetchExams(),
  'data:assignments': () => fetchAssignments(),
  'data:replays': () => fetchReplays(),
  'data:calendar': () => fetchCalendar(),
  'data:lectures': (_win, from, to) => fetchLectures(from, to),
  'system:stats': async () => getSystemStats(),

  'file:download': async (win, url, name) => {
    const options: SaveDialogOptions = { defaultPath: join(app.getPath('downloads'), name) }
    const result = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options))
    if (result.canceled || !result.filePath) return null
    await downloadToFile(url, result.filePath)
    return result.filePath
  },
  'file:reveal': async (_win, path) => shell.showItemInFolder(path),

  'homework:detail': (_win, activityId) => getAssignmentDetail(activityId),
  'homework:pick': async (win) => {
    const options: OpenDialogOptions = {
      properties: ['openFile', 'multiSelections']
    }
    const result = await (win
      ? dialog.showOpenDialog(win, options)
      : dialog.showOpenDialog(options))

    if (result.canceled) return []

    return Promise.all(result.filePaths.map(async (path) => ({
      path,
      name: basename(path),
      size: (await stat(path)).size
    })))
  },
  'homework:submit': (_win, activityId, comment, files) =>
    submitHomework(activityId, comment, files),

  'replay:playback': (_win, courseId, subId) => getPlaybackSource(courseId, subId),
  'replay:slides': (_win, courseId, subId) => listSlides(courseId, subId),
  'replay:exportSlides': async (win, courseId, subId, title) => {
    const filePath = await chooseSavePath(win, title, 'pdf')
    if (filePath === null) return null

    const slides = await listSlides(courseId, subId)
    await exportSlidesPdf(slides, title, filePath)
    return filePath
  },
  'replay:transcript': (_win, subId) => readTranscript(subId),
  'replay:transcribe': async (win, courseId, subId) => {
    const started = Date.now()
    let stage: TaskProgress['stage'] | undefined
    logDiagnostic('transcription-started')
    const report = (p: Omit<TaskProgress, 'key'>): void => {
      if (p.stage !== stage) {
        stage = p.stage
        logDiagnostic('transcription-stage', { stage, elapsedMs: Date.now() - started })
      }
      if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
      win.webContents.send(PROGRESS_EVENT, { key: 'transcribe:' + subId, ...p })
    }

    try {
      const url = await getPlaybackUrl(courseId, subId)
      const segments = await transcribe(url, subId, report)
      logDiagnostic('transcription-complete', { segments: segments.length, elapsedMs: Date.now() - started })
      report({ stage: 'done', ratio: 1 })
      return segments
    } catch (error) {
      report({
        stage: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  },
  'replay:exportTranscript': async (win, subId, format, title) => {
    const segments = await readTranscript(subId)
    if (segments === null) throw new Error('尚未转写')

    const filePath = await chooseSavePath(win, title, format)
    if (filePath === null) return null

    await writeTranscript(segments, format, title, filePath)
    return filePath
  },

  'mcp:state': async () => getMcpState(),
  'mcp:set': (_win, patch) => setMcp(patch)
}

if (process.env['ZJU_DEMO'] === '1') {
  Object.assign(handlers, {
    'data:schedule': async () => mock(mockSchedule),
    'data:exams': async () => mock(mockExams),
    'data:assignments': async () => mock(mockAssignments),
    'data:replays': async () => mock(mockReplays),
    'data:calendar': () => fetchCalendar(),
    'data:lectures': async () => mockReplays,
    'replay:slides': async () => mockSlides,
    'replay:transcript': async () => mockTranscript,
    'homework:detail': async (_win, activityId) => {
      const a = mockAssignments.find((x) => x.id === activityId) ?? mockAssignments[0]
      return { ...a, descriptionHtml: '<p>演示作业</p>', attachments: [], submissions: [], url: '' }
    },
    // 演示模式不真正提交
    'homework:submit': async () => {},
    // ZJU_DEMO_VIDEO 指向本地视频文件时用它调播放器，否则无视频
    'replay:playback': async () => {
      const file = process.env['ZJU_DEMO_VIDEO']
      if (!file) throw new Error('演示模式无视频')
      return { url: pathToFileURL(file).href, kind: 'mp4' as const }
    }
  } satisfies Partial<Handlers>)
}

function registerChannel<K extends ZjuChannel>(channel: K): void {
  const handler = handlers[channel] as (
    win: BrowserWindow | null,
    ...args: Parameters<ZjuApi[K]>
  ) => ReturnType<ZjuApi[K]>

  ipcMain.handle(channel, (e, ...args: Parameters<ZjuApi[K]>) =>
    handler(BrowserWindow.fromWebContents(e.sender), ...args)
  )
}

/** 主进程内直接调用某个通道（MCP 工具复用渲染端同一套实现，演示模式也随之生效） */
export function call<K extends ZjuChannel>(channel: K, ...args: Parameters<ZjuApi[K]>): ReturnType<ZjuApi[K]> {
  const handler = handlers[channel] as (win: BrowserWindow | null, ...args: Parameters<ZjuApi[K]>) => ReturnType<ZjuApi[K]>
  return handler(BrowserWindow.getAllWindows()[0] ?? null, ...args)
}

export function registerIpc(): void {
  for (const channel of ZJU_CHANNELS) {
    registerChannel(channel)
  }
}
