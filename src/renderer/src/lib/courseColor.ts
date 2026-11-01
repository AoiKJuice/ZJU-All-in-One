import type { CourseSession } from '@shared/types'

// 课程配色：八种低饱和色（--course-0…7，随昼夜定义在 styles.css），同名课程同色。
// 按课名排序后依次分配，而不是散列，避免两门课撞色；整学期的课表不变，颜色就不变
export const COURSE_COLORS = 8

export function courseColors(sessions: CourseSession[]): Map<string, number> {
  const names = [...new Set(sessions.map((s) => s.name))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  return new Map(names.map((name, i) => [name, i % COURSE_COLORS]))
}

export const colorVar = (index: number | undefined): string => `var(--course-${index ?? 0})`
