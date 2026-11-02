import type { FormField, FormProfile } from '@shared/forms'

/** 注入脚本返回的页面状态 */
export interface PageState {
  title: string
  filled: { title: string; field: FormField }[]
  missed: string[]
  /** 可见的题目数 */
  questions: number
  /** 页面上有可见的提交按钮（多页问卷只在最后一页有） */
  submitReady: boolean
  nextPage: boolean
  captcha: boolean
  /** 已提交成功（成功页） */
  done: boolean
  /** 还没开放（没有题目，页面写着未开始 / 暂停） */
  notOpen: boolean
  /** 点过提交后页面上有校验错误 */
  invalid: boolean
  alerts: string[]
  /** 填写结果多久没变了（毫秒） */
  stableFor: number
  running: boolean
  submittedAt: number
}

export function formMatcher(): (title: string) => FormField | false | null

export function formPage(
  profile: FormProfile | null,
  op: 'install' | 'refill' | 'state' | 'submit',
  makeMatcher: typeof formMatcher
): PageState | Promise<PageState> | null
