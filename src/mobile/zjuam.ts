import { cookiesFor, native, nativeFetch } from './native'

// 安卓端的 src/main/auth/zjuam.ts：cookie 在系统 CookieManager 里（与 WebView 共用），没有网页登录窗口

export const CAS_BASE = 'https://zjuam.zju.edu.cn/cas'
const CAS_COOKIE = 'iPlanetDirectoryPro'

/** 只实现各 service 用到的部分：按地址取 cookie、普通请求、清 cookie */
export function zjuSession() {
  return {
    cookies: {
      get: async ({ url, name }: { url: string; name?: string }) =>
        (await cookiesFor(url)).filter((cookie) => name === undefined || cookie.name === name)
    },
    fetch: (url: string) => nativeFetch(url),
    clearStorageData: (_options?: unknown) => native.clearCookies({})
  }
}

export function casLoginUrl(service: string): string {
  return `${CAS_BASE}/login?service=${encodeURIComponent(service)}`
}

export async function casCookieValue(): Promise<string | undefined> {
  return (await cookiesFor(`${CAS_BASE}/login`)).find((cookie) => cookie.name === CAS_COOKIE && cookie.value)?.value
}

export async function hasCasCookie(): Promise<boolean> {
  return (await casCookieValue()) !== undefined
}

export async function login(): Promise<void> {
  throw new Error('请用账号密码登录')
}

export async function logout(): Promise<void> {
  await native.clearCookies({})
}
