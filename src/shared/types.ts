// Domain models shared by the main process (producers) and the renderer (consumers).

export interface UserProfile {
  studentId: string
  name: string
}

export interface AuthState {
  loggedIn: boolean
  user: UserProfile | null
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
}

export interface LectureReplay {
  /** = 智云 sub_id */
  id: string
  courseId: string
  courseName: string
  title: string
  teacher: string
  /** ISO 8601 */
  recordedAt: string
  durationMinutes: number
  url?: string
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
  /** 已有提交，最新在前 */
  submissions: {
    id: string
    /** ISO 8601 */
    submittedAt: string
    comment: string
    files: Attachment[]
  }[]
  url: string
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
}
