import type { Assignment, CourseSession, DataResult, Exam, LectureReplay, Slide, TranscriptSegment } from '@shared/types'

// 演示数据：ZJU_DEMO=1 时替代全部数据通道，便于不登录调前端

export function mock<T>(data: T): DataResult<T> {
  return { data, source: 'mock', fetchedAt: Date.now() }
}

const day = (offset: number, hour: number, minute = 0): string => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

export const mockSchedule: CourseSession[] = [
  { id: 'c1', name: '数学分析（甲）Ⅰ', teacher: '张老师', location: '东1A-201', weekday: 1, startPeriod: 1, endPeriod: 2, semesterPart: '秋冬', weekRange: [1, 8], weekParity: 'all' },
  { id: 'c2', name: '线性代数（甲）', teacher: '李老师', location: '东2-302', weekday: 2, startPeriod: 3, endPeriod: 5, semesterPart: '秋冬', weekRange: [1, 8], weekParity: 'all' },
  { id: 'c3', name: '程序设计基础', teacher: '王老师', location: '曹西-501', weekday: 3, startPeriod: 6, endPeriod: 8, semesterPart: '秋', weekRange: [1, 8], weekParity: 'all' },
  { id: 'c4', name: '大学物理（甲）Ⅰ', teacher: '赵老师', location: '东3-104', weekday: 4, startPeriod: 1, endPeriod: 2, semesterPart: '秋冬', weekRange: [1, 8], weekParity: 'all' },
  { id: 'c5', name: '思想道德与法治', teacher: '陈老师', location: '西1-210', weekday: 5, startPeriod: 11, endPeriod: 13, semesterPart: '秋冬', weekRange: [1, 8], weekParity: 'all' }
]

export const mockExams: Exam[] = [
  { id: 'e1', courseName: '程序设计基础', startTime: day(9, 14), endTime: day(9, 16), location: '东1A-101', seat: '23' },
  { id: 'e2', courseName: '线性代数（甲）', startTime: day(21, 10, 30), endTime: day(21, 12, 30), location: '东2-202' }
]

export const mockAssignments: Assignment[] = [
  { id: 'a1', courseId: 'demo', type: 'homework', courseName: '程序设计基础', title: '实验 3：链表', deadline: day(1, 23, 59), submitted: false },
  { id: 'a2', courseId: 'demo', type: 'homework', courseName: '大学物理（甲）Ⅰ', title: '第五章习题', deadline: day(3, 22), submitted: false },
  { id: 'a3', courseId: 'demo', type: 'homework', courseName: '数学分析（甲）Ⅰ', title: '作业 7', deadline: day(-1, 23, 59), submitted: true }
]

export const mockReplays: LectureReplay[] = [
  { id: 'r1', courseId: 'demo', courseName: '线性代数（甲）', title: '第 8 讲 特征值与特征向量', teacher: '李老师', recordedAt: day(-1, 9, 50), durationMinutes: 135, status: 'replay', date: day(-1, 0).slice(0, 10) },
  { id: 'r2', courseId: 'demo', courseName: '数学分析（甲）Ⅰ', title: '第 9 讲 一致连续', teacher: '张老师', recordedAt: day(-2, 8), durationMinutes: 90, status: 'replay', date: day(-1, 0).slice(0, 10) }
]

// 回放页演示：SVG 课件页（data URL）、几段文字稿
export const mockSlides: Slide[] = Array.from({ length: 12 }, (_, i) => ({
  time: i * 300,
  imageUrl:
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#fbfaf7"/><text x="80" y="160" font-size="64" font-family="serif" fill="#26221d">第 ${i + 1} 页</text><rect x="80" y="220" width="${400 + i * 40}" height="12" fill="#c9c2b6"/><rect x="80" y="260" width="620" height="12" fill="#c9c2b6"/></svg>`
    )
}))

export const mockTranscript: TranscriptSegment[] = Array.from({ length: 40 }, (_, i) => ({
  start: i * 20,
  end: i * 20 + 18,
  text: `演示文字稿第 ${i + 1} 段，用来查看侧栏的排版与滚动。`
}))
