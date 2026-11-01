import { hasCasCookie } from './zjuam'
import { logDiagnostic } from './diagnostics'
import { nativeFetch, type FetchResult } from './native'

// 安卓端的 src/main/http.ts：接口一致，请求经原生插件发出

export interface ZjuFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
  relogin?: false
  upgradeHttp?: true
}

export type ZjuResponse = FetchResult

let onExpired: (() => Promise<boolean>) | undefined

export function onCasExpired(handler: () => Promise<boolean>): void {
  onExpired = handler
}

const landedOnCasLogin = (url: string): boolean => {
  const u = new URL(url)
  return u.hostname === 'zjuam.zju.edu.cn' && u.pathname.startsWith('/cas/login')
}

export async function zjuFetch(url: string, init: ZjuFetchInit = {}): Promise<ZjuResponse> {
  const response = await nativeFetch(url, init)
  if (init.relogin === false || !onExpired || !landedOnCasLogin(response.url) || landedOnCasLogin(url)) return response
  logDiagnostic('cas-expired', { host: new URL(url).hostname })
  return (await onExpired()) ? nativeFetch(url, init) : response
}

export async function ensureCas(): Promise<void> {
  if (await hasCasCookie()) return
  logDiagnostic('cas-expired', { host: 'cookie-missing' })
  if (onExpired && (await onExpired())) return
  throw new Error('未登录')
}
