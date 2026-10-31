import type { CourseSession, DataResult } from '@shared/types'
import { ensureCas, zjuFetch } from '../http'
import { currentTerm } from './zdbk'

// ETA（eta.zju.edu.cn，正方学工系统"三全育人学生信息平台"）：课表主来源，教务（zdbk）出错或为空时再退回教务。
// 接口照开源的 Elychron（Celechron 分支）lib/http/zjuServices/eta.dart：
// - 登录：CAS service 必须是站点自己的 http 地址 teacher/xtgl/index/check.zf，带票据跳回时升到 https；
// - 课表：GET student/xtgl/index/getTableKcb.zf?xnxq=2026-2027-1 → { code, data: { kbList: { [星期]: 条目[] } } }，
//   条目直接给 xqj 星期、ksj 起始节、ks 节数、xxq 半学期、dsz 单双周（all / single / double），只有当前学年学期有数据。
//   不给教学周范围，按整个半学期（1–8 周）算。

const BASE = 'https://eta.zju.edu.cn/zftal-xgxt-web'
const SERVICE = 'http://eta.zju.edu.cn/zftal-xgxt-web/teacher/xtgl/index/check.zf'

interface EtaEntry {
  xqj: number | string
  ksj: number | string
  ks?: number | string
  xxq?: string
  dsz?: string
  ke?: { kcmc?: string; rkjs?: string; jsmc?: string }[]
}

interface TableResponse {
  code: number
  data?: { kbList?: Record<string, EtaEntry[]> }
}

let loggedIn = false

export function reset(): void {
  loggedIn = false
}

async function ensureLogin(): Promise<void> {
  await ensureCas()
  if (loggedIn) return
  const response = await zjuFetch(
    `https://zjuam.zju.edu.cn/cas/login?service=${encodeURIComponent(SERVICE)}`,
    { upgradeHttp: true }
  )
  const host = new URL(response.url).hostname
  if (host === 'zjuam.zju.edu.cn') throw new Error('未登录')
  if (host !== 'eta.zju.edu.cn' || !response.ok) throw new Error('ETA 登录失败')
  loggedIn = true
}

async function getTable(xnxq: string): Promise<TableResponse> {
  await ensureLogin()
  const url = `${BASE}/student/xtgl/index/getTableKcb.zf?xnxq=${encodeURIComponent(xnxq)}`
  const load = () => zjuFetch(url, {
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    upgradeHttp: true
  })
  let response = await load()
  // 会话过期时被带去登录页，重新换一次票据
  if (new URL(response.url).hostname !== 'eta.zju.edu.cn' || !response.ok) {
    reset()
    await ensureLogin()
    response = await load()
  }
  if (!response.ok) throw new Error('ETA 请求失败')
  const result = await response.json<TableResponse>()
  if (result.code !== 0) throw new Error('ETA 查询失败')
  return result
}

const parity = (dsz = ''): CourseSession['weekParity'] => {
  const value = dsz.toLowerCase()
  if (value === 'single' || value === '1' || value === '单') return 'odd'
  if (value === 'double' || value === '2' || value === '双') return 'even'
  return 'all'
}

export async function fetchSchedule(): Promise<DataResult<CourseSession[]>> {
  const { xnm, xqm } = currentTerm()
  const term = xqm.startsWith('1') ? '1' : '2'
  const result = await getTable(`${xnm}-${term}`)
  const entries = Object.values(result.data?.kbList ?? {}).flat()

  const data = entries.flatMap((entry, index): CourseSession[] => {
    const course = entry.ke?.[0]
    const startPeriod = Number(entry.ksj)
    if (!course?.kcmc || !startPeriod) return []
    return [{
      id: `eta-course-${index}`,
      name: course.kcmc.replace(/\(/g, '（').replace(/\)/g, '）'),
      teacher: course.rkjs ?? '',
      location: course.jsmc ?? '',
      weekday: Number(entry.xqj),
      startPeriod,
      endPeriod: startPeriod + Math.max(Number(entry.ks) || 1, 1) - 1,
      semesterPart: entry.xxq || (term === '1' ? '秋冬' : '春夏'),
      weekRange: [1, 8],
      weekParity: parity(entry.dsz)
    }]
  })

  return { data, source: 'live', fetchedAt: Date.now() }
}
