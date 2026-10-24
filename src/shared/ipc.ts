import type {
  Assignment,
  AssignmentDetail,
  AuthState,
  McpState,
  McpToolGroup,
  CourseSession,
  DataResult,
  Exam,
  LectureReplay,
  PlaybackSource,
  SystemStats,
  TermCalendar,
  PickedFile,
  Slide,
  TaskProgress,
  TranscriptFormat,
  TranscriptSegment
} from './types'

/**
 * Single source of truth for renderer ⇄ main communication.
 * Each key is an `ipcMain.handle` channel; preload exposes them 1:1 as `window.zju[key]` (arguments pass through).
 * Adding a channel = add it here and to ZJU_CHANNELS, implement it in `src/main/ipc.ts`.
 */
export interface ZjuApi {
  'auth:state': () => Promise<AuthState>
  /** 带账号密码：程序内登录并加密保存，过期时自动重登；不带：弹出统一身份认证网页（验证码等兜底） */
  'auth:login': (account?: { username: string; password: string }) => Promise<AuthState>
  'auth:logout': () => Promise<AuthState>

  'data:schedule': () => Promise<DataResult<CourseSession[]>>
  'data:exams': () => Promise<DataResult<Exam[]>>
  'data:assignments': () => Promise<DataResult<Assignment[]>>
  /** 近期回放，正在直播的排在最前 */
  'data:replays': () => Promise<DataResult<LectureReplay[]>>
  /** 当前学年学期校历 */
  'data:calendar': () => Promise<TermCalendar>
  /** 区间内（YYYY-MM-DD，含两端）的全部智云课次，供课表点课跳视频 */
  'data:lectures': (from: string, to: string) => Promise<LectureReplay[]>
  /** 悬停转写进度时轮询 */
  'system:stats': () => Promise<SystemStats>

  /** 应用内下载：弹保存框（默认"下载"目录 + name），用登录会话写文件；取消返回 null，成功返回路径 */
  'file:download': (url: string, name: string) => Promise<string | null>
  /** 在资源管理器中显示文件 */
  'file:reveal': (path: string) => Promise<void>

  'homework:detail': (activityId: string) => Promise<AssignmentDetail>
  /** 打开系统文件选择框；取消时返回空数组 */
  'homework:pick': () => Promise<PickedFile[]>
  'homework:submit': (activityId: string, comment: string, files: PickedFile[]) => Promise<void>

  /** 已签名、可直接给 <video> 播放的回放地址 */
  /** 回放为 mp4 直链；直播中返回 hls */
  'replay:playback': (courseId: string, subId: string) => Promise<PlaybackSource>
  'replay:slides': (courseId: string, subId: string) => Promise<Slide[]>
  /** 弹出保存框并导出 PDF；取消时返回 null */
  'replay:exportSlides': (courseId: string, subId: string, title: string) => Promise<string | null>
  /** 已缓存的转写结果；没有则 null */
  'replay:transcript': (subId: string) => Promise<TranscriptSegment[] | null>
  /** 本地 Whisper 转写（首次会下载引擎与模型），进度经 task:progress 推送 */
  'replay:transcribe': (courseId: string, subId: string) => Promise<TranscriptSegment[]>
  'replay:exportTranscript': (subId: string, format: TranscriptFormat, title: string) => Promise<string | null>

  /** 本地 MCP 服务（供本机 Agent 调用）的状态与开关 */
  'mcp:state': () => Promise<McpState>
  'mcp:set': (patch: { enabled?: boolean; tools?: Partial<Record<McpToolGroup, boolean>> }) => Promise<McpState>
}

export type ZjuChannel = keyof ZjuApi

export const ZJU_CHANNELS = [
  'auth:state',
  'auth:login',
  'auth:logout',
  'data:schedule',
  'data:exams',
  'data:assignments',
  'data:replays',
  'data:calendar',
  'data:lectures',
  'system:stats',
  'file:download',
  'file:reveal',
  'homework:detail',
  'homework:pick',
  'homework:submit',
  'replay:playback',
  'replay:slides',
  'replay:exportSlides',
  'replay:transcript',
  'replay:transcribe',
  'replay:exportTranscript',
  'mcp:state',
  'mcp:set'
] as const satisfies readonly ZjuChannel[]

/** 主进程 → 渲染进程的推送事件 */
export const PROGRESS_EVENT = 'task:progress'
/** 主进程要求界面重新拉取数据（MCP 的 refresh 工具） */
export const REFRESH_EVENT = 'app:refresh'

export type ZjuBridge = ZjuApi & {
  /** 订阅长任务进度，返回取消订阅函数 */
  onProgress: (listener: (progress: TaskProgress) => void) => () => void
  onRefresh: (listener: () => void) => () => void
}
