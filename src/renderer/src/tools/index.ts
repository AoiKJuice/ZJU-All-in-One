import type { ComponentType } from 'react'
import type { ToolId } from '@renderer/store'
import { Graduation } from '@renderer/components/Graduation'
import { CourseTool } from '@renderer/components/course/CourseTool'
import { FormFill } from '@renderer/components/FormFill'
import { LibraryTool } from '@renderer/components/library/LibraryTool'
import { NewsTool } from '@renderer/components/news/NewsTool'
import { MOBILE } from '@renderer/lib/platform'
import { CourseIcon, FormIcon, GraduationIcon, LibraryIcon, NewsIcon } from './icons'

/**
 * 工具注册表：工具页按顺序画入口（徽标 + 名称），点开后整页显示 View，标题旁有返回。
 * 新工具：在 store 的 ToolId 里加 id，在 icons.tsx 画一个带悬停动效的徽标，View 不必再写页面标题；
 * 只有桌面端能用的标 desktop（安卓端不显示入口）。每个工具有自己的版本号 version，改动该工具时递增
 */
export interface ToolDef {
  id: ToolId
  name: string
  /** 本工具的迭代版本，入口卡片与标题旁显示 */
  version: string
  Icon: ComponentType
  View: ComponentType
  desktop?: boolean
}

const ALL: ToolDef[] = [
  { id: 'graduation', name: '毕业自审', version: 'v0.4', Icon: GraduationIcon, View: Graduation },
  { id: 'course', name: '选课', version: 'v0.5', Icon: CourseIcon, View: CourseTool },
  { id: 'forms', name: '问卷填写', version: 'v0.3', Icon: FormIcon, View: FormFill, desktop: true },
  { id: 'library', name: '图书馆预约', version: 'v0.4', Icon: LibraryIcon, View: LibraryTool },
  { id: 'news', name: '校园资讯', version: 'v0.3', Icon: NewsIcon, View: NewsTool }
]

export const TOOLS: ToolDef[] = ALL.filter((t) => !(MOBILE && t.desktop))
