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
  /** 开放时刻（ISO）；到点按问卷站时钟刷新再填。缺省为立即（页面写着开放时刻时按页面的） */
  at?: string
  /** true：全部填上就直接提交，有没填上的题先在应用里问；false：开放后在应用里列出全部题目，用户确认后提交 */
  autoSubmit: boolean
  /** 选填题是否在应用里列出来问；不列时只问必填题，选填的没填上也照样提交 */
  optional: boolean
}

/** 单选、下拉都按 radio 给选项；other 为应用里填不了的题（上传、日期、签名等），要到网页里填 */
export type FormQuestionKind = 'text' | 'textarea' | 'radio' | 'checkbox' | 'other'

/** 文字，或多选的选项文字 */
export type FormAnswer = string | string[]

export interface FormQuestion {
  /** 题目键（标题规范化，同名加序号），答案按它对回页面 */
  key: string
  title: string
  kind: FormQuestionKind
  required: boolean
  options: string[]
  /** 页面上现在的值（已按资料填好的也在这里） */
  value: FormAnswer
  /** 认出的本人信息字段 */
  field: FormField | null
  filled: boolean
}

/**
 * waiting 等待开放；filling 打开中 / 填写中；asking 等用户在应用里补填或确认；submitting 已点提交、等页面结果；
 * verify 出现验证码（窗口会显示出来）；login 需要扫码 / 登录（同上）；submitted 已提交；closed 窗口没了；error 打不开
 */
export type FormStatus = 'waiting' | 'filling' | 'asking' | 'submitting' | 'verify' | 'login' | 'submitted' | 'closed' | 'error'

export interface FormSession {
  id: string
  url: string
  /** 问卷标题（页面标题），取到之前为域名 */
  title: string
  status: FormStatus
  /** 开放时刻（ISO）；立即订阅、页面也没写时为 null */
  at: string | null
  /** 问卷站时钟减本机时钟（毫秒），倒计时按它校准 */
  offset: number
  autoSubmit: boolean
  optional: boolean
  /** 订阅时刻（ISO） */
  openedAt: string
  /** asking 时要问的题：自动提交只有没填上的，检查后提交为当前页全部；不列选填题时只有必填的 */
  questions: FormQuestion[]
  /** 每问一次加一，界面据此判断「稍后再填」收起的是不是这一次 */
  round: number
  /** 页面弹出的提示（如作答时间太短、提交被拒）、出错原因 */
  message: string | null
  submittedAt: string | null
  /** 提交时的答卷备份（多页问卷各页合在一起） */
  backup: { title: string; value: string }[]
}

export interface FormsApi {
  /** 本人信息；学号姓名空着时用教务（取不到时用登录账号）预填 */
  'forms:profile': () => Promise<FormProfile>
  'forms:saveProfile': (profile: FormProfile) => Promise<FormProfile>
  /** 订阅：后台开窗（不显示）加载问卷，开放后填写，立即返回这次的记录 */
  'forms:open': (url: string, options: FormOpenOptions) => Promise<FormSession>
  /** 进行中的订阅在前，已提交的（带答卷备份，存本机）在后 */
  'forms:sessions': () => Promise<FormSession[]>
  /** 用户在应用里填的答案：填进页面后提交（多页问卷翻到下一页）；必填题仍空着时不交，返回的记录里继续问 */
  'forms:answer': (id: string, answers: Record<string, FormAnswer>) => Promise<FormSession>
  /** 显示问卷窗口（应用里填不了的题）；已提交的在浏览器里打开问卷 */
  'forms:focus': (id: string) => Promise<void>
  /** 取消订阅并关掉窗口；已提交的删掉备份 */
  'forms:close': (id: string) => Promise<void>
}

export const FORMS_CHANNELS = [
  'forms:profile',
  'forms:saveProfile',
  'forms:open',
  'forms:sessions',
  'forms:answer',
  'forms:focus',
  'forms:close'
] as const satisfies readonly (keyof FormsApi)[]
