import type { CourseSession, DataResult, Exam } from '@shared/types'
import { mock, mockExams, mockSchedule } from './mock'

/**
 * 本科教务系统 (zdbk.zju.edu.cn) — 课表 & 考试.
 * TODO: SSO via `zjuSession().fetch(casLoginUrl(<zdbk sso entry>))`, then POST the timetable / exam
 * query endpoints and map the JSON into CourseSession / Exam. Endpoints are not verified yet.
 */

export async function fetchSchedule(): Promise<DataResult<CourseSession[]>> {
  return mock(mockSchedule)
}

export async function fetchExams(): Promise<DataResult<Exam[]>> {
  return mock(mockExams)
}
