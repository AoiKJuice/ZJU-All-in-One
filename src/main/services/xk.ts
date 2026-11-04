import type { XkCategory, XkContext, XkCourse, XkSection, XkSlot, XkWriteResult } from '@shared/xk'
import { page, post, studentId } from './zdbk'

// 教务"自主选课"（浙大定制的正方 zzxkghb 系列，模块 N253530）。
// 接口事实参考 campus-agent（core/zju/lib/zdbk，2026-09 登录态实测并读过当期前端 zzxkghb.js；该项目无许可证，只参考事实）：
// - 首页 GET xsxk/zzxkghb_cxZzxkGhbIndex.html：隐藏域 xn / xq / nj / zydm / xkzys / ylxs；
//   类别页签是 <li kclbmc|title kcbs> 里的 <a onclick="categroyClick(this,'dl','lx')">，取 onclick 实参（data-dl 可能不一致）；
//   xk_9 是搜索页签，xk_1_1 / iconyjsxk / xk_7 是补考等特殊流程，不列出；
// - 类别课程 POST cxZzxkGhbKcList：dl, lx, xkmc（类别名，竺院 dl=Z 为"竺可桢学院课程"）, kcbs, nj, xn, xq, zydm,
//   jxjhh（nj+zydm；xk_6 为 学年前四位+cx01）, xnxq=(xn-xq)-, kspage / jspage；
// - 搜课 POST cxZzxkGhbDdkcList：xnxq、cxtjList[0].cxlb/cxgx/cxnr、cx_ylcx 只看有余量、kspage / jspage；
// - 教学班 POST cxZzxkGhbJxbList：dl、xn、xq、kcdm、xkkh=课程池号、ylxs；搜索页签再带原搜索条件。rs 为"余量/容量"，yxrs 待定人数；
// - 已选 POST cxZzxkGhbChoosed（sxbj 1 已选上 / 0 待筛选，xkzy 志愿次序，xkzyfz 志愿组：通识按上课时间分组）；
// - 学分 POST cxZzxkYxxf（xf9 / xf91 / xf92）；
// - 选课 POST xkBcZyZzxkGhb {xn,xq,nj,xkkh,tabname,xkzys}，flag=1 成功；退课 POST tuikBcZzxkGhb {xkkh}；
//   排序 POST xkBcZypxZzxkGhb {xkkhs, zypxs}（一组的完整新顺序，组内从 1 编号，成功返回字符串 success）。
//   写请求不重发：结果不明时以回查"已选"为准。
// 以上都未以登录态实测；写接口只能由用户在选课窗口期自己验证。培养方案里还没修的课取自毕业自审（graduation.ts）。

const MODULE = 'N253530'
const SEARCH_TAB = 'xk_9'
const SPECIAL_TABS = new Set(['xk_1_1', 'iconyjsxk', 'xk_7'])
const PAGE = 200

interface Context {
  xn: string
  xq: string
  nj: string
  zydm: string
  xkzys: string
  ylxs: string
  categories: XkCategory[]
}

type Row = Record<string, string | number | null | undefined>

let context: Context | undefined

export function reset(): void {
  context = undefined
}

const url = async (name: string): Promise<string> =>
  `/xsxk/zzxkghb_${name}.html?gnmkdm=${MODULE}&su=${await studentId()}`

const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v))
const lines = (v: unknown): string[] =>
  text(v)
    .split(/<br\s*\/?>/i)
    .map((s) => s.replace(/<[^>]+>/g, '').trim())
    .filter((s) => s && s !== '--')

const attrs = (tag: string): Record<string, string> =>
  Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map((m) => [m[1], m[3]]))

function parseCategories(html: string): XkCategory[] {
  const categories: XkCategory[] = []
  const stack: Record<string, string>[] = []
  for (const m of html.matchAll(/<li\b[^>]*>|<\/li\s*>|<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = m[0]
    if (/^<li\b/i.test(tag)) {
      stack.push(attrs(tag))
      continue
    }
    if (/^<\/li/i.test(tag)) {
      stack.pop()
      continue
    }
    const a = attrs(tag.slice(0, tag.indexOf('>') + 1))
    const call = /categroyClick\(\s*this\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/.exec(a['onclick'] ?? '')
    if (!call || call[1] === SEARCH_TAB || SPECIAL_TABS.has(call[1])) continue
    const parent = stack.at(-1) ?? {}
    const name = parent['kclbmc'] || parent['title'] || tag.replace(/<[^>]+>/g, '').trim()
    if (!categories.some((c) => c.id === call[1] && c.name === name)) {
      categories.push({ key: `${call[1]}|${name}`, id: call[1], lx: call[2], name, kcbs: parent['kcbs'] ?? '' })
    }
  }
  return categories
}

async function loadContext(fresh = false): Promise<Context> {
  if (context && !fresh) return context
  const html = (await page(await url('cxZzxkGhbIndex'))).replace(/<!--[\s\S]*?-->/g, '')
  const inputs: Record<string, string> = {}
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    const a = attrs(tag)
    const key = a['id'] || a['name']
    if (key) inputs[key] = a['value'] ?? ''
  }
  if (!inputs['xn'] || !inputs['xq'] || !inputs['xkzys']) throw new Error('选课未开放')
  context = {
    xn: inputs['xn'],
    xq: inputs['xq'],
    nj: inputs['nj'] ?? '',
    zydm: inputs['zydm'] ?? '',
    xkzys: inputs['xkzys'],
    ylxs: inputs['ylxs'] ?? '',
    categories: parseCategories(html)
  }
  return context
}

const searchForm = (c: Context, keyword: string, onlyAvailable: boolean): Record<string, string> => ({
  xnxq: `(${c.xn}-${c.xq})-`,
  cx_zbgx: 'and',
  cx_ylcx: onlyAvailable ? '1' : '0',
  'cxtjList[0].cxlb': 'kcmc',
  'cxtjList[0].cxgx': 'like',
  'cxtjList[0].cxnr': keyword
})

// rs 为"余量/容量"；报满后余量是负数（实测 "-22/216" 即已超出 22 人），余量记 0、超出的记到 over
const capacity = (v: unknown): { remaining: number | null; capacity: number | null; over?: number } => {
  const m = /^\s*(-?\d+)\s*\/\s*(\d+)\s*$/.exec(text(v))
  if (!m) return { remaining: null, capacity: null }
  const left = Number(m[1])
  return { remaining: Math.max(0, left), capacity: Number(m[2]), ...(left < 0 ? { over: -left } : {}) }
}

// yxrs 为待定人数，实测写作 "0~0"（推测为第一志愿~全部志愿的待定人数），取较大的一段
const pendingOf = (v: unknown): number | null => {
  const nums = text(v).match(/\d+/g)
  return nums ? Math.max(...nums.map(Number)) : null
}

const WEEKDAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }

/** "周一第3,4,5节{单周}" / "周三第6-8节" → 时段；节次不连续时拆成几段 */
export function parseSlots(times: string[]): XkSlot[] {
  const slots: XkSlot[] = []
  for (const t of times) {
    const parity: XkSlot['parity'] = t.includes('单周') ? 'odd' : t.includes('双周') ? 'even' : 'all'
    for (const m of t.matchAll(/周([一二三四五六日天])第\s*([\d,，\s-]+)\s*节/g)) {
      const periods = m[2]
        .split(/[,，\s]+/)
        .flatMap((p) => {
          const [a, b] = p.split('-').map(Number)
          return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : a ? [a] : []
        })
        .sort((a, b) => a - b)
      for (const p of periods) {
        const last = slots.at(-1)
        if (last && last.weekday === WEEKDAY[m[1]] && last.end === p - 1 && last.parity === parity) last.end = p
        else slots.push({ weekday: WEEKDAY[m[1]], start: p, end: p, parity })
      }
    }
  }
  return slots
}

function toSection(row: Row, course: { code: string; name: string }): XkSection {
  const times = lines(row['sksj'])
  const code = text(row['kcdm']) || course.code
  return {
    id: text(row['xkkh']),
    courseCode: code,
    courseName: text(row['kcmc']) || course.name,
    teachers: lines(row['jsxm']),
    times,
    // skdd 每段上课时间一行，同一教室会重复
    places: [...new Set(lines(row['skdd']))],
    exam: lines(row['kssj']).join(' '),
    semesterPart: text(row['xxq']),
    ...capacity(row['rs']),
    pending: pendingOf(row['yxrs']),
    table: text(row['tabname']),
    slots: parseSlots(times),
    ...(row['sxbj'] !== undefined && row['sxbj'] !== null
      ? {
          state: text(row['sxbj']) === '1' ? ('selected' as const) : ('pending' as const),
          order: Number(row['xkzy']) || undefined,
          group: text(row['xkzyfz']) || code
        }
      : {})
  }
}

const toCourse = (row: Row, tab: string, keyword: string): XkCourse => ({
  code: text(row['kcdm']),
  name: text(row['kcmc']),
  // 课程行没有 xf，学分在 kcxx（"0~3.0~3.0-0.0"）的第二段
  credit: Number(text(row['kcxx']).split('~')[1]) || Number(row['xf']) || null,
  category: text(row['kclb']),
  college: text(row['kkxy']),
  pool: text(row['xkkh']),
  tab,
  keyword
})

export async function getContext(): Promise<XkContext> {
  const c = await loadContext(true)
  const result = await post<{ status?: string; result?: Row }>(await url('cxZzxkYxxf'), {})
  const v = result.result
  return {
    xn: c.xn,
    xq: c.xq,
    maxChoices: Number(c.xkzys) || 1,
    credits: result.status === 'success' && v
      ? { total: Number(v['xf9']) || 0, regular: Number(v['xf91']) || 0, short: Number(v['xf92']) || 0 }
      : null,
    categories: c.categories
  }
}

export async function listCourses(categoryKey: string): Promise<XkCourse[]> {
  const c = await loadContext()
  // 同一代码下可能有几个页签（实测 xk_rdxkc 下有美育类、劳育类等），按 key 认；只给代码时取第一个
  const cat = c.categories.find((x) => x.key === categoryKey) ?? c.categories.find((x) => x.id === categoryKey)
  if (!cat) throw new Error('没有这个类别')
  const rows = await post<Row[]>(await url('cxZzxkGhbKcList'), {
    dl: cat.id,
    lx: cat.lx,
    xkmc: cat.id === 'Z' ? '竺可桢学院课程' : cat.name,
    kcbs: cat.kcbs,
    nj: c.nj,
    xn: c.xn,
    xq: c.xq,
    zydm: c.zydm,
    jxjhh: cat.id === 'xk_6' ? `${c.xn.slice(0, 4)}cx01` : c.nj + c.zydm,
    xnxq: `(${c.xn}-${c.xq})-`,
    kspage: '1',
    jspage: String(PAGE)
  })
  return rows.map((row) => toCourse(row, cat.id, ''))
}

export async function searchCourses(keyword: string, onlyAvailable = false): Promise<XkCourse[]> {
  const c = await loadContext()
  const rows = await post<Row[]>(await url('cxZzxkGhbDdkcList'), {
    ...searchForm(c, keyword, onlyAvailable),
    kspage: '1',
    jspage: String(PAGE)
  })
  return rows.map((row) => toCourse(row, SEARCH_TAB, keyword))
}

export async function listSections(course: XkCourse): Promise<XkSection[]> {
  const c = await loadContext()
  const tab = course.tab || SEARCH_TAB
  const rows = await post<Row[]>(await url('cxZzxkGhbJxbList'), {
    dl: tab,
    xn: c.xn,
    xq: c.xq,
    kcdm: course.code,
    xkkh: course.pool,
    ylxs: c.ylxs,
    ...(tab === SEARCH_TAB ? searchForm(c, course.keyword, false) : {})
  })
  return rows.map((row) => toSection(row, course))
}

export async function listSelected(): Promise<XkSection[]> {
  const c = await loadContext()
  const rows = await post<Row[]>(await url('cxZzxkGhbChoosed'), { xn: c.xn, xq: c.xq })
  return rows.map((row) => toSection(row, { code: '', name: '' }))
}

type FlagResponse = { flag?: string | number; msg?: string } | string | undefined

const rejected = (r: FlagResponse): string | null =>
  r && typeof r === 'object' && text(r.flag) === '0' ? r.msg || '教务拒绝' : null

export async function selectSection(section: XkSection): Promise<XkWriteResult> {
  const c = await loadContext(true)
  if ((await listSelected()).some((s) => s.id === section.id)) return { status: 'already', message: '已在志愿中' }
  let response: FlagResponse
  try {
    response = await post(await url('xkBcZyZzxkGhb'), {
      xn: c.xn,
      xq: c.xq,
      nj: c.nj,
      xkkh: section.id,
      tabname: section.table,
      xkzys: c.xkzys
    })
  } catch {
    // 结果不明：下面回查
  }
  if ((await listSelected()).some((s) => s.id === section.id)) return { status: 'saved', message: '已加入志愿' }
  const reason = rejected(response)
  if (reason) return { status: 'rejected', message: reason }
  return { status: 'unknown', message: '结果未知，请查看志愿' }
}

export async function dropSection(sectionId: string): Promise<XkWriteResult> {
  await loadContext(true)
  if (!(await listSelected()).some((s) => s.id === sectionId)) return { status: 'already', message: '已不在志愿中' }
  let response: FlagResponse
  try {
    response = await post(await url('tuikBcZzxkGhb'), { xkkh: sectionId })
  } catch {
    // 结果不明：下面回查
  }
  if (!(await listSelected()).some((s) => s.id === sectionId)) return { status: 'saved', message: '已退选' }
  const reason = rejected(response)
  if (reason) return { status: 'rejected', message: reason }
  return { status: 'unknown', message: '结果未知，请查看志愿' }
}

/** 一组志愿的新顺序：必须是该组全部教学班，组内从 1 编号 */
export async function reorderSections(sectionIds: string[]): Promise<XkWriteResult> {
  await loadContext(true)
  const before = await listSelected()
  const group = before.find((s) => s.id === sectionIds[0])?.group
  const members = before.filter((s) => s.group === group)
  if (!group || members.length !== sectionIds.length || !sectionIds.every((id) => members.some((s) => s.id === id))) {
    throw new Error('志愿已变化，请刷新后再调整')
  }
  let response: FlagResponse
  try {
    response = await post(await url('xkBcZypxZzxkGhb'), {
      xkkhs: sectionIds.join(','),
      zypxs: sectionIds.map((_, i) => i + 1).join(',')
    })
  } catch {
    // 结果不明：下面回查
  }
  const after = await listSelected()
  if (sectionIds.every((id, i) => after.find((s) => s.id === id)?.order === i + 1)) return { status: 'saved', message: '已调整顺序' }
  const reason = rejected(response)
  if (reason) return { status: 'rejected', message: reason }
  return { status: 'unknown', message: '结果未知，请查看志愿' }
}

