// 选课（教务"自主选课"）与查老师：类型与 IPC 通道。单独成文件，ipc.ts 的 ZjuApi 继承 XkApi、ZJU_CHANNELS 并入 XK_CHANNELS

/** 选课首页给出的当前学期与已选学分（低定资格看 total ≤ 22） */
export interface XkContext {
  /** 如 2026-2027 */
  xn: string
  /** 1 秋冬 / 2 春夏 */
  xq: string
  /** 每门课（通识为每个时间组）可填志愿数，教务首页的 xkzys，逐学期可能变（有时只有 1） */
  maxChoices: number
  credits: { total: number; regular: number; short: number } | null
  /** 当前轮次（常规第几轮 / 低学分定点 / 补退选）与截止时刻，取自选课首页的文字（推测，取不到为 null） */
  round: { name: string; lowCredit: boolean; until: string | null } | null
  /** 选课首页的课程类别页签（本专业 / 通识 / 体育 / 全部课程…），搜索另走 xk:search */
  categories: XkCategory[]
}

export interface XkCategory {
  /** 区分页签用：代码 + 名称（同一代码下可能有几个页签，如 xk_rdxkc 下的美育类、劳育类…），xk:courses 传它 */
  key: string
  /** 页签代码 dl（如 xk_1） */
  id: string
  lx: string
  name: string
  kcbs: string
}

/** 上课时段（解析自"周一第3,4,5节{单周}"） */
export interface XkSlot {
  /** 1 = 周一 … 7 = 周日 */
  weekday: number
  start: number
  end: number
  parity: 'all' | 'odd' | 'even'
}

/** 课程池里的一门课 */
export interface XkCourse {
  /** 课程代码 */
  code: string
  name: string
  credit: number | null
  category: string
  college: string
  /** 选课页显示的课程代码（如 CS1030M）；code 是教务内部代码 */
  displayCode?: string
  /** 课程性质（必修 / 选修…） */
  nature?: string
  semesterPart?: string
  /** 课程池号，展开教学班时回传 */
  pool: string
  /** 所属页签 dl；xk_9 为搜索结果 */
  tab: string
  /** 搜索关键词，展开搜索结果的教学班时需原样带上 */
  keyword: string
}

/** 教学班 */
export interface XkSection {
  /** 教学班号（选课、退课都用它） */
  id: string
  courseCode: string
  courseName: string
  teachers: string[]
  times: string[]
  places: string[]
  exam: string
  /** 秋冬 / 秋 / 冬 / 春夏 / 春 / 夏 */
  semesterPart: string
  /** 余量，最低为 0 */
  remaining: number | null
  capacity: number | null
  /** 报满后超出容量的人数（教务的余量为负时） */
  over?: number
  /** 教学方式、周学时、面向对象、教材（教学班接口原样给的，可能为空） */
  mode?: string
  weeklyHours?: string
  audience?: string
  textbook?: string
  /** 待定（已填志愿、待筛选）人数 */
  pending: number | null
  /** 已在本人志愿中：selected 已选上 / pending 待筛选 */
  state?: 'selected' | 'pending'
  /** 志愿次序 */
  order?: number
  /** 志愿组：通识按上课时间分组（教务的 xkzyfz），其余按课程代码 */
  group?: string
  /** 解析出的上课时段，供课表预览与冲突判断 */
  slots: XkSlot[]
  /** 提交选课时要带的表名（取教学班接口的实际返回值） */
  table: string
}

export interface XkWriteResult {
  status: 'saved' | 'already' | 'rejected' | 'unknown'
  message: string
}

/** 订阅的教学班：有余量时提醒，auto 为用户事先授权的自动提交 */
export interface XkWatch {
  course: XkCourse
  section: XkSection
  auto: boolean
  /** 最近一次查到的余量 */
  remaining: number | null
  checkedAt: number | null
  /** 已选上或已提交后停止 */
  done?: string
}

/** 查老师（chalaoshi.de）的教师评分 */
export interface ClsTeacher {
  id: number
  name: string
  college: string
  /** 无评分为 null */
  rating: number | null
  ratingCount: number
  /** 认为会点名的比例 0–100 */
  rollCall: number | null
  courses: { name: string; gpa: number; sample: string }[]
  commentCount: number
  url: string
}

export interface ClsComment {
  id: number
  text: string
  likes: number
  date: string
}

/** Agent 经 MCP 发起、要用户在应用内确认的选课写操作 */
export type XkConfirmAction = 'select' | 'drop' | 'reorder' | 'autoselect'

export interface XkApi {
  /** 选课：当前学期、志愿数与学分、类别页签；选课未开放时报错 */
  'xk:context': () => Promise<XkContext>
  'xk:search': (keyword: string, onlyAvailable?: boolean) => Promise<XkCourse[]>
  /** 某个类别页签下的全部课程（传 XkCategory.key） */
  'xk:courses': (categoryKey: string) => Promise<XkCourse[]>
  'xk:sections': (course: XkCourse) => Promise<XkSection[]>
  /** 本人已填的志愿（含已选上的） */
  'xk:selected': () => Promise<XkSection[]>
  /** 写：加入志愿 / 退选（结果以回查已选为准，不重发） */
  'xk:select': (section: XkSection) => Promise<XkWriteResult>
  'xk:drop': (sectionId: string) => Promise<XkWriteResult>
  /** 调整一个志愿组的顺序：传该组全部教学班，按新顺序 */
  'xk:reorder': (sectionIds: string[]) => Promise<XkWriteResult>
  /** 订阅教学班余量；auto 为有余量时自动提交（只在桌面端） */
  'xk:watches': () => Promise<XkWatch[]>
  'xk:watch': (course: XkCourse, section: XkSection, auto: boolean) => Promise<XkWatch[]>
  'xk:unwatch': (sectionId: string) => Promise<XkWatch[]>
  /** 查老师：按姓名（可带学院）找教师评分；评论 */
  'cls:teacher': (name: string, college?: string) => Promise<ClsTeacher | null>
  'cls:comments': (id: number, sort: 'rate' | 'time') => Promise<ClsComment[]>
  /** 一批教师的评分（只查本地缓存的索引，不取详情页），键为 姓名|学院；查不到为 null */
  'cls:ratings': (teachers: { name: string; college?: string }[]) => Promise<Record<string, number | null>>
}

export type XkChannel = keyof XkApi

export const XK_CHANNELS = [
  'xk:context',
  'xk:search',
  'xk:courses',
  'xk:sections',
  'xk:selected',
  'xk:select',
  'xk:drop',
  'xk:reorder',
  'xk:watches',
  'xk:watch',
  'xk:unwatch',
  'cls:teacher',
  'cls:comments',
  'cls:ratings'
] as const satisfies readonly XkChannel[]

/** 去掉主进程 handler 的 win 参数后的通道实现，桌面端与安卓端共用 */
export type XkHandlers = { [K in XkChannel]: (...args: Parameters<XkApi[K]>) => ReturnType<XkApi[K]> }
