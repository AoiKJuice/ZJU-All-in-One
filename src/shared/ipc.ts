import type {
  Assignment,
  AssignmentDetail,
  AuthState,
  CourseSession,
  DataResult,
  Exam,
  LectureReplay,
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
  'auth:login': () => Promise<AuthState>
  'auth:logout': () => Promise<AuthState>

  'data:schedule': () => Promise<DataResult<CourseSession[]>>
  'data:exams': () => Promise<DataResult<Exam[]>>
  'data:assignments': () => Promise<DataResult<Assignment[]>>
  'data:replays': () => Promise<DataResult<LectureReplay[]>>

  'homework:detail': (activityId: string) => Promise<AssignmentDetail>
  /** 打开系统文件选择框；取消时返回空数组 */
  'homework:pick': () => Promise<PickedFile[]>
  'homework:submit': (activityId: string, comment: string, files: PickedFile[]) => Promise<void>

  /** 已签名、可直接给 <video> 播放的回放地址 */
  'replay:playback': (courseId: string, subId: string) => Promise<string>
  'replay:slides': (courseId: string, subId: string) => Promise<Slide[]>
  /** 弹出保存框并导出 PDF；取消时返回 null */
  'replay:exportSlides': (courseId: string, subId: string, title: string) => Promise<string | null>
  /** 已缓存的转写结果；没有则 null */
  'replay:transcript': (subId: string) => Promise<TranscriptSegment[] | null>
  /** 本地 Whisper 转写（首次会下载引擎与模型），进度经 task:progress 推送 */
  'replay:transcribe': (courseId: string, subId: string) => Promise<TranscriptSegment[]>
  'replay:exportTranscript': (subId: string, format: TranscriptFormat, title: string) => Promise<string | null>
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
  'homework:detail',
  'homework:pick',
  'homework:submit',
  'replay:playback',
  'replay:slides',
  'replay:exportSlides',
  'replay:transcript',
  'replay:transcribe',
  'replay:exportTranscript'
] as const satisfies readonly ZjuChannel[]

/** 主进程 → 渲染进程的推送事件 */
export const PROGRESS_EVENT = 'task:progress'

export type ZjuBridge = ZjuApi & {
  /** 订阅长任务进度，返回取消订阅函数 */
  onProgress: (listener: (progress: TaskProgress) => void) => () => void
}
