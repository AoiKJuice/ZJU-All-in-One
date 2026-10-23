import { net } from 'electron'
import { zjuSession } from './auth/zjuam'

export interface ZjuFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string | Buffer
  /** false：被弹回统一身份认证登录页时不自动重登（登录流程自身的请求） */
  relogin?: false
}

export interface ZjuResponse {
  url: string
  status: number
  ok: boolean
  text(): Promise<string>
  json<T>(): Promise<T>
}

let onExpired: (() => Promise<boolean>) | undefined

/** 注册 CAS 过期时的重登回调（由 ipc.ts 接上账号密码登录，避免 http 与 auth/password 互相引用） */
export function onCasExpired(handler: () => Promise<boolean>): void {
  onExpired = handler
}

const landedOnCasLogin = (url: string): boolean => {
  const u = new URL(url)
  return u.hostname === 'zjuam.zju.edu.cn' && u.pathname.startsWith('/cas/login')
}

/** 请求经 SSO 被弹回统一身份认证登录页时，用保存的账号密码重登并重试一次 */
export async function zjuFetch(url: string, init: ZjuFetchInit = {}): Promise<ZjuResponse> {
  const response = await send(url, init)
  if (init.relogin === false || !onExpired || !landedOnCasLogin(response.url) || landedOnCasLogin(url)) return response
  return (await onExpired()) ? send(url, init) : response
}

function send(
  url: string,
  init: ZjuFetchInit
): Promise<ZjuResponse> {
  return new Promise((resolve, reject) => {
    let finalUrl = url
    const request = net.request({
      url,
      method: init.method ?? 'GET',
      session: zjuSession(),
      useSessionCookies: true,
      redirect: 'manual'
    })

    for (const [name, value] of Object.entries(init.headers ?? {})) {
      request.setHeader(name, value)
    }

    request.on('redirect', (_status, _method, redirectUrl) => {
      finalUrl = new URL(redirectUrl, finalUrl).href
      request.followRedirect()
    })

    request.on('error', reject)
    request.on('response', response => {
      const chunks: Buffer[] = []

      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('error', reject)
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        const status = response.statusCode

        // ZJU_DEBUG=1：打印每个请求的落点与响应开头，用于对照真实接口
        if (process.env['ZJU_DEBUG'] === '1') {
          console.log(`[zjuFetch] ${init.method ?? 'GET'} ${url}\n  -> ${status} ${finalUrl}\n  ${body.slice(0, 600).replace(/\s+/g, ' ')}`)
        }

        resolve({
          url: finalUrl,
          status,
          ok: status >= 200 && status < 300,
          text: async () => body,
          json: async <T>() => JSON.parse(body) as T
        })
      })
    })

    if (init.body !== undefined) request.write(init.body)
    request.end()
  })
}
