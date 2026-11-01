import type { ClassroomCredit, EducationCredit } from '@shared/types'
import { ensureCas, zjuFetch } from '../http'

// 第二课堂（浙江大学大学生素质拓展数智平台 sztz.zju.edu.cn/dekt）。照 Celechron lib/http/zjuServices/sztz.dart（已实测）与平台前端 bundle：
// - 登录：CAS service 为 https://sztz.zju.edu.cn/dekt/，带票据访问回调得到 path=/dekt 的 SESSION；
//   再 POST /dekt/ctx（空表单），data 为 Base64 的 JSON，anonymous === false 才算登录成功；
// - 汇总：GET student/home/getMyInfo → { code: 0, extend: { myInfo } }。myInfo 给 dekt / dskt / dsikt（二 / 三 / 四课堂）的
//   Jf 记点、Xf 学分、Dj 等级、Tg 达标（dsiktTg 前端没用到，推测同名），以及 myTg / lyTg（美育 / 劳育达标）；
// - 明细：GET student/home/getSqjl → { success, code: 0, data: 记录[] }。记录的 jd 为本人记点，cyrshzt.value === 5 为审核通过，
//   sfsc 为已删除，xm.xmlx 为项目类型。
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
  jd?: number | string
  sfsc?: boolean
  cyrshzt?: { value?: number; label?: string }
  // 推测：项目类型在后台有「美育」「劳育」两个互斥开关（xxgly/xmlx 编辑页的 my / ly），明细里是否带出未实测，退而按名称判断
  xm?: { xmlx?: { mc?: string; my?: number | boolean; ly?: number | boolean } }
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

async function get<T extends { code?: number }>(path: string): Promise<T> {
  await ensureLogin()
  const load = async (): Promise<T | null> => {
    const response = await zjuFetch(`${BASE}/${path}`, { headers: { Accept: 'application/json, text/plain, */*' } })
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
  if (result === null || result.code !== 0) throw new Error('第二课堂请求失败')
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
      .filter((r) => !r.sfsc && (r.cyrshzt?.value === 5 || r.cyrshzt?.label === '审核通过'))
      .filter((r) => {
        const type = r.xm?.xmlx
        return Boolean(type?.[key]) || Boolean(type?.mc?.includes(name))
      })
      .reduce((sum, r) => sum + (num(r.jd) ?? 0), 0)
  }

  return {
    classrooms: {
      second: classroom(my.dektJf, my.dektXf, my.dektDj, my.dektTg),
      third: classroom(my.dsktJf, my.dsktXf, my.dsktDj, my.dsktTg),
      fourth: classroom(my.dsiktJf, my.dsiktXf, my.dsiktDj, my.dsiktTg)
    },
    aesthetic: { passed: flag(my.myTg), points: points('my', '美育') },
    labor: { passed: flag(my.lyTg), points: points('ly', '劳育') }
  }
}
