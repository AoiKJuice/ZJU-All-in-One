// 问卷填写（工具页）的类型与 IPC 通道。单独成文件，ipc.ts 里只并入一次，免得与其他工具的分支反复冲突

/** 填问卷用的本人信息，safeStorage 加密存本机 */
export interface FormProfile {
  studentId: string
  name: string
  gender: string
  className: string
  major: string
  college: string
  grade: string
  campus: string
  phone: string
  email: string
  qq: string
  wechat: string
  dorm: string
}

export type FormField = keyof FormProfile | 'majorClass' | 'collegeMajor'

export interface FormOpenOptions {
  /** 开放时刻（ISO）；到点按问卷站时钟刷新再填。缺省为立即 */
  at?: string
  /** 全部认出后自动提交（有认不出的必填题时一律不交） */
  autoSubmit: boolean
}

/**
 * waiting 等待开放；filling 填写中；filled 已填好待用户提交；attention 有必填题没认出；
 * verify 出现验证码；login 需要扫码 / 登录；submitted 已提交；closed 窗口已关；error 打不开
 */
export type FormStatus = 'waiting' | 'filling' | 'filled' | 'attention' | 'verify' | 'login' | 'submitted' | 'closed' | 'error'

export interface FormSession {
  id: string
  url: string
  /** 问卷标题（页面标题），取到之前为域名 */
  title: string
  status: FormStatus
  /** 开放时刻（ISO），立即打开为 null */
  at: string | null
  /** 问卷站时钟减本机时钟（毫秒），倒计时按它校准 */
  offset: number
  autoSubmit: boolean
  /** 打开时刻（ISO） */
  openedAt: string
  /** 已填的题：题目与所填的字段 */
  filled: { title: string; field: FormField }[]
  /** 没认出的必填题 */
  missed: string[]
  /** 认出了题、个人信息里却没填的项 */
  lacking: FormField[]
  /** 页面弹出的提示（如作答时间太短、提交被拒）、出错原因 */
  message: string | null
}

export interface FormsApi {
  /** 本人信息；首次使用时用教务的姓名学号预填 */
  'forms:profile': () => Promise<FormProfile>
  'forms:saveProfile': (profile: FormProfile) => Promise<FormProfile>
  /** 开窗加载问卷并填写，立即返回这次的记录 */
  'forms:open': (url: string, options: FormOpenOptions) => Promise<FormSession>
  /** 本次运行打开过的问卷，新的在前 */
  'forms:sessions': () => Promise<FormSession[]>
  /** 把问卷窗口提到前面 */
  'forms:focus': (id: string) => Promise<void>
  /** 按当前保存的信息重新填一遍（改了信息之后用） */
  'forms:refill': (id: string) => Promise<FormSession>
  /** 关窗（定时的同时取消）；窗口已关时从记录里移除 */
  'forms:close': (id: string) => Promise<void>
}

export const FORMS_CHANNELS = [
  'forms:profile',
  'forms:saveProfile',
  'forms:open',
  'forms:sessions',
  'forms:focus',
  'forms:refill',
  'forms:close'
] as const satisfies readonly (keyof FormsApi)[]
