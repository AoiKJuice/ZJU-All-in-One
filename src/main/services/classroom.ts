import type { DataResult, LectureReplay } from '@shared/types'
import { mock, mockReplays } from './mock'

/**
 * 智云课堂 (classroom.zju.edu.cn) — 课程回放 / 直播.
 * TODO: SSO through CAS, list replays per course. The live-PPT and audio-transcription tools will
 * also build on this module (slide image stream + audio track of a live/replay session).
 */

export async function fetchReplays(): Promise<DataResult<LectureReplay[]>> {
  return mock(mockReplays)
}
