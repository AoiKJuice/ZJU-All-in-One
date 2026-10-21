import type { Assignment, DataResult } from '@shared/types'
import { mock, mockAssignments } from './mock'

/**
 * 学在浙大 (courses.zju.edu.cn) — 作业 / 待办.
 * TODO: SSO through CAS, then read the todo / homework APIs and map into Assignment.
 */

export async function fetchAssignments(): Promise<DataResult<Assignment[]>> {
  return mock(mockAssignments)
}
