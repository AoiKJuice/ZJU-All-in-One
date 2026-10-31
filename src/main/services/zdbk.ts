import type { CourseSession, DataResult, Exam, UserProfile } from '@shared/types'
import { ensureCas, zjuFetch, type ZjuResponse } from '../http'

const BASE = 'https://zdbk.zju.edu.cn/jwglxt'
// 推测：所给参考摘录未覆盖 SSO 地址。
const SSO_URL = `${BASE}/xtgl/login_ssologin.html`
const SCHEDULE_PATH = '/kbcx/xskbcx_cxXsKb.html'
const EXAMS_PATH = '/xskscx/kscx_cxXsgrksIndex.html?doType=query&queryModel.showCount=5000'

interface ScheduleRow {
  kcb: string
  xqj: string
  djj: string
  skcd: string
  xxq: string
  dsz?: string
}

interface ScheduleResponse {
  kbList: ScheduleRow[]
  // 推测：参考摘录未提供更可靠的个人信息来源。
  xsxx: {
    XH: string
    XM: string
  }
}

interface ExamRow {
  kcmc: string
  kssj?: string
  jsmc: string
  zwxh?: string
  qzkssj?: string
  qzjsmc: string
  qzzwxh?: string
}

interface ExamResponse {
  items: ExamRow[]
}

let loggedIn = false

export function reset(): void {
  loggedIn = false
}

function live<T>(data: T): DataResult<T> {
  return { data, source: 'live', fetchedAt: Date.now() }
}

// 推测：月份划分及 xnm 的学年格式未由所给摘录验证。
export function currentTerm(): { xnm: string; xqm: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric'
  }).formatToParts(new Date())

  const year = Number(parts.find((part) => part.type === 'year')!.value)
  const month = Number(parts.find((part) => part.type === 'month')!.value)
  const startYear = month >= 9 ? year : year - 1
  const xqm = month >= 9 && month <= 11
    ? '1|秋'
    : month === 12 || month === 1
      ? '1|冬'
      : month <= 4
        ? '2|春'
        : '2|夏'

  return { xnm: `${startYear}-${startYear + 1}`, xqm }
}

function checkResponse(response: ZjuResponse): void {
  if (
    (response.status >= 300 && response.status < 400) ||
    new URL(response.url).origin !== new URL(BASE).origin
  ) {
    reset()
    throw new Error('未登录')
  }

  if (!response.ok) throw new Error('教务请求失败')
}

async function ensureLogin(): Promise<void> {
  await ensureCas().catch((error: unknown) => {
    reset()
    throw error
  })
  if (loggedIn) return

  const response = await zjuFetch(SSO_URL)
  checkResponse(response)
  loggedIn = true
}

async function post<T>(path: string, fields?: Record<string, string>): Promise<T> {
  await ensureLogin()

  const request = () => zjuFetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${BASE}/xtgl/index_initMenu.html`,
      Accept: 'application/json, text/javascript, */*; q=0.01'
    },
    body: fields === undefined ? undefined : new URLSearchParams(fields).toString()
  })

  let response = await request()
  if (response.status === 901 || response.status === 922) {
    reset()
    await ensureLogin()
    response = await request()
    if (response.status === 901 || response.status === 922) {
      reset()
      throw new Error('教务请求失败')
    }
  }

  checkResponse(response)
  const text = await response.text()
  if (text.includes('captcha_error')) throw new Error('需要验证码')

  return JSON.parse(text) as T
}

function loadSchedule(): Promise<ScheduleResponse | null> {
  return post<ScheduleResponse | null>(SCHEDULE_PATH, {
    ...currentTerm(),
    captcha_value: ''
  })
}

function courseLines(html: string): string[] {
  const match = /^(.*?)<br\s*\/?>(.*?)<br\s*\/?>(.*?)<br\s*\/?>(.*?)zwf/is.exec(html)
  if (!match) throw new Error('无法解析课表课程')

  const entities: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'"
  }

  return match.slice(1).map((line) =>
    line.replace(/<[^>]*>/g, '')
      .replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, name: string) => entities[name])
      .trim()
  )
}

function parseWeeks(
  line: string,
  dsz?: string
): Pick<CourseSession, 'weekRange' | 'weekParity'> {
  const block = /\{([^{}]+)\}/.exec(line)
  const range = block && /第\s*(\d+)\s*(?:-\s*(\d+)\s*)?周/.exec(block[1])
  const weekRange: CourseSession['weekRange'] = range
    ? [Number(range[1]), Number(range[2] ?? range[1])]
    : [1, 8]

  // 花括号中未标单双周即每周，不再用 dsz 覆盖。
  const weekParity: CourseSession['weekParity'] = block
    ? block[1].includes('单周') ? 'odd' : block[1].includes('双周') ? 'even' : 'all'
    : dsz === '0' ? 'odd' : dsz === '1' ? 'even' : 'all'

  return { weekRange, weekParity }
}

function parseExamTime(value: string): { startTime: string; endTime: string } {
  const match = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?\s*[（(]?\s*(\d{1,2})[:：](\d{2})\s*[-－—~～至]\s*(\d{1,2})[:：](\d{2})/.exec(value)
  if (!match) throw new Error('无法解析考试时间')

  const [, year, month, day, startHour, startMinute, endHour, endMinute] = match
  const pad = (part: string): string => part.padStart(2, '0')
  const date = `${year}-${pad(month)}-${pad(day)}`

  return {
    startTime: new Date(`${date}T${pad(startHour)}:${startMinute}:00+08:00`).toISOString(),
    endTime: new Date(`${date}T${pad(endHour)}:${endMinute}:00+08:00`).toISOString()
  }
}

export async function fetchSchedule(): Promise<DataResult<CourseSession[]>> {
  const result = await loadSchedule()
  if (result === null) return live([])

  const data = result.kbList.map((row, index): CourseSession => {
    const [name, semester, teacher, location] = courseLines(row.kcb)
    const startPeriod = Number(row.djj)

    return {
      id: `zdbk-course-${index}`,
      name: name.replace(/\(/g, '（').replace(/\)/g, '）'),
      teacher,
      location,
      weekday: Number(row.xqj),
      startPeriod,
      endPeriod: startPeriod + Number(row.skcd) - 1,
      semesterPart: row.xxq,
      ...parseWeeks(semester, row.dsz)
    }
  })

  return live(data)
}

export async function fetchExams(): Promise<DataResult<Exam[]>> {
  const result = await post<ExamResponse>(EXAMS_PATH)
  const exams: Exam[] = []

  function add(
    row: ExamRow,
    id: string,
    time: string,
    location: string,
    seat?: string
  ): void {
    exams.push({
      id,
      courseName: row.kcmc,
      ...parseExamTime(time),
      location,
      seat
    })
  }

  result.items.forEach((row, index) => {
    if (row.qzkssj) {
      add(row, `zdbk-exam-${index}-midterm`, row.qzkssj, row.qzjsmc, row.qzzwxh)
    }
    if (row.kssj) {
      add(row, `zdbk-exam-${index}-final`, row.kssj, row.jsmc, row.zwxh)
    }
  })

  return live(exams)
}

export async function fetchProfile(): Promise<DataResult<UserProfile>> {
  const result = await loadSchedule()
  if (result === null) throw new Error('教务个人信息为空')

  return live({
    studentId: result.xsxx.XH,
    name: result.xsxx.XM
  })
}
