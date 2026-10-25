import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AUTH_EVENT, PROGRESS_EVENT, ZJU_CHANNELS, type ZjuApi, type ZjuChannel } from '@shared/ipc'
import type { AuthState, FilePreview, TaskProgress } from '@shared/types'
import { hasCasCookie, login, logout } from './auth/zjuam'
import { clearCredentials, loadCredentials, passwordLogin, relogin, saveCredentials } from './auth/password'
import { answerConfirm, getMcpState, setMcp } from './mcp'
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
  retractSubmission,
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
import { isTranscriptStale, transcribe, readTranscript } from './asr/whisper'
import { logDiagnostic } from './diagnostics'
import { exportSlidesPdf, writeTranscript } from './export'
import { downloadToFile } from './download'
import { demoDetail, demoRetract, demoSubmit, mock, mockAssignments, mockExams, mockReplays, mockSchedule, mockSlides, mockTranscript } from './services/demo'

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

// 任何请求被 SSO 弹回登录页（或 cookie 已不在）时，用保存的账号密码重登；各 service 的一次性登录态随之作废。
// 重登成功或密码被拒时通知界面重取登录态（刊头随之更新）；网络失败不通知，避免界面重取又触发重登的循环
onCasExpired(async () => {
  const result = await relogin()
  if (result === 'ok') resetServices()
  if (result === 'ok' || result === 'rejected') {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(AUTH_EVENT)
  }
  return result === 'ok'
})

const SIGNED_OUT: AuthState = { loggedIn: false, user: null, account: null }

async function getAuthState(): Promise<AuthState> {
  if (!(await hasCasCookie()) && (await relogin()) !== 'ok') return SIGNED_OUT

  const account = (await loadCredentials())?.username ?? null
  try {
    const { data: user } = await fetchProfile()
    return { loggedIn: true, user, account: user.studentId || account }
  } catch (error) {
    // 被弹回登录页且自动重登也没成功（zjuFetch 已试过）。没有保存的账号时清掉失效的 cookie；
    // 有账号多半是网络问题，cookie 与凭据都保留，界面稍后重试
    if (error instanceof Error && error.message === '未登录') {
      logDiagnostic('auth-state', { loggedIn: false, credentials: account !== null })
      if (account === null) {
        await logout()
        resetServices()
      }
      return SIGNED_OUT
    }
    // 教务个人信息字段尚待实测，其他失败不否定 CAS 登录态
    return { loggedIn: true, user: null, account }
  }
}

// 应用内预览：按扩展名分类，超过 50MB 不读内容（交给默认程序）
const PREVIEW_KINDS: Record<string, [FilePreview['kind'], string]> = {
  '.png': ['image', 'image/png'], '.jpg': ['image', 'image/jpeg'], '.jpeg': ['image', 'image/jpeg'],
  '.gif': ['image', 'image/gif'], '.webp': ['image', 'image/webp'], '.bmp': ['image', 'image/bmp'], '.svg': ['image', 'image/svg+xml'],
  '.pdf': ['pdf', 'application/pdf']
}
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.log', '.tex', '.py', '.c', '.cpp', '.h', '.hpp', '.java', '.js', '.ts', '.html', '.css', '.xml', '.m', '.r', '.go', '.rs', '.sql', '.yaml', '.yml'])
const PREVIEW_LIMIT = 50 * 1024 * 1024

async function previewFile(path: string): Promise<FilePreview> {
  const ext = extname(path).toLowerCase()
  const [kind, mime] = PREVIEW_KINDS[ext] ?? (TEXT_EXTENSIONS.has(ext) ? ['text', 'text/plain'] : ['other', 'application/octet-stream'])
  const name = basename(path)
  if (kind === 'other' || (await stat(path)).size > PREVIEW_LIMIT) return { name, kind: 'other', mime }
  return { name, kind, mime, data: await readFile(path) }
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
    return SIGNED_OUT
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
  'file:preview': (_win, path) => previewFile(path),
  'file:open': async (_win, path) => {
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  },

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
  'homework:retract': (_win, submissionId) => retractSubmission(submissionId),

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
  'replay:transcriptStale': async (_win, courseId, subId) =>
    isTranscriptStale(subId, await getPlaybackUrl(courseId, subId)),
  'replay:transcribe': async (win, courseId, subId, force) => {
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
      const segments = await transcribe(url, subId, report, force)
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
  'mcp:set': (_win, patch) => setMcp(patch),
  'mcp:answer': async (_win, id, approve) => answerConfirm(id, approve)
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
    'replay:transcriptStale': async () => false,
    // 演示作业的提交 / 撤回只记在内存里，不连学在浙大
    'homework:detail': async (_win, activityId) => demoDetail(activityId),
    'homework:submit': async (_win, activityId, comment, files) => demoSubmit(activityId, comment, files),
    'homework:retract': async (_win, submissionId) => demoRetract(submissionId),
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
