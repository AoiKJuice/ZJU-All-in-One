import type { ComponentType } from 'react'
import type { ToolId } from '@renderer/store'
import { Graduation } from '@renderer/components/Graduation'
import { FormFill } from '@renderer/components/FormFill'
import { MOBILE } from '@renderer/lib/platform'
import { FormIcon, GraduationIcon } from './icons'

/**
 * 工具注册表：工具页按顺序画入口（徽标 + 名称），点开后整页显示 View，标题旁有返回。
 * 新工具：在 store 的 ToolId 里加 id，在 icons.tsx 画一个带悬停动效的徽标，View 不必再写页面标题；
 * 只有桌面端能用的标 desktop（安卓端不显示入口）
 */
export interface ToolDef {
  id: ToolId
  name: string
  Icon: ComponentType
  View: ComponentType
  desktop?: boolean
}

const ALL: ToolDef[] = [
  { id: 'graduation', name: '毕业自审', Icon: GraduationIcon, View: Graduation },
  { id: 'forms', name: '问卷填写', Icon: FormIcon, View: FormFill, desktop: true }
]

export const TOOLS: ToolDef[] = ALL.filter((t) => !(MOBILE && t.desktop))
