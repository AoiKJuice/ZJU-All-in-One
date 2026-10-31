import { createHash, randomUUID } from 'node:crypto'
import type { DataResult, LectureReplay, PlaybackSource, Slide, TranscriptSegment } from '@shared/types'
import { zjuSession } from '../auth/zjuam'
import { ensureCas, zjuFetch } from '../http'

const BASE_URL = 'https://classroom.zju.edu.cn'
const LOGIN_URL = 'https://tgmedia.cmc.zju.edu.cn/index.php'
// 平台自带的语音转写（字段照 zju-learning-assistant 的 get_subtitle）
const TRANSCRIPT_URL = 'https://yjapi.cmc.zju.edu.cn'
const BEIJING_OFFSET = 8 * 60 * 60 * 1000

interface CourseSession {
  course_id: string
  sub_id: string
  title: string
  sub_title: string
  lecturer_name: string
  course_begin: string
  sub_duration: string
  sub_status: number | string
  status_label: string
}

interface MonthResponse {
  code: number
  list: {
    course: CourseSession[]
  }[]
}

interface LiveResponse {
  code: number
  list: {
    sub_status: number | string
    sub_content: string
  }[]
}

interface SlidesResponse {
  code: number
  list: {
    content: string
    created_sec: number
  }[]
  total: number
}

interface PlaybackResponse {
  code: number
  data: {
    content: {
      save_playback: {
        contents: string
      }
    }
  }
}

interface TranscriptResponse {
  code: number
  list: {
    all_content: {
      begin_sec: number
      end_sec: number
      text: string
    }[]
  }[]
}

interface UserResponse {
  code: number
  message: string
  params: {
    id: string | number
    tenant_id: string | number
    phone?: string | null
  }
}

const lectureStatuses: Record<number, LectureReplay['status']> = {
  1: 'live',
  2: 'upcoming',
  3: 'generating',
  5: 'none',
  6: 'replay'
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
  await ensureCas().catch((error: unknown) => {
    reset()
    throw error
  })
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

  const response = await zjuFetch(url.toString())

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
  checkCode = true,
  baseUrl = BASE_URL
): Promise<T> {
  await ensureLogin()

  const url = new URL(path, baseUrl)
  url.search = new URLSearchParams(params).toString()

  const response = await zjuFetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Accept-Language': 'zh_cn'
    }
  })

  if (new URL(response.url).origin !== url.origin) {
    throw new Error('未登录')
  }
  if (!response.ok) throw new Error('智云请求失败')

  const result = await response.json<T>()
  if (checkCode && result.code !== 0) throw new Error('智云查询失败')
  return result
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

function replayUrl(course: CourseSession): string {
  const url = new URL('/livingpage', BASE_URL)
  url.search = new URLSearchParams({
    course_id: course.course_id,
    sub_id: course.sub_id,
    tenant_code: '112'
  }).toString()
  return url.toString()
}

export function toLecture(course: CourseSession): LectureReplay {
  const begin = Number(course.course_begin) * 1000
  const periods = course.sub_title.match(/第(\d+)(?:-(\d+))?节/)

  return {
    id: String(course.sub_id),
    courseId: String(course.course_id),
    courseName: course.title,
    title: course.sub_title,
    teacher: course.lecturer_name,
    recordedAt: new Date(begin).toISOString(),
    durationMinutes: Math.round(Number(course.sub_duration) / 60),
    url: replayUrl(course),
    status: lectureStatuses[Number(course.sub_status)] ?? 'none',
    date: new Date(begin + BEIJING_OFFSET).toISOString().slice(0, 10),
    ...(periods ? {
      startPeriod: Number(periods[1]),
      endPeriod: Number(periods[2] ?? periods[1])
    } : {})
  }
}

async function fetchMonths(months: string[]): Promise<CourseSession[]> {
  const results = await Promise.all(
    months.map(month =>
      request<MonthResponse>(
        '/courseapi/v2/course-live/get-my-course-month',
        { month }
      )
    )
  )

  return results.flatMap(month => month.list.flatMap(day => day.course))
}

export async function fetchReplays(): Promise<DataResult<LectureReplay[]>> {
  const now = new Date(Date.now() + BEIJING_OFFSET)
  const previousMonth = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - 1,
    1
  ))
  const courses = await fetchMonths([monthKey(now), monthKey(previousMonth)])

  const data = courses
    .map(toLecture)
    .filter(lecture => lecture.status === 'live' || lecture.status === 'replay')
    .sort((a, b) =>
      Number(b.status === 'live') - Number(a.status === 'live') ||
      Date.parse(b.recordedAt) - Date.parse(a.recordedAt)
    )
    .slice(0, 20)

  return { data, source: 'live', fetchedAt: Date.now() }
}

export async function fetchLectures(
  from: string,
  to: string
): Promise<LectureReplay[]> {
  const months: string[] = []
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00Z`)
  const lastMonth = to.slice(0, 7)

  while (monthKey(cursor) <= lastMonth) {
    months.push(monthKey(cursor))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }

  const courses = await fetchMonths(months)
  return courses
    .map(toLecture)
    .filter(lecture => lecture.date >= from && lecture.date <= to)
}

export async function listSlides(
  courseId: string,
  subId: string
): Promise<Slide[]> {
  const slides: Slide[] = []
  let page = 1
  let total: number
  let count = 0

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

    if (result.list.length === 0 && count < result.total) {
      throw new Error('智云课件分页不完整')
    }

    slides.push(...result.list
      .filter(slide => slide.created_sec >= 0)
      .map(slide => {
        const content = JSON.parse(slide.content) as { pptimgurl: string }
        return { imageUrl: content.pptimgurl, time: slide.created_sec }
      }))
    count += result.list.length
    total = result.total
    page++
  } while (count < total)

  return slides
}

export async function getPlaybackSource(
  courseId: string,
  subId: string
): Promise<PlaybackSource> {
  const result = await request<LiveResponse>(
    '/courseapi/v2/course-live/search-live-course-list',
    {
      all: '1',
      course_id: courseId,
      sub_id: subId,
      with_sub_data: '1',
      with_room_data: '1',
      show_all: '1',
      show_delete: '2'
    }
  )
  const course = result.list[0]
  if (!course) throw new Error('智云课次不存在')

  if (Number(course.sub_status) === 1) {
    const content = JSON.parse(course.sub_content) as {
      output: { m3u8: string }
    }
    const url = content.output.m3u8
    return {
      url: `${url}${url.includes('?') ? '&' : '?'}clientUUID=${randomUUID()}`,
      kind: 'hls'
    }
  }

  return { url: await getPlaybackUrl(courseId, subId), kind: 'mp4' }
}

export async function getPlaybackUrl(
  courseId: string,
  subId: string
): Promise<string> {
  const playback = await request<PlaybackResponse>(
    '/courseapi/v3/portal-home-setting/get-sub-info',
    { course_id: courseId, sub_id: subId }
  )
  const user = await request<UserResponse>('/userapi/v1/infosimple', {}, false)
  if (user.message !== '查询成功') throw new Error('智云查询失败')

  const original = playback.data.content.save_playback.contents
  const url = new URL(original)
  const { id, tenant_id: tenantId, phone } = user.params
  const ts = Math.floor(Date.now() / 1000)
  const reversedPhone = [...String(phone ?? '')].reverse().join('')
  const hash = createHash('md5')
    .update(`${url.pathname}${id}${tenantId}${reversedPhone}${ts}`)
    .digest('hex')

  url.searchParams.append('t', `${id}-${ts}-${hash}`)
  return url.toString()
}

/** 智云平台自带的转写；还没生成时为空数组 */
export async function getPlatformTranscript(subId: string): Promise<TranscriptSegment[]> {
  const result = await request<TranscriptResponse>(
    '/courseapi/v3/web-socket/search-trans-result',
    { sub_id: subId, format: 'json' },
    true,
    TRANSCRIPT_URL
  )

  return (result.list[0]?.all_content ?? [])
    .filter(segment => segment.text.trim())
    .map(segment => ({
      start: segment.begin_sec,
      end: segment.end_sec,
      text: segment.text.trim()
    }))
}

export function reset(): void {
  token = undefined
}
