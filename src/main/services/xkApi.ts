import type { XkHandlers } from '@shared/xk'
import * as xk from './xk'
import { findTeacher, getComments } from './chalaoshi'

// 选课与查老师的通道实现（不含订阅：订阅只在桌面端，见 main/xkwatch.ts）。桌面 ipc.ts 与安卓 bridge.ts 共用

export type XkCoreHandlers = Omit<XkHandlers, 'xk:watches' | 'xk:watch' | 'xk:unwatch'>

export const xkHandlers: XkCoreHandlers = {
  'xk:context': () => xk.getContext(),
  'xk:search': (keyword, onlyAvailable) => xk.searchCourses(keyword, onlyAvailable),
  'xk:courses': (categoryId) => xk.listCourses(categoryId),
  'xk:sections': (course) => xk.listSections(course),
  'xk:selected': () => xk.listSelected(),
  'xk:select': (section) => xk.selectSection(section),
  'xk:drop': (sectionId) => xk.dropSection(sectionId),
  'xk:reorder': (sectionIds) => xk.reorderSections(sectionIds),
  'cls:teacher': (name, college) => findTeacher(name, college),
  'cls:comments': (id, sort) => getComments(id, sort)
}

export const resetXk = (): void => xk.reset()
