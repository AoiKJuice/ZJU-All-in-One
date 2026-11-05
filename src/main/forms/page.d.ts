import type { FormAnswer, FormField, FormProfile, FormQuestion } from '@shared/forms'

/** 注入脚本返回的页面状态 */
export interface PageState {
  title: string
  /** 当前页的题目键串，翻页、换出题目时会变 */
  page: string
  filled: { title: string; field: FormField }[]
  missed: string[]
  /** 认出了题、资料里却没有的项 */
  lacking: FormField[]
  /** 有必填题没填上（没认出，或缺资料） */
  blocked: boolean
  /** 可见的题目数 */
  questions: number
  /** 页面上有可见的提交按钮（多页问卷只在最后一页有） */
  submitReady: boolean
  nextPage: boolean
  captcha: boolean
  /** 页面写着登录后才能填写，题目都填不了 */
  needLogin: boolean
  /** 已提交成功（成功页） */
  done: boolean
  /** 还没开放（没有题目，页面写着未开始 / 暂停） */
  notOpen: boolean
  /** 已停止收集 / 已截止 / 已填写过（页面上的原话），不会再开放 */
  ended: string | null
  /** 未开放页面上写着的开放时刻（ISO） */
  opensAt: string | null
  /** 点过提交后页面上有校验错误 */
  invalid: boolean
  alerts: string[]
  /** 填写结果多久没变了（毫秒）；填过的值被页面清掉、还没重填好时为 0 */
  stableFor: number
  running: boolean
  submittedAt: number
}

export function formMatcher(): (title: string) => FormField | false | null

export function formPage(
  profile: FormProfile | null,
  op: 'install' | 'state' | 'describe' | 'answer' | 'submit',
  makeMatcher: typeof formMatcher,
  arg?: Record<string, FormAnswer> | null
): PageState | Promise<PageState> | Promise<FormQuestion[]> | null
