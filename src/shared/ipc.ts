import type {
  Assignment,
  AuthState,
  CourseSession,
  DataResult,
  Exam,
  LectureReplay
} from './types'

/**
 * Single source of truth for renderer ⇄ main communication.
 * Each key is an `ipcMain.handle` channel; preload exposes them 1:1 as `window.zju[key]`.
 * Adding a channel = add it here, implement it in `src/main/ipc.ts`. Preload picks it up automatically.
 */
export interface ZjuApi {
  'auth:state': () => Promise<AuthState>
  'auth:login': () => Promise<AuthState>
  'auth:logout': () => Promise<AuthState>

  'data:schedule': () => Promise<DataResult<CourseSession[]>>
  'data:exams': () => Promise<DataResult<Exam[]>>
  'data:assignments': () => Promise<DataResult<Assignment[]>>
  'data:replays': () => Promise<DataResult<LectureReplay[]>>
}

export type ZjuChannel = keyof ZjuApi

export const ZJU_CHANNELS = [
  'auth:state',
  'auth:login',
  'auth:logout',
  'data:schedule',
  'data:exams',
  'data:assignments',
  'data:replays'
] as const satisfies readonly ZjuChannel[]
