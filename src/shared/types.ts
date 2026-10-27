// Domain models shared by the main process (producers) and the renderer (consumers).

export interface UserProfile {
  studentId: string
  name: string
}

export interface AuthState {
  loggedIn: boolean
  user: UserProfile | null
  /** 学号：教务个人信息取不到时用保存的登录账号 */
  account: string | null
}

/** 本地 MCP 服务的工具分组，设置页逐组开关：查询 / 下载与导出 / 操作界面（刷新、打开页面）/ 转写 / 提交作业 */
export type McpToolGroup = 'query' | 'download' | 'app' | 'transcribe' | 'submit'

/** 主进程要界面打开的内容（MCP 的 open_in_app） */
export type OpenRequest =
  | { page: 'home' | 'schedule' | 'settings' }
  | { login: true }
  | { assignment: Assignment }
  | { replay: LectureReplay }

export interface McpState {
  enabled: boolean
  /** 已在监听时的地址 */
  url: string | null
  token: string
  tools: Record<McpToolGroup, boolean>
  /** 启动失败原因（如端口被占用） */
  error: string | null
}

/** Every data fetch is wrapped so the UI can tell live data from placeholders. */
export interface DataResult<T> {
  data: T
  source: 'live' | 'mock'
  fetchedAt: number
}

export interface CourseSession {
  id: string
  name: string
  teacher: string
  location: string
  /** 1 = Monday … 7 = Sunday */
  weekday: number
  /** ZJU class periods, 1-based, inclusive */
  startPeriod: number
  endPeriod: number
  /** e.g. "秋冬" / "春夏" / "秋" … */
  semesterPart: string
  /** 在所属半学期内的教学周范围（1 起，含两端），如 第1-8周 → [1, 8] */
  weekRange: [number, number]
  weekParity: 'all' | 'odd' | 'even'
}

/** 校历：一学年学期的两个半学期起止、节假日与调课（来源 Celechron 公开校历） */
export interface TermCalendar {
  /** 学年学期，如 2026-2027-1 */
  id: string
  halves: {
    /** 秋 / 冬 / 春 / 夏 */
    name: string
    /** YYYY-MM-DD，含两端 */
    start: string
    end: string
  }[]
  /** YYYY-MM-DD → 名称；当天停课 */
  holidays: Record<string, string>
  /** 调课：date 这天按 follows 那天的课表上课 */
  exchanges: { date: string; follows: string; name: string }[]
}

export interface Exam {
  id: string
  courseName: string
  /** ISO 8601 */
  startTime: string
  endTime: string
  location: string
  seat?: string
}

export interface Assignment {
  id: string
  courseId: string
  /** TronClass 活动类型：homework 可在应用内提交，其余跳转网页 */
  type: string
  courseName: string
  title: string
  /** ISO 8601 */
  deadline: string
  submitted: boolean
  url?: string
  /** PTA 题目集的完成情况：已通过题数 / 总题数（没进入过的题目集取不到） */
  progress?: { done: number; total: number }
}

/** PTA（pintia.cn）接入状态：设置里的开关与登录 */
export interface PtaState {
  enabled: boolean
  loggedIn: boolean
  /** 昵称，取不到时用邮箱或手机号 */
  user: string | null
}

/** 智云课次（回放 / 直播 / 未开始统一用它） */
export interface LectureReplay {
  /** = 智云 sub_id */
  id: string
  courseId: string
  courseName: string
  title: string
  teacher: string
  /** ISO 8601，计划开始 */
  recordedAt: string
  durationMinutes: number
  url?: string
  /** 智云 sub_status：1 直播中，2 未开始，3 回放生成中，5 无回放，6 回放 */
  status: 'live' | 'upcoming' | 'generating' | 'none' | 'replay'
  /** 上课日期 YYYY-MM-DD（北京时间） */
  date: string
  /** 由 sub_title 中"第3-5节"解析，解析不到则缺省 */
  startPeriod?: number
  endPeriod?: number
}

export interface PlaybackSource {
  url: string
  /** mp4 = 回放直链；hls = 直播 m3u8 */
  kind: 'mp4' | 'hls'
}

/** 悬停转写进度时显示的高级信息 */
export interface SystemStats {
  /** 全机 CPU 占用 0–1 */
  cpu: number
  memory: { used: number; total: number }
  /** 本应用（含 Whisper / ffmpeg 子进程）占用内存，字节 */
  appMemory: number
  /** NVIDIA 显卡；无或查询失败时缺省 */
  gpu?: { name: string; util: number; memUsed: number; memTotal: number }
}

export interface Attachment {
  name: string
  url: string
}

export interface AssignmentDetail {
  id: string
  title: string
  courseName: string
  /** ISO 8601 */
  deadline: string
  /** 作业说明（HTML，来自学在浙大） */
  descriptionHtml: string
  attachments: Attachment[]
  /** 已有提交（不含草稿），最新在前 */
  submissions: {
    id: string
    /** ISO 8601 */
    submittedAt: string
    comment: string
    files: Attachment[]
    /** 评分前且作业允许时可撤回；撤回后变成草稿 */
    canRetract: boolean
  }[]
  /** 草稿（如撤回的提交）；再次提交会覆盖它 */
  draft: { id: string; comment: string; files: Attachment[] } | null
  url: string
}

/** 应用内预览本机文件：图片 / PDF / 文本直接显示，其余交给系统默认程序 */
export interface FilePreview {
  name: string
  kind: 'image' | 'pdf' | 'text' | 'other'
  mime: string
  /** other 或文件过大时不带内容 */
  data?: Uint8Array
}

/** 本地 Agent 经 MCP 发起、需用户在应用内确认的操作 */
export interface ConfirmRequest {
  id: string
  action: 'submit' | 'retract'
  courseName: string
  title: string
  /** 提交：要上传的本机文件；撤回：被撤回那次提交的文件 */
  files: (PickedFile | Attachment)[]
  comment: string
}

/** 主进程弹出的文件选择结果 */
export interface PickedFile {
  path: string
  name: string
  size: number
}

export interface Slide {
  imageUrl: string
  /** 相对开课的秒数，平台未提供时缺省 */
  time?: number
}

export interface TranscriptSegment {
  /** 秒 */
  start: number
  end: number
  text: string
}

export type TranscriptFormat = 'txt' | 'srt' | 'md'

/** 主进程经 'task:progress' 推送的长任务进度 */
export interface TaskProgress {
  /** 任务键，如 transcribe:<subId> */
  key: string
  stage: 'engine' | 'model' | 'audio' | 'transcribe' | 'done' | 'error'
  /** 0–1；无法估计时缺省 */
  ratio?: number
  message?: string
  /** 下载类阶段：已下载 / 总字节 */
  bytes?: { done: number; total: number }
  /** 下载速度，字节/秒 */
  speed?: number
  /** 当前阶段预计剩余秒数 */
  eta?: number
  /** transcribe 阶段新识别出的段落（增量，渲染端累积） */
  partial?: TranscriptSegment[]
}
