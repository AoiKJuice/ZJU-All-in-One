import type { ClassroomCredit, EducationCredit, PracticeRecord } from '@shared/types'
import { ensureCas, zjuFetch } from '../http'

// 第二课堂（浙江大学大学生素质拓展数智平台 sztz.zju.edu.cn/dekt）。照 Celechron lib/http/zjuServices/sztz.dart（已实测）与平台前端 bundle：
// - 登录：CAS service 为 https://sztz.zju.edu.cn/dekt/，带票据访问回调得到 path=/dekt 的 SESSION；
//   再 POST /dekt/ctx（空表单），data 为 Base64 的 JSON，anonymous === false 才算登录成功；
// - 汇总：GET student/home/getMyInfo → { code: 0, extend: { myInfo } }。myInfo 给 dekt / dskt / dsikt（二 / 三 / 四课堂）的
//   Jf 记点、Xf 学分、Dj 等级、Tg 达标（dsiktTg 前端没用到，推测同名），以及 myTg / lyTg（美育 / 劳育达标）；
// - 明细：GET student/home/getSqjl → { success, code: 0, data: 记录[] }。记录的 jd 为本人记点，cyrshzt.value === 5 为审核通过，
//   sfsc 为已删除，xm.mc 项目名称，xm.xmfl / xmlb / xmlx 为分类 / 类别 / 类型（前端「我的活动」表格的列），czsj 时间；
//   分类上 sfdekt / sfdskt 标记属于第二 / 第三课堂（后台「项目分类」编辑页），两者都不是的推测为第四课堂（社会实践）。
// 平台上「学分情况」与首页只显示这些，没有学时字段。
// 不调用 student/home/zhdsiktjf（那是把三课记点转成四课的写操作）。

const BASE = 'https://sztz.zju.edu.cn/dekt'
const SERVICE = `${BASE}/`

interface MyInfo {
  dektJf?: number | string
  dektXf?: number | string
  dektDj?: string
  dektTg?: boolean | number
  dsktJf?: number | string
  dsktXf?: number | string
  dsktDj?: string
  dsktTg?: boolean | number
  dsiktJf?: number | string
  dsiktXf?: number | string
  dsiktDj?: string
  dsiktTg?: boolean | number
  myTg?: boolean | number
  lyTg?: boolean | number
}

interface SqjlRecord {
  id?: string | number
  jd?: number | string
  sfsc?: boolean
  czsj?: number | string
  cyrshzt?: { value?: number; label?: string }
  // 推测：项目类型在后台有「美育」「劳育」两个互斥开关（xxgly/xmlx 编辑页的 my / ly），明细里是否带出未实测，退而按名称判断
  xm?: {
    id?: string | number
    mc?: string
    xmfl?: { mc?: string; sfdekt?: boolean | number; sfdskt?: boolean | number }
    xmlx?: { mc?: string; my?: number | boolean; ly?: number | boolean }
  }
}

let loggedIn = false

export function reset(): void {
  loggedIn = false
}

function anonymous(body: string): boolean {
  const payload = JSON.parse(body) as { success?: boolean; code?: number; data?: string }
  if (!payload.success || payload.code !== 0 || !payload.data) return true
  const bytes = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0))
  return (JSON.parse(new TextDecoder().decode(bytes)) as { anonymous?: boolean }).anonymous !== false
}

async function ensureLogin(): Promise<void> {
  await ensureCas()
  if (loggedIn) return
  const response = await zjuFetch(`https://zjuam.zju.edu.cn/cas/login?service=${encodeURIComponent(SERVICE)}`)
  const host = new URL(response.url).hostname
  if (host === 'zjuam.zju.edu.cn') throw new Error('未登录')
  if (host !== 'sztz.zju.edu.cn') throw new Error('第二课堂登录失败')

  const ctx = await zjuFetch(`${BASE}/ctx`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://sztz.zju.edu.cn',
      Referer: SERVICE
    },
    body: ''
  })
  if (!ctx.ok || anonymous(await ctx.text())) throw new Error('第二课堂登录失败')
  loggedIn = true
}

async function get<T extends { code?: number }>(path: string, form?: Record<string, string | number>): Promise<T> {
  await ensureLogin()
  const load = async (): Promise<T | null> => {
    // 平台的 axios 封装：GET 参数放查询串，POST 体为 qs.stringify 的表单
    const body = form ? new URLSearchParams(Object.entries(form).map(([k, v]) => [k, String(v)])).toString() : undefined
    const response = await zjuFetch(`${BASE}/${path}`, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        ...(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://sztz.zju.edu.cn', Referer: SERVICE } : {})
      },
      ...(body !== undefined ? { method: 'POST', body } : {})
    })
    if (new URL(response.url).hostname !== 'sztz.zju.edu.cn' || !response.ok) return null
    const text = await response.text()
    // 会话过期时回到平台首页（HTML）
    return text.trimStart().startsWith('{') ? (JSON.parse(text) as T) : null
  }
  let result = await load()
  if (result === null) {
    reset()
    await ensureLogin()
    result = await load()
  }
  if (result === null || (result.code ?? 0) !== 0) throw new Error('第二课堂请求失败')
  return result
}

const num = (value: number | string | undefined): number | null =>
  value === undefined || value === null || value === '' ? null : Number(value)
const flag = (value: boolean | number | undefined): boolean | null => (value === undefined || value === null ? null : Boolean(value))

function classroom(points?: number | string, credits?: number | string, grade?: string, passed?: boolean | number): ClassroomCredit {
  return { points: num(points) ?? 0, credits: num(credits), grade: grade || null, passed: flag(passed) }
}

export interface Practice {
  classrooms: { second: ClassroomCredit; third: ClassroomCredit; fourth: ClassroomCredit }
  aesthetic: EducationCredit
  labor: EducationCredit
  records: PracticeRecord[] | null
}

const passed = (r: SqjlRecord): boolean => r.cyrshzt?.value === 5 || r.cyrshzt?.label === '审核通过'
const isType = (r: SqjlRecord, key: 'my' | 'ly', name: string): boolean => Boolean(r.xm?.xmlx?.[key]) || Boolean(r.xm?.xmlx?.mc?.includes(name))

function record(r: SqjlRecord, i: number): PracticeRecord {
  const label = r.cyrshzt?.label
  const date = r.czsj === undefined || r.czsj === null || r.czsj === '' ? null : new Date(r.czsj)
  const time = date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined
  return {
    id: String(r.id ?? `${r.xm?.id ?? 'x'}-${i}`),
    name: r.xm?.mc ?? '',
    classroom: r.xm?.xmfl?.sfdekt ? 'second' : r.xm?.xmfl?.sfdskt ? 'third' : 'fourth',
    status: passed(r) ? 'done' : label && /不通过|未通过|驳回|退回/.test(label) ? 'rejected' : 'pending',
    statusLabel: label,
    category: r.xm?.xmfl?.mc,
    type: r.xm?.xmlx?.mc,
    points: num(r.jd),
    time,
    aesthetic: isType(r, 'my', '美育'),
    labor: isType(r, 'ly', '劳育')
  }
}

export async function fetchPractice(): Promise<Practice> {
  const [info, records] = await Promise.all([
    get<{ code: number; extend: { myInfo: MyInfo } }>('student/home/getMyInfo'),
    get<{ code: number; data: SqjlRecord[] }>('student/home/getSqjl').catch(() => null)
  ])
  const my = info.extend.myInfo

  // 美育 / 劳育记点：审核通过、未删除、项目类型属于该类的记录合计；明细取不到时为 null
  const points = (key: 'my' | 'ly', name: string): number | null => {
    if (!records) return null
    return records.data
      .filter((r) => !r.sfsc && passed(r) && isType(r, key, name))
      .reduce((sum, r) => sum + (num(r.jd) ?? 0), 0)
  }

  return {
    classrooms: {
      second: classroom(my.dektJf, my.dektXf, my.dektDj, my.dektTg),
      third: classroom(my.dsktJf, my.dsktXf, my.dsktDj, my.dsktTg),
      fourth: classroom(my.dsiktJf, my.dsiktXf, my.dsiktDj, my.dsiktTg)
    },
    aesthetic: { passed: flag(my.myTg), points: points('my', '美育') },
    labor: { passed: flag(my.lyTg), points: points('ly', '劳育') },
    records: records ? records.data.filter((r) => !r.sfsc).map(record) : null
  }
}

// ---- 校园资讯（工具「校园资讯」）：活动列表与通知，平台前端 hdzx / tzgg 两页的只读接口 ----
// 活动：GET student/home/getXmList?keyword&page&limit&lx=2（活动中心页，lx=2 为活动；可带 date=YYYY-MM-DD 只看某天）→ { code: 0, data: 项目[], totalPages }。
// 通知：POST student/tzgg/ajaxList（表单 pageIndex / pageSize / count）→ { code: 0, count, data: [{ mc, nr(HTML), fbsj, fbr, fjid, fjmc }] }。
// 同页的 hdbm / hdqxbm（报名 / 取消）与 hdsc（收藏切换）是写操作，不调用。

export interface XmRecord {
  id?: number | string
  mc?: string
  /** 海报文件 id：common/file/view?id= */
  hdhb?: string
  xmlb?: { mc?: string }
  xmfl?: { mc?: string }
  xmlx?: { mc?: string; my?: boolean | number; ly?: boolean | number }
  lxdw?: { mc?: string }
  hdkssj?: string
  hdjssj?: string
  bmkssj?: string
  bmjssj?: string
  hddd?: string
  zmrs?: number | null
  bmrs?: number
  zxfs?: number | string | null
  zdfs?: number | string | null
  fzr?: string
  lxdh?: string
  /** 报名方式：value 3 为不在本平台报名，具体方式在 jtbmfs（HTML） */
  bmfs?: { value?: number; label?: string }
  jtbmfs?: string
  lxsx?: string
  hdzysx?: string
  sfbm?: boolean
}

export interface TzggRecord {
  id?: number | string
  mc?: string
  nr?: string
  fbsj?: string
  fbr?: string
  fjid?: string
  fjmc?: string
}

export async function fetchActivityPage(page: number, keyword = ''): Promise<{ data: XmRecord[]; totalPages: number }> {
  const query = new URLSearchParams({ keyword, page: String(page), limit: '20', lx: '2' })
  const result = await get<{ code: number; data?: XmRecord[]; totalPages?: number }>(`student/home/getXmList?${query}`)
  return { data: result.data ?? [], totalPages: result.totalPages ?? 0 }
}

export async function fetchNoticePage(page: number, size = 20): Promise<{ data: TzggRecord[]; count: number }> {
  const result = await get<{ code: number; data?: TzggRecord[]; count?: number }>('student/tzgg/ajaxList', { pageIndex: page, pageSize: size, count: 0 })
  return { data: result.data ?? [], count: result.count ?? 0 }
}

/** 平台文件（海报、附件）的查看地址 */
export const fileUrl = (id: string): string => `${BASE}/common/file/view?id=${encodeURIComponent(id)}`
