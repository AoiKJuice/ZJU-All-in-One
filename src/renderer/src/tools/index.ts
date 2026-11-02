import type { ComponentType } from 'react'
import type { ToolId } from '@renderer/store'
import { Graduation } from '@renderer/components/Graduation'
import { GraduationIcon } from './icons'

/**
 * 工具注册表：工具页按顺序画入口（徽标 + 名称），点开后整页显示 View，标题旁有返回。
 * 新工具：在 store 的 ToolId 里加 id，在 icons.tsx 画一个带悬停动效的徽标，View 不必再写页面标题
 */
export interface ToolDef {
  id: ToolId
  name: string
  Icon: ComponentType
  View: ComponentType
}

export const TOOLS: ToolDef[] = [{ id: 'graduation', name: '毕业自审', Icon: GraduationIcon, View: Graduation }]
