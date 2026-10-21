import type { CourseSession, DataResult, Exam, UserProfile } from '@shared/types'
import { zjuSession } from '../auth/zjuam'

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
function currentTerm(): { xnm: string; xqm: string } {
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

function checkResponse(response: Response): void {
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
  if (loggedIn) return

  const response = await zjuSession().fetch(SSO_URL, {
    credentials: 'include',
    redirect: 'follow'
  })

  checkResponse(response)
  await response.arrayBuffer()
  loggedIn = true
}

async function post<T>(path: string, fields?: Record<string, string>): Promise<T> {
  await ensureLogin()

  const response = await zjuSession().fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${BASE}/xtgl/index_initMenu.html`,
      Accept: 'application/json, text/javascript, */*; q=0.01'
    },
    body: fields === undefined ? undefined : new URLSearchParams(fields).toString()
  })

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

  const data = result.kbList.map((row, index) => {
    const [name, , teacher, location] = courseLines(row.kcb)
    const startPeriod = Number(row.djj)

    return {
      id: `zdbk-course-${index}`,
      name: name.replace(/\(/g, '（').replace(/\)/g, '）'),
      teacher,
      location,
      weekday: Number(row.xqj),
      startPeriod,
      endPeriod: startPeriod + Number(row.skcd) - 1,
      semesterPart: row.xxq
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
