import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { zjuSession } from './auth/zjuam'

const isZju = (host: string): boolean => host === 'zju.edu.cn' || host.endsWith('.zju.edu.cn')

// 智云课件图等接口给的是 http:// 地址：页面里靠 CSP upgrade-insecure-requests 升级成 https，
// 主进程没有这层升级，用 session.fetch 请求 http 版会一直挂起不返回，所以这里先升级。
export function upgrade(url: string): string {
  const u = new URL(url)
  if (u.protocol === 'http:' && isZju(u.hostname)) u.protocol = 'https:'
  return u.href
}

// 智云的课件图、回放等资源校验 Referer；学在浙大附件靠会话 cookie
function headersFor(url: string): Record<string, string> {
  return new URL(url).hostname.endsWith('cmc.zju.edu.cn') ? { Referer: 'https://classroom.zju.edu.cn/' } : {}
}

/** 用登录会话把文件流式写到本地，不经过浏览器；30 秒等不到响应头即报错（正文传输不限时，大附件不会被掐断） */
export async function downloadToFile(url: string, filePath: string): Promise<void> {
  const target = upgrade(url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('下载超时：服务器无响应')), 30_000)
  const response = await zjuSession()
    .fetch(target, { credentials: 'include', headers: headersFor(target), signal: controller.signal })
    .finally(() => clearTimeout(timer))
  if (!response.ok || !response.body) throw new Error(`下载失败（${response.status}）`)
  await pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream), createWriteStream(filePath))
}
