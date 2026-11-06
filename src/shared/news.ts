// 工具「校园资讯」：类型与 IPC 通道。单独成文件，ipc.ts 的 ZjuApi 继承 NewsApi、ZJU_CHANNELS 并入 NEWS_CHANNELS。
// 四类来源分层：素拓数智平台（活动与通知，结构化）→ 部处与学院官网栏目 → 微信公众号（微信读书）→ 钉钉群（实验，仅桌面）

/** 面向对象：本科 / 研究生 / 全体 */
export type NewsAudience = 'undergrad' | 'grad' | 'all'

/** 官网来源表的一行（由 scripts/news-sources.mjs 生成，部处为手工整理），basis 写明为什么收 */
export interface WebSource {
  id: string
  /** 单位：学院 / 部处名 */
  org: string
  kind: 'college' | 'office' | 'campus'
  /** 栏目名 */
  column: string
  /** 栏目列表页 */
  url: string
  audience: NewsAudience
  /** 取舍依据 */
  basis: string
  /** 生成来源表时的最近更新日期 */
  updated: string | null
}

/** 素拓数智平台上立项的活动（student/home/getXmList） */
export interface SztzActivity {
  id: string
  title: string
  /** 组织（立项）单位 */
  org: string
  /** 项目类别（分类），如「思想成长（第二课堂）」 */
  category: string
  /** 项目类型，如「美育」「劳育」「志愿服务」 */
  type: string
  aesthetic: boolean
  labor: boolean
  /** ISO；活动起止 */
  start: string | null
  end: string | null
  /** ISO；报名起止 */
  signupStart: string | null
  signupEnd: string | null
  place: string
  /** 招募人数，不限为 null */
  quota: number | null
  /** 已报名人数 */
  signed: number
  /** 记点范围，如「0.5–1」；平台没写为 null */
  points: string | null
  /** 负责人 / 电话 */
  contact: string
  /** 项目简介、注意事项（纯文字） */
  intro: string
  notes: string
  /** 报名方式原文（bmfs.label） */
  signup: string
  /** 不在本平台报名：页面上写明的具体报名方式（纯文字） */
  external: string | null
  /** 海报（平台文件查看地址） */
  poster: string | null
  /** 本人已报名 */
  joined: boolean
}

export type NewsKind = 'sztz' | 'web' | 'wechat' | 'dingtalk'

/** 一条通知（素拓通知、官网栏目条目、公众号文章、钉钉群消息） */
export interface NewsItem {
  /** kind:来源:条目 */
  id: string
  kind: NewsKind
  title: string
  /** 原文地址（钉钉消息没有） */
  url?: string
  /** ISO 或 YYYY-MM-DD */
  time: string | null
  /** 出处：单位 · 栏目 / 公众号名 / 群名 */
  from: string
  /** 官网来源的单位 id，用于按单位筛选 */
  sourceId?: string
  audience?: NewsAudience
  /** 正文开头或消息原文（素拓通知、钉钉消息） */
  text?: string
  /** 规则判不准、交给模型判断后保留的 */
  judged?: boolean
}

export interface NewsFeed {
  items: NewsItem[]
  /** 取不到的来源与原因 */
  failed: { from: string; message: string }[]
  /** 按规则或模型过滤掉的条数 */
  hidden: number
  fetchedAt: number
}

export interface NewsSettings {
  /** 关注的官网来源（WebSource.id）；默认全部部处 */
  sources: string[]
  /** 只看面向本科 / 研究生的（另加面向全体的）；all 不限 */
  audience: NewsAudience
  /** 判不准的标题交给 DeepSeek Flash（只送标题），默认关 */
  llm: boolean
  /** 已保存 DeepSeek 密钥（密钥本身加密存放，不回传界面） */
  llmKey: boolean
  /** 钉钉群（实验，Windows，默认关） */
  dingtalk: boolean
}

export type NewsSettingsPatch = Partial<Omit<NewsSettings, 'llmKey'>> & {
  /** 新密钥；null 清除 */
  llmKey?: string | null
}

/**
 * 微信读书的登录与限制状态：未登录 / 正常 / 登录过期 / 被限制（添加频繁，24 小时）。
 * 界面据此给出下一步：登录、重新登录、等到 until 再试
 */
export type WereadStatus = 'signedOut' | 'ok' | 'expired' | 'limited'

export interface WechatAccount {
  /** 微信读书里的书号 MP_WXS_<biz> */
  id: string
  name: string
  avatar?: string
  /** 最近一次取文章的错误 */
  error?: string
}

export interface WereadState {
  status: WereadStatus
  /** 被限制时，预计恢复的时刻（ms） */
  until?: number
  accounts: WechatAccount[]
}

/** 文章正文（应用内阅读） */
export interface NewsArticle {
  title: string | null
  text: string
}

export interface NewsApi {
  /** 素拓平台上的活动（未结束的在前），keyword 搜活动名称与立项单位 */
  'news:activities': (keyword?: string) => Promise<SztzActivity[]>
  /** 素拓平台通知 */
  'news:sztzNotices': () => Promise<NewsFeed>
  /** 关注的官网栏目合并后的通知（按规则过滤，可选模型判断） */
  'news:web': (force?: boolean) => Promise<NewsFeed>
  /** 官网来源表 */
  'news:sources': () => Promise<WebSource[]>
  'news:article': (url: string) => Promise<NewsArticle>
  'news:settings': () => Promise<NewsSettings>
  'news:setSettings': (patch: NewsSettingsPatch) => Promise<NewsSettings>
  /** 公众号：微信读书登录（桌面弹窗扫码）、添加（粘贴任一篇文章的链接）、移除、文章 */
  'news:weread': () => Promise<WereadState>
  'news:wereadLogin': () => Promise<WereadState>
  'news:wereadLogout': () => Promise<WereadState>
  'news:wereadAdd': (articleUrl: string) => Promise<WereadState>
  'news:wereadRemove': (id: string) => Promise<WereadState>
  'news:wechat': () => Promise<NewsFeed>
  /** 本机钉钉库里像通知的群消息（实验，仅桌面；不落盘） */
  'news:dingtalk': () => Promise<NewsFeed>
}

export type NewsChannel = keyof NewsApi

export const NEWS_CHANNELS = [
  'news:activities',
  'news:sztzNotices',
  'news:web',
  'news:sources',
  'news:article',
  'news:settings',
  'news:setSettings',
  'news:weread',
  'news:wereadLogin',
  'news:wereadLogout',
  'news:wereadAdd',
  'news:wereadRemove',
  'news:wechat',
  'news:dingtalk'
] as const satisfies readonly NewsChannel[]

export type NewsHandlers = { [K in NewsChannel]: (...args: Parameters<NewsApi[K]>) => ReturnType<NewsApi[K]> }

export const EMPTY_FEED = (): NewsFeed => ({ items: [], failed: [], hidden: 0, fetchedAt: Date.now() })
