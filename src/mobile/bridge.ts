import type { ZjuApi, ZjuBridge, ZjuChannel } from '@shared/ipc'
import { resetWebvpn } from '../main/services/newsWebvpn'
import type { AuthState, FilePreview, McpState, OpenRequest } from '@shared/types'
import { hasCasCookie, logout } from './zjuam'
import { onCasExpired } from './http'
import { logDiagnostic } from './diagnostics'
import { native, nativeBytes } from './native'
import { PREVIEW_LIMIT, previewKind } from '@shared/preview'
import { picked } from './shims/fs'
import { getTodoState, onReminderTap, setIgnored, setRemind, updateAssignments } from './todos'
import { formsHandlers } from './forms'
import { clearCredentials, loadCredentials, passwordLogin, relogin, saveCredentials } from '../main/auth/password'
import * as eta from '../main/services/eta'
import { fetchSchedule as fetchZdbkSchedule, fetchExams, fetchProfile, reset as resetZdbk } from '../main/services/zdbk'
import { fetchAssignments, fetchCourseHomework, getAssignmentDetail, submitHomework, retractSubmission, reset as resetCourses } from '../main/services/courses'
import { fetchReplays, fetchLectures, listSlides, getPlaybackSource, getPlatformTranscript, reset as resetClassroom } from '../main/services/classroom'
import { fetchCalendar } from '../main/services/calendar'
import * as graduation from '../main/services/graduation'
import { resetXk, xkHandlers } from '../main/services/xkApi'
import { demoXk } from '../main/services/demoXk'
import { libraryHandlers, resetLibrary } from '../main/services/libraryApi'
import { demoLibrary } from '../main/services/demoLibrary'
import { newsHandlers } from '../main/services/newsApi'
import { demoNews } from '../main/services/demoNews'
import * as pta from '../main/services/pta'
import { demoCourseHomework, demoDetail, demoPta, demoRetract, demoSubmit, mock, mockAssignments, mockExams, mockGraduation, mockReplays, mockSchedule, mockSlides, mockPlatformTranscript } from '../main/services/demo'

// 安卓端的 window.zju：与桌面端 src/main/ipc.ts 同一套通道，services 原样复用（网络、cookie、凭据换成原生插件）。
// 桌面专属的本地转写、导出、MCP 在这里不提供，界面按 platform 隐藏入口

type Handlers = { [K in ZjuChannel]: (...args: Parameters<ZjuApi[K]>) => ReturnType<ZjuApi[K]> }

const unsupported = (): Promise<never> => Promise.reject(new Error('手机端不支持'))

function resetServices(): void {
  resetZdbk()
  resetCourses()
  resetClassroom()
  eta.reset()
  graduation.reset()
  resetXk()
  resetLibrary()
  resetWebvpn()
}

const authListeners = new Set<() => void>()
const openListeners = new Set<(request: OpenRequest) => void>()

onCasExpired(async () => {
  const result = await relogin()
  if (result === 'ok') resetServices()
  if (result === 'ok' || result === 'rejected') authListeners.forEach((listener) => listener())
  return result === 'ok'
})

onReminderTap((request) => openListeners.forEach((listener) => listener(request)))

const SIGNED_OUT: AuthState = { loggedIn: false, user: null, account: null }

async function getAuthState(): Promise<AuthState> {
  if (!(await hasCasCookie()) && (await relogin()) !== 'ok') return SIGNED_OUT
  const account = (await loadCredentials())?.username ?? null
  try {
    const { data: user } = await fetchProfile()
    return { loggedIn: true, user, account: user.studentId || account }
  } catch (error) {
    if (error instanceof Error && error.message === '未登录') {
      if (account === null) {
        await logout()
        resetServices()
      }
      return SIGNED_OUT
    }
    return { loggedIn: true, user: null, account }
  }
}

async function fetchSchedule(): ReturnType<ZjuApi['data:schedule']> {
  try {
    const result = await eta.fetchSchedule()
    if (result.data.length > 0) return result
  } catch (error) {
    if (error instanceof Error && error.message === '未登录') throw error
    logDiagnostic('schedule-source', { eta: 'failed', message: error instanceof Error ? error.message : String(error) })
  }
  return fetchZdbkSchedule()
}

/** 系统文件选择（WebView 的 <input type=file>）；选中的文件留在内存里，提交时读取 */
function pickFiles(): ReturnType<ZjuApi['homework:pick']> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = () =>
      resolve(
        [...(input.files ?? [])].map((file) => {
          const path = `picked:${crypto.randomUUID()}/${file.name}`
          picked.set(path, file)
          return { path, name: file.name, size: file.size }
        })
      )
    input.oncancel = () => resolve([])
    input.click()
  })
}

async function previewFile(path: string): Promise<FilePreview> {
  const file = picked.get(path)
  const name = file?.name ?? path.split('/').pop() ?? path
  // 系统选择器给的 type 常常是空串（Office 文件尤其如此），按文件名分类
  const [kind, mime] = previewKind(name)
  if (!file || kind === 'other' || file.size > PREVIEW_LIMIT) return { name, kind: 'other', mime }
  return { name, kind, mime, data: new Uint8Array(await file.arrayBuffer()) }
}

async function previewUrl(url: string, name: string): Promise<FilePreview> {
  const [kind, mime] = previewKind(name)
  if (kind === 'other') return { name, kind, mime }
  const headers: Record<string, string> = new URL(url).hostname.endsWith('cmc.zju.edu.cn') ? { Referer: 'https://classroom.zju.edu.cn/' } : {}
  const data = await nativeBytes(url, headers)
  return data.length > PREVIEW_LIMIT ? { name, kind: 'other', mime } : { name, kind, mime, data }
}

const MCP_OFF: McpState = { enabled: false, url: null, token: '', tools: { query: false, download: false, app: false, transcribe: false, submit: false }, error: null }

const handlers: Handlers = {
  'auth:state': () => getAuthState(),
  'auth:login': async (account) => {
    if (!account) throw new Error('请用账号密码登录')
    await passwordLogin(account.username, account.password)
    await saveCredentials(account.username, account.password)
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
  'data:assignments': async () => {
    const [courses, tasks] = await Promise.allSettled([fetchAssignments(), pta.fetchTasks()])
    const extra = tasks.status === 'fulfilled' ? tasks.value : []
    if (courses.status === 'rejected') {
      if (extra.length === 0) throw courses.reason
      return { data: extra, source: 'live' as const, fetchedAt: Date.now() }
    }
    const result = { ...courses.value, data: [...courses.value.data, ...extra] }
    void updateAssignments(result.data).catch(() => {})
    return result
  },
  'data:replays': () => fetchReplays(),
  'data:calendar': () => fetchCalendar(),
  'data:courseHomework': (courseName) => fetchCourseHomework(courseName),
  'data:lectures': (from, to) => fetchLectures(from, to),
  'data:graduation': () => graduation.fetchGraduation(),
  'system:stats': async () => ({ cpu: 0, memory: { used: 0, total: 0 }, appMemory: 0 }),

  // 下到系统"下载/ZJU All in One"；返回的 content:// 地址交给 file:reveal / file:open 用其他应用打开
  'file:download': async (url, name) => {
    const headers: Record<string, string> = new URL(url).hostname.endsWith('cmc.zju.edu.cn') ? { Referer: 'https://classroom.zju.edu.cn/' } : {}
    return (await native.download({ url: url.replace(/^http:\/\/([^/]*\.zju\.edu\.cn)/, 'https://$1'), name, headers })).uri
  },
  'file:reveal': (path) => native.open({ uri: path }),
  'file:preview': (path) => previewFile(path),
  'file:previewUrl': (url, name) => previewUrl(url, name),
  'file:open': (path) => native.open({ uri: path }),

  'homework:detail': (activityId) => getAssignmentDetail(activityId),
  'homework:pick': () => pickFiles(),
  'homework:submit': (activityId, comment, files) => submitHomework(activityId, comment, files),
  'homework:retract': (submissionId) => retractSubmission(submissionId),

  'replay:playback': (courseId, subId) => getPlaybackSource(courseId, subId),
  'replay:slides': (courseId, subId) => listSlides(courseId, subId),
  'replay:exportSlides': unsupported,
  'replay:transcript': async () => null,
  'replay:transcriptStale': async () => false,
  'replay:transcribe': unsupported,
  'replay:platformTranscript': (subId) => getPlatformTranscript(subId),
  'replay:exportTranscript': unsupported,

  'todo:state': async () => getTodoState(),
  'todo:ignore': (id, ignored) => setIgnored(id, ignored),
  'todo:remind': (on) => setRemind(on),

  'pta:state': () => pta.getState(),
  'pta:enable': async (enabled) => {
    await pta.setEnabled(enabled)
    return pta.getState()
  },
  'pta:login': async (account) => {
    if (!account) throw new Error('请用账号密码登录')
    await pta.login(undefined, account)
    return pta.getState()
  },
  'pta:logout': async () => {
    await pta.logout()
    return pta.getState()
  },

  'mcp:state': async () => MCP_OFF,
  'mcp:set': async () => MCP_OFF,
  'mcp:answer': async () => {},

  // 选课与查老师；订阅与自动选课只在桌面端
  ...xkHandlers,
  'xk:watches': async () => [],
  'xk:watch': unsupported,
  'xk:unwatch': unsupported
,
  ...libraryHandlers,
  'lib:watches': async () => [],
  'lib:watch': unsupported,
  'lib:unwatch': unsupported,
  'lib:presets': async () => [],
  'lib:savePreset': unsupported,
  'lib:removePreset': unsupported,
  // 校园资讯：公众号（微信读书要弹窗扫码）与钉钉（读本机库）只在桌面端
  ...newsHandlers,
  'news:weread': async () => ({ status: 'signedOut' as const, accounts: [] }),
  'news:wereadLogin': unsupported,
  'news:wereadLogout': unsupported,
  'news:wereadAdd': unsupported,
  'news:wereadRemove': unsupported,
  'news:wechat': unsupported,
  'news:dingtalk': unsupported,
  ...formsHandlers
}

// 演示模式（VITE_ZJU_DEMO=1 构建）：数据通道换成演示数据，便于在浏览器里调手机界面
if (import.meta.env.VITE_ZJU_DEMO === '1') {
  Object.assign(handlers, {
    'auth:state': async () => SIGNED_OUT,
    'data:schedule': async () => mock(mockSchedule),
    'data:exams': async () => mock(mockExams),
    'data:assignments': async () => mock(mockAssignments),
    'data:replays': async () => mock(mockReplays),
    'data:lectures': async () => mockReplays,
    'data:graduation': async () => mock(mockGraduation),
    'data:calendar': async () => demoCalendar(),
    'data:courseHomework': async (courseName: string) => demoCourseHomework(courseName),
    'replay:slides': async () => mockSlides,
    'replay:platformTranscript': async () => mockPlatformTranscript,
    'replay:playback': async () => {
      throw new Error('演示模式无视频')
    },
    'pta:state': async () => demoPta,
    'pta:enable': async (enabled: boolean) => Object.assign(demoPta, { enabled }),
    'pta:login': async () => Object.assign(demoPta, { loggedIn: true, user: '演示用户' }),
    'pta:logout': async () => Object.assign(demoPta, { loggedIn: false, user: null }),
    'homework:detail': async (activityId: string) => demoDetail(activityId),
    'homework:submit': async (activityId: string, comment: string, files: Parameters<typeof demoSubmit>[2]) => demoSubmit(activityId, comment, files),
    'homework:retract': async (submissionId: string) => demoRetract(submissionId),
    'todo:state': async () => demoTodos,
    'todo:ignore': async (id: string, ignored: boolean) =>
      Object.assign(demoTodos, { ignored: ignored ? [...demoTodos.ignored, id] : demoTodos.ignored.filter((x) => x !== id) }),
    'todo:remind': async (on: boolean) => Object.assign(demoTodos, { remind: on }),
    ...demoXk,
    ...demoLibrary,
    ...demoNews,
    'news:weread': async () => ({ status: 'signedOut' as const, accounts: [] }),
    'news:wechat': unsupported,
    'news:dingtalk': unsupported
  } satisfies Partial<Handlers>)
}

const demoTodos = { ignored: [] as string[], remind: false }

// 浏览器里没有原生插件、取不到校历：以本周为秋学期第 8 周编一份
function demoCalendar(): Awaited<ReturnType<ZjuApi['data:calendar']>> {
  const day = (offset: number): string => {
    const d = new Date()
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return {
    id: 'demo',
    halves: [
      { name: '秋', start: day(-49), end: day(6) },
      { name: '冬', start: day(7), end: day(62) }
    ],
    holidays: {},
    exchanges: []
  }
}

export const bridge = {
  ...(handlers as unknown as ZjuApi),
  platform: 'android',
  immersive: (on: boolean) => void native.immersive({ on }).catch(() => {}),
  onProgress: () => () => {},
  onRefresh: () => () => {},
  onConfirm: () => () => {},
  onOpen: (listener) => {
    openListeners.add(listener)
    return () => openListeners.delete(listener)
  },
  onAuth: (listener) => {
    authListeners.add(listener)
    return () => authListeners.delete(listener)
  }
} satisfies ZjuBridge
