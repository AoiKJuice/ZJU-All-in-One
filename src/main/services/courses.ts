import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type {
  Assignment,
  AssignmentDetail,
  Attachment,
  DataResult,
  PickedFile
} from '@shared/types'
import { hasCasCookie, zjuSession } from '../auth/zjuam'
import { zjuFetch, type ZjuFetchInit, type ZjuResponse } from '../http'

const BASE = 'https://courses.zju.edu.cn'

let loginPromise: Promise<void> | undefined
let studentId: string | undefined

interface Todo {
  id: string | number
  course_id: string | number
  type: string
  title: string
  course_name: string
  end_time: string | null
  is_student: boolean
}

interface TodosResponse {
  todo_list: Todo[]
}

interface Upload {
  id: string | number
  name: string
}

interface Activity {
  title: string
  end_time: string
  course_id: string | number
  data: {
    description: string
    homework_type: string
    mode: string
  }
  // 推测：作业附件位于顶层 uploads，每项含 id、name。
  uploads?: Upload[]
}

// 推测：提交记录含以下字段，时间为 created_at 或 submitted_at。
interface Submission {
  id: string | number
  created_at?: string
  submitted_at?: string
  comment: string
  uploads?: Upload[]
}

interface UploadResponse {
  id: string | number
  upload_url: string
  storage_type: string
  transcoder: string
}

async function request(
  url: string,
  accept: string,
  init: ZjuFetchInit = {}
): Promise<ZjuResponse> {
  const response = await zjuFetch(url, {
    ...init,
    headers: { Accept: accept, ...init.headers }
  })

  if (!response.ok) {
    const body = await response.text()
    let message = ''

    // 上传服务可能返回非 JSON 错误页，此时仍报告 HTTP 状态。
    try {
      message = (JSON.parse(body) as { message?: string })?.message ?? ''
    } catch {
      message = ''
    }

    throw new Error(
      `学在浙大请求失败（${response.status}）${message ? `：${message}` : ''}`
    )
  }

  return response
}

async function getJson<T>(path: string): Promise<T> {
  const response = await request(`${BASE}${path}`, 'application/json')

  if (new URL(response.url).origin !== BASE) {
    throw new Error('学在浙大未登录')
  }

  return response.json<T>()
}

function postJson(path: string, body: unknown): Promise<ZjuResponse> {
  return request(`${BASE}${path}`, 'application/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function metaRefreshTarget(body: string, source: string): string | undefined {
  const tags = body.matchAll(/<meta\b[^>]*>/gi)

  for (const [tag] of tags) {
    if (!/http-equiv\s*=\s*["']?refresh/i.test(tag)) continue

    const match = /url\s*=\s*["']?([^"' >;]+)/i.exec(tag)
    if (!match) continue

    const target = new URL(match[1].replaceAll('&amp;', '&'), source)
    const isZjuHost = target.hostname === 'zju.edu.cn' ||
      target.hostname.endsWith('.zju.edu.cn')

    if (target.protocol === 'https:' && isZjuHost) {
      return target.href
    }
  }

  return undefined
}

async function login(): Promise<void> {
  let url = `${BASE}/user/index`

  for (let hop = 0; hop < 15; hop++) {
    const response = await request(url, 'text/html')
    const body = await response.text()
    const target = metaRefreshTarget(body, response.url)

    // zjuFetch 只自动跟随 HTTP 跳转，不执行 HTML meta-refresh。
    if (target) {
      url = target
      continue
    }

    if (new URL(response.url).origin !== BASE) {
      throw new Error('学在浙大未登录')
    }

    const cookies = await zjuSession().cookies.get({
      url: `${BASE}/api/todos`,
      name: 'session'
    })

    if (cookies.length === 0) {
      throw new Error('学在浙大登录失败：缺少业务会话')
    }

    return
  }

  throw new Error('学在浙大登录失败：跳转次数过多')
}

export async function ensureLogin(): Promise<void> {
  if (!await hasCasCookie()) {
    reset()
    throw new Error('未登录')
  }

  if (!loginPromise) {
    loginPromise = login().catch((error: unknown) => {
      loginPromise = undefined
      throw error
    })
  }

  return loginPromise
}

export function reset(): void {
  loginPromise = undefined
  studentId = undefined
}

async function getStudentId(): Promise<string> {
  if (studentId !== undefined) return studentId

  const response = await request(`${BASE}/user/index`, 'text/html')
  const body = await response.text()
  const match = /\bglobalData\s*=\s*\{\s*["']?user["']?\s*:\s*\{[^{}]*?\b["']?id["']?\s*:\s*(\d+)\b/.exec(body)

  if (!match) throw new Error('学在浙大学生 ID 解析失败')

  studentId = match[1]
  return studentId
}

function activityUrl(courseId: string | number, activityId: string | number): string {
  return `${BASE}/course/${courseId}/learning-activity/full-screen#/${activityId}`
}

function toAttachment(upload: Upload): Attachment {
  return {
    name: upload.name,
    url: `${BASE}/api/uploads/${upload.id}/blob`
  }
}

function toAssignment(todo: Todo): Assignment {
  return {
    id: String(todo.id),
    courseId: String(todo.course_id),
    type: todo.type,
    courseName: todo.course_name,
    title: todo.title,
    deadline: new Date(todo.end_time!).toISOString(),
    // 推测：待办视为未提交，接口未提供已确认的提交状态字段。
    submitted: false,
    url: activityUrl(todo.course_id, todo.id)
  }
}

export async function fetchAssignments(): Promise<DataResult<Assignment[]>> {
  await ensureLogin()

  const { todo_list } = await getJson<TodosResponse>('/api/todos')
  const data = todo_list
    .filter((todo) => todo.is_student && todo.end_time !== null)
    .map(toAssignment)

  return {
    data,
    source: 'live',
    fetchedAt: Date.now()
  }
}

export async function getAssignmentDetail(
  activityId: string
): Promise<AssignmentDetail> {
  await ensureLogin()

  const activity = await getJson<Activity>(`/api/activities/${activityId}`)
  const userId = await getStudentId()

  // 推测：课程接口支持 fields=id,name，响应直接含 name。
  const [course, submissions] = await Promise.all([
    getJson<{ id: string | number, name: string }>(
      `/api/courses/${activity.course_id}?fields=id,name`
    ),
    getJson<{ list: Submission[] }>(
      `/api/activities/${activityId}/students/${userId}/submission_list`
    )
  ])

  return {
    id: activityId,
    title: activity.title,
    courseName: course.name,
    deadline: new Date(activity.end_time).toISOString(),
    descriptionHtml: activity.data.description,
    attachments: (activity.uploads ?? []).map(toAttachment),
    submissions: submissions.list
      .map(submission => ({
        id: String(submission.id),
        submittedAt: new Date(
          (submission.submitted_at ?? submission.created_at)!
        ).toISOString(),
        comment: submission.comment,
        files: (submission.uploads ?? []).map(toAttachment)
      }))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    url: activityUrl(activity.course_id, activityId)
  }
}

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime'
}

function multipartBody(
  name: string,
  mime: string,
  bytes: Buffer,
  boundary: string
): Buffer {
  const filename = name
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll('"', '%22')

  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ])
}

async function uploadFile(file: PickedFile): Promise<string | number> {
  const bytes = await readFile(file.path)
  const response = await postJson('/api/uploads', {
    name: file.name,
    size: bytes.length,
    parent_type: null,
    parent_id: 0,
    is_scorm: false,
    is_wmpkg: false,
    source: '',
    is_marked_attachment: false,
    embed_material_type: ''
  })
  const upload = await response.json<UploadResponse>()
  const mime = MIME_TYPES[extname(file.name).toLowerCase()] ??
    'application/octet-stream'
  const url = new URL(upload.upload_url, BASE).href

  if (upload.storage_type === 'S3' && upload.transcoder === 'WRPC') {
    await request(url, '*/*', {
      method: 'PUT',
      headers: { 'Content-Type': mime },
      body: bytes
    })
  } else {
    const boundary = `----zju-${randomUUID()}`

    await request(url, '*/*', {
      method: 'PUT',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: multipartBody(file.name, mime, bytes, boundary)
    })
  }

  return upload.id
}

export async function submitHomework(
  activityId: string,
  comment: string,
  files: PickedFile[]
): Promise<void> {
  await ensureLogin()

  const uploads: (string | number)[] = []

  for (const file of files) {
    uploads.push(await uploadFile(file))
  }

  await postJson(`/api/course/activities/${activityId}/submissions`, {
    comment,
    uploads,
    slides: [],
    is_draft: false,
    mode: 'normal',
    other_resources: [],
    uploads_in_rich_text: []
  })
}
