import { native, nativeFetch } from './native'

// 安卓端的 src/main/services/ptaTransport.ts：没有验证码与网页登录窗口

export interface PtaResponse<T> {
  status: number
  body: T
}

export async function request<T>(url: string, method = 'GET', body?: unknown): Promise<PtaResponse<T>> {
  const response = await nativeFetch(url, {
    method,
    headers: {
      Accept: 'application/json;charset=UTF-8',
      ...(body !== undefined ? { 'Content-Type': 'application/json;charset=UTF-8' } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  })
  const text = await response.text()
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T }
}

export async function solveCaptcha(_parent: unknown): Promise<{ ticket: string; randStr: string } | null> {
  throw new Error('PTA 要求验证码，请稍后再试')
}

export async function webLogin(_parent: unknown): Promise<void> {
  throw new Error('请用账号密码登录')
}

export async function clearCookies(): Promise<void> {
  await native.clearCookies({ hosts: ['pintia.cn', 'passport.pintia.cn'] })
}
