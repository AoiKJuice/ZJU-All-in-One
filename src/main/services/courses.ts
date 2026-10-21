import type { Assignment, DataResult } from '@shared/types'
import { hasCasCookie, zjuSession } from '../auth/zjuam'
import { zjuFetch, type ZjuResponse } from '../http'

const BASE = 'https://courses.zju.edu.cn'

let loginPromise: Promise<void> | undefined

interface Todo {
  id: string | number
  title: string
  course_name: string
  end_time: string | null
  is_student: boolean
}

interface TodosResponse {
  todo_list: Todo[]
}

async function request(url: string, accept: string): Promise<ZjuResponse> {
  const response = await zjuFetch(url, {
    headers: { Accept: accept }
  })

  if (!response.ok) {
    throw new Error(`学在浙大请求失败（${response.status}）`)
  }

  return response
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
}

async function fetchTodos(): Promise<TodosResponse> {
  const response = await request(`${BASE}/api/todos`, 'application/json')

  if (new URL(response.url).origin !== BASE) {
    throw new Error('学在浙大未登录')
  }

  return response.json<TodosResponse>()
}

function toAssignment(todo: Todo): Assignment {
  return {
    id: String(todo.id),
    courseName: todo.course_name,
    title: todo.title,
    deadline: new Date(todo.end_time!).toISOString(),
    // 推测：待办视为未提交，接口未提供已确认的提交状态字段。
    submitted: false
  }
}

export async function fetchAssignments(): Promise<DataResult<Assignment[]>> {
  await ensureLogin()

  const { todo_list } = await fetchTodos()
  const data = todo_list
    .filter((todo) => todo.is_student && todo.end_time !== null)
    .map(toAssignment)

  return {
    data,
    source: 'live',
    fetchedAt: Date.now()
  }
}
