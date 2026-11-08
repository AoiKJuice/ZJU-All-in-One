import type {
  Assignment,
  AssignmentDetail,
  AuthState,
  ConfirmRequest,
  FilePreview,
  McpState,
  OpenRequest,
  PtaState,
  TodoState,
  TranscriptSource,
  McpToolGroup,
  CourseSession,
  DataResult,
  Exam,
  GraduationAudit,
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
import type { HomeworkUsage, LibraryUsage } from './usage'
import { XK_CHANNELS, type XkApi } from './xk'
import { FORMS_CHANNELS, type FormsApi } from './forms'
import { LIBRARY_CHANNELS, type LibraryApi } from './library'
import { NEWS_CHANNELS, type NewsApi } from './news'

/**
 * Single source of truth for renderer ⇄ main communication.
 * Each key is an `ipcMain.handle` channel; preload exposes them 1:1 as `window.zju[key]` (arguments pass through).
 * Adding a channel = add it here and to ZJU_CHANNELS, implement it in `src/main/ipc.ts`.
 */
export interface ZjuApi extends XkApi, FormsApi, LibraryApi, NewsApi {
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
  /** 某门课（按课表上的课名匹配学在浙大课程）的全部作业，含已交与已截止 */
  'data:courseHomework': (courseName: string) => Promise<Assignment[]>
  /** 区间内（YYYY-MM-DD，含两端）的全部智云课次，供课表点课跳视频 */
  'data:lectures': (from: string, to: string) => Promise<LectureReplay[]>
  /** 毕业自审：教务毕业资格自审树（必修课完成情况等）+ 第二课堂系统的二三四课堂、美育、劳育 */
  'data:graduation': () => Promise<DataResult<GraduationAudit>>
  /** 数据统计：近一年每天的图书馆预约时长 */
  'data:libraryUsage': () => Promise<DataResult<LibraryUsage>>
  /** 数据统计：近一年每天提交的作业数与提交时点分布 */
  'data:homeworkUsage': () => Promise<DataResult<HomeworkUsage>>
  /** 悬停转写进度时轮询 */
  'system:stats': () => Promise<SystemStats>

  /** 应用内下载：弹保存框（默认"下载"目录 + name），用登录会话写文件；取消返回 null，成功返回路径 */
  'file:download': (url: string, name: string) => Promise<string | null>
  /** 在资源管理器中显示文件 */
  'file:reveal': (path: string) => Promise<void>
  /** 读取本机文件供应用内预览（图片 / PDF / 文本 / Office） */
  'file:preview': (path: string) => Promise<FilePreview>
  /** 用登录会话取回校内文件（作业附件、已交文件）供应用内预览，不落盘 */
  'file:previewUrl': (url: string, name: string) => Promise<FilePreview>
  /** 用系统默认程序打开本机文件 */
  'file:open': (path: string) => Promise<void>

  'homework:detail': (activityId: string) => Promise<AssignmentDetail>
  /** 打开系统文件选择框；取消时返回空数组 */
  'homework:pick': () => Promise<PickedFile[]>
  'homework:submit': (activityId: string, comment: string, files: PickedFile[]) => Promise<void>
  /** 撤回一次提交（评分前、作业允许时），撤回后变为草稿 */
  'homework:retract': (submissionId: string) => Promise<void>

  /** 已签名、可直接给 <video> 播放的回放地址 */
  /** 回放为 mp4 直链；直播中返回 hls */
  'replay:playback': (courseId: string, subId: string) => Promise<PlaybackSource>
  'replay:slides': (courseId: string, subId: string) => Promise<Slide[]>
  /** 弹出保存框并导出 PDF；取消时返回 null */
  'replay:exportSlides': (courseId: string, subId: string, title: string) => Promise<string | null>
  /** 已缓存的转写结果；没有则 null */
  'replay:transcript': (subId: string) => Promise<TranscriptSegment[] | null>
  /** 本地 Whisper 转写（首次会下载引擎与模型），进度经 task:progress 推送 */
  'replay:transcribe': (courseId: string, subId: string, force?: boolean) => Promise<TranscriptSegment[]>
  /** 缓存的文字稿是否已不对应当前回放视频（智云课后会重新生成回放） */
  'replay:transcriptStale': (courseId: string, subId: string) => Promise<boolean>
  /** 智云平台自带的转写（直播中也会随讲课更新）；还没有时为空数组 */
  'replay:platformTranscript': (subId: string) => Promise<TranscriptSegment[]>
  'replay:exportTranscript': (subId: string, format: TranscriptFormat, title: string, source?: TranscriptSource) => Promise<string | null>

  /** 待办：忽略（隐藏且不提醒）与截止前 3 小时的系统通知 */
  'todo:state': () => Promise<TodoState>
  'todo:ignore': (id: string, ignored: boolean) => Promise<TodoState>
  'todo:remind': (on: boolean) => Promise<TodoState>

  /** PTA：开关、登录（带账号密码为程序内登录并加密保存，不带为网页登录）、退出；题目集并入 data:assignments */
  'pta:state': () => Promise<PtaState>
  'pta:enable': (enabled: boolean) => Promise<PtaState>
  'pta:login': (account?: { username: string; password: string }) => Promise<PtaState>
  'pta:logout': () => Promise<PtaState>

  /** 本地 MCP 服务（供本机 Agent 调用）的状态与开关 */
  'mcp:state': () => Promise<McpState>
  'mcp:set': (patch: { enabled?: boolean; tools?: Partial<Record<McpToolGroup, boolean>> }) => Promise<McpState>
  /** 用户对 Agent 发起的提交 / 撤回给出答复 */
  'mcp:answer': (id: string, approve: boolean) => Promise<void>
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
  'data:courseHomework',
  'data:lectures',
  'data:graduation',
  'data:libraryUsage',
  'data:homeworkUsage',
  'system:stats',
  'file:download',
  'file:reveal',
  'file:preview',
  'file:previewUrl',
  'file:open',
  'homework:detail',
  'homework:pick',
  'homework:submit',
  'homework:retract',
  'replay:playback',
  'replay:slides',
  'replay:exportSlides',
  'replay:transcript',
  'replay:transcribe',
  'replay:transcriptStale',
  'replay:platformTranscript',
  'replay:exportTranscript',
  'todo:state',
  'todo:ignore',
  'todo:remind',
  'pta:state',
  'pta:enable',
  'pta:login',
  'pta:logout',
  'mcp:state',
  'mcp:set',
  'mcp:answer',
  ...XK_CHANNELS
,
  ...FORMS_CHANNELS,
  ...LIBRARY_CHANNELS,
  ...NEWS_CHANNELS
] as const satisfies readonly ZjuChannel[]

/** 主进程 → 渲染进程的推送事件 */
export const PROGRESS_EVENT = 'task:progress'
/** 主进程要求界面重新拉取数据（MCP 的 refresh 工具） */
export const REFRESH_EVENT = 'app:refresh'
/** 主进程要求界面打开某页 / 某节课 / 某项作业 / 登录面板（MCP 的 open_in_app） */
export const OPEN_EVENT = 'app:open'
/** 主进程请界面确认 Agent 发起的提交 / 撤回 */
export const CONFIRM_EVENT = 'app:confirm'
/** 后台自动重登成功（或密码被拒）后请界面重取登录态 */
export const AUTH_EVENT = 'app:auth'

export type ZjuBridge = ZjuApi & {
  /** 安卓端（src/mobile/bridge.ts）才有；桌面端缺省 */
  platform?: 'android'
  /** 安卓端播放器全屏：横屏并隐藏系统栏 */
  immersive?: (on: boolean) => void
  /** 订阅长任务进度，返回取消订阅函数 */
  onProgress: (listener: (progress: TaskProgress) => void) => () => void
  onRefresh: (listener: () => void) => () => void
  onOpen: (listener: (request: OpenRequest) => void) => () => void
  onConfirm: (listener: (request: ConfirmRequest) => void) => () => void
  onAuth: (listener: () => void) => () => void
}
