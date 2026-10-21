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
  courseName: string
  title: string
  /** ISO 8601 */
  deadline: string
  submitted: boolean
  url?: string
}

export interface LectureReplay {
  id: string
  courseName: string
  title: string
  teacher: string
  /** ISO 8601 */
  recordedAt: string
  durationMinutes: number
  url?: string
}
