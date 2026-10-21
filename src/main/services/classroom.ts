import type { DataResult, LectureReplay } from '@shared/types'
import { zjuSession } from '../auth/zjuam'

const BASE_URL = 'https://classroom.zju.edu.cn'
const TRANSCRIPT_URL = 'https://yjapi.cmc.zju.edu.cn'
const LOGIN_URL = 'https://tgmedia.cmc.zju.edu.cn/index.php'

interface CourseSession {
  id: string
  sub_id: string
  title: string
  sub_title: string
  realname: string
  // 推测：月历时间为北京时间 YYYY-MM-DD HH:mm:ss
  start_at: string
  end_at: string
}

interface MonthResponse {
  code: number
  list: {
    course: CourseSession[]
  }[]
}

interface SlidesResponse {
  code: number
  list: {
    content: string
  }[]
  total: number
}

interface TranscriptResponse {
  code: number
  list: {
    all_content: {
      begin_sec: number
      text: string
    }[]
  }[]
}

let token: string | undefined

async function readToken(): Promise<string | undefined> {
  const cookies = await zjuSession().cookies.get({ url: BASE_URL })
  const cookieString = decodeURIComponent(
    cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  )

  return cookieString.match(
    /\{i:\d+;s:\d+:"_token";i:\d+;s:\d+:"(.+?)";\}/
  )?.[1]
}

export async function ensureLogin(): Promise<void> {
  if (token) return

  token = await readToken()
  if (token) return

  const url = new URL(LOGIN_URL)
  url.search = new URLSearchParams({
    r: 'auth/login',
    auType: 'cmc',
    tenant_code: '112',
    forward: `${BASE_URL}/`
  }).toString()

  const response = await zjuSession().fetch(url.toString(), {
    credentials: 'include',
    redirect: 'follow'
  })

  if (new URL(response.url).origin !== BASE_URL) {
    throw new Error('未登录')
  }
  if (!response.ok) throw new Error('智云登录失败')

  token = await readToken()
  if (!token) throw new Error('未登录')
}

async function request<T extends { code: number }>(
  path: string,
  params: Record<string, string>,
  baseUrl = BASE_URL
): Promise<T> {
  await ensureLogin()

  const url = new URL(path, baseUrl)
  url.search = new URLSearchParams(params).toString()

  const response = await zjuSession().fetch(url.toString(), {
    credentials: 'include',
    redirect: 'follow',
    headers: {
      Authorization: `Bearer ${token}`,
      'Accept-Language': 'zh_cn'
    }
  })

  if (new URL(response.url).origin !== url.origin) {
    throw new Error('未登录')
  }
  if (!response.ok) throw new Error('智云请求失败')

  const result = (await response.json()) as T
  if (result.code !== 0) throw new Error('智云查询失败')
  return result
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function parseTime(value: string): number {
  return new Date(`${value.replace(' ', 'T')}+08:00`).getTime()
}

function replayUrl(course: CourseSession): string {
  // 推测：回放页面路径及参数沿用现有实现
  const url = new URL('/livingpage', BASE_URL)
  url.search = new URLSearchParams({
    course_id: course.id,
    sub_id: course.sub_id,
    tenant_code: '112'
  }).toString()
  return url.toString()
}

export async function fetchReplays(): Promise<DataResult<LectureReplay[]>> {
  await ensureLogin()

  const now = new Date()
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const months = await Promise.all(
    [currentMonth, previousMonth].map(date =>
      request<MonthResponse>(
        '/courseapi/v2/course-live/get-my-course-month',
        { month: monthKey(date) }
      )
    )
  )

  const courses = months
    .flatMap(month => month.list.flatMap(day => day.course))
    .map(course => ({
      course,
      start: parseTime(course.start_at),
      end: parseTime(course.end_at)
    }))
    .filter(({ start, end }) => start <= now.getTime() && end <= now.getTime())
    .sort((a, b) => b.start - a.start)
    .slice(0, 20)

  const data = courses.map(({ course, start, end }) => ({
    id: course.sub_id,
    courseName: course.title,
    title: course.sub_title,
    teacher: course.realname,
    recordedAt: new Date(start).toISOString(),
    durationMinutes: Math.round((end - start) / 60_000),
    url: replayUrl(course)
  }))

  return { data, source: 'live', fetchedAt: Date.now() }
}

export async function listSlides(
  subId: string,
  courseId: string
): Promise<{ imageUrl: string }[]> {
  const slides: { imageUrl: string }[] = []
  let page = 1
  let total: number

  do {
    const result = await request<SlidesResponse>(
      '/pptnote/v1/schedule/search-ppt',
      {
        course_id: courseId,
        sub_id: subId,
        page: String(page),
        per_page: '100'
      }
    )

    slides.push(...result.list.map(slide => {
      const content = JSON.parse(slide.content) as { pptimgurl: string }
      return { imageUrl: content.pptimgurl }
    }))
    total = result.total
    page++
  } while (slides.length < total)

  return slides
}

export async function getTranscript(
  subId: string
): Promise<{ time: string; text: string }[]> {
  const result = await request<TranscriptResponse>(
    '/courseapi/v3/web-socket/search-trans-result',
    {
      sub_id: subId,
      format: 'json'
    },
    TRANSCRIPT_URL
  )

  if (result.list.length === 0) return []

  return result.list[0].all_content.map(segment => ({
    time: String(segment.begin_sec),
    text: segment.text
  }))
}

export function reset(): void {
  token = undefined
}
