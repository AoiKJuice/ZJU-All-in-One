import { Capacitor, registerPlugin } from '@capacitor/core'
import { logDiagnostic } from './diagnostics'

// 安卓原生插件（android/app/src/main/java/top/aoikjuice/zjuallinone/ZjuNativePlugin.java）：
// 请求不跟随跳转、cookie 与 WebView 共用 CookieManager、凭据用 Android Keystore 加密、下载写进系统"下载"目录

export interface NativeResponse {
  status: number
  /** 小写键 */
  headers: Record<string, string>
  body?: string
  base64?: string
  /** 大响应写在缓存文件里（本机路径），读完调 release */
  file?: string
}

interface ZjuNative {
  request(options: {
    url: string
    method: string
    headers: Record<string, string>
    body?: string
    bodyBase64?: string
    binary?: boolean
  }): Promise<NativeResponse>
  release(options: { file: string }): Promise<void>
  cookies(options: { url: string }): Promise<{ value: string }>
  /** hosts 缺省时清空全部 cookie */
  clearCookies(options: { hosts?: string[] }): Promise<void>
  secureGet(options: { key: string }): Promise<{ value: string | null }>
  secureSet(options: { key: string; value: string }): Promise<void>
  secureRemove(options: { key: string }): Promise<void>
  download(options: { url: string; name: string; headers: Record<string, string> }): Promise<{ uri: string }>
  open(options: { uri: string }): Promise<void>
  immersive(options: { on: boolean }): Promise<void>
}

export const native = registerPlugin<ZjuNative>('ZjuNative')

export interface FetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
  /** 跳转到校内 http:// 地址时改走 https（与桌面端 zjuFetch 一致） */
  upgradeHttp?: true
}

export interface FetchResult {
  url: string
  status: number
  ok: boolean
  text(): Promise<string>
  json<T>(): Promise<T>
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** 逐跳请求并自己跟随跳转，记下最终地址（与桌面端 net.request 的 redirect 事件同理） */
export async function nativeFetch(url: string, init: FetchInit = {}): Promise<FetchResult> {
  let current = url
  let method = init.method ?? 'GET'
  let body = init.body
  const hops: string[] = []
  for (let hop = 0; hop < 20; hop++) {
    const at = new URL(current)
    hops.push(at.host + at.pathname)
    const response = await native.request({
      url: current,
      method,
      headers: init.headers ?? {},
      ...(typeof body === 'string' ? { body } : body ? { bodyBase64: toBase64(body) } : {})
    })
    const location = response.headers['location']
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, current)
      const upgrade = init.upgradeHttp && next.protocol === 'http:' && next.hostname.endsWith('.zju.edu.cn')
      if (upgrade) next.protocol = 'https:'
      if (upgrade || (response.status !== 307 && response.status !== 308)) {
        method = 'GET'
        body = undefined
      }
      current = next.href
      continue
    }
    const text = response.file ? await readCached(response.file) : (response.body ?? '')
    return {
      url: current,
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      text: async () => text,
      json: async <T>() => JSON.parse(text) as T
    }
  }
  // 只记主机与路径（不含票据），下次据此看是哪两站在来回跳
  logDiagnostic('redirect-loop', { hops: hops.slice(-8).join(' > ') })
  // 界面上也写出最后几跳（主机与路径，不含票据），一张截图就能看出是哪两站在来回跳
  throw new Error(`跳转次数过多：${hops.slice(-4).join(' → ')}`)
}

/** 二进制文件（预览用）：同样逐跳跟随跳转，大文件经缓存文件读回，不走 base64 字符串 */
export async function nativeBytes(url: string, headers: Record<string, string> = {}): Promise<Uint8Array> {
  let current = url.replace(/^http:\/\/([^/]*\.zju\.edu\.cn)/, 'https://$1')
  for (let hop = 0; hop < 20; hop++) {
    const response = await native.request({ url: current, method: 'GET', headers, binary: true })
    const location = response.headers['location']
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, current)
      if (next.protocol === 'http:' && next.hostname.endsWith('.zju.edu.cn')) next.protocol = 'https:'
      current = next.href
      continue
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`读取失败（${response.status}）`)
    if (response.file) {
      const file = response.file
      try {
        return new Uint8Array(await (await fetch(Capacitor.convertFileSrc(file))).arrayBuffer())
      } finally {
        void native.release({ file })
      }
    }
    return Uint8Array.from(atob(response.base64 ?? ''), (c) => c.charCodeAt(0))
  }
  throw new Error('跳转次数过多')
}

async function readCached(file: string): Promise<string> {
  try {
    return await (await fetch(Capacitor.convertFileSrc(file))).text()
  } finally {
    void native.release({ file })
  }
}

/** "a=1; b=2" → [{ name, value }] */
export async function cookiesFor(url: string): Promise<{ name: string; value: string }[]> {
  const { value } = await native.cookies({ url })
  return value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf('=')
      return at < 0 ? { name: part, value: '' } : { name: part.slice(0, at), value: part.slice(at + 1) }
    })
}
