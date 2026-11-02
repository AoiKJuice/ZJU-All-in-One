import type { ClsComment, ClsTeacher } from '@shared/xk'
import { zjuFetch } from '../http'
import { readConfig, writeConfig } from '../secure'

// 查老师（chalaoshi.de）：站点没有搜索接口，首页搜索是下载 /static/json/search.json（约 1MB，一万多位教师）在本地过滤，
// 所以这里同样缓存索引（7 天，只留 id / 姓名 / 学院 / 热度，存 userData/chalaoshi-index.json，安卓端存 localStorage）、本地按姓名找人；
// 详情 /teacher/{id}/ 与评论 api.chalaoshi.de/comments/{id}?sort=rate|time 是 HTML，按结构解析。
// 结构参考 campus-agent 的 core/zju/lib/chalaoshi（2026-09 实测），已对照真实页面核对。
// 国内直连被墙：请求经 zjuFetch（跟随系统代理；安卓端走原生请求），不通时界面只显示教师名。只读，不实现评分与评论（需极验验证码）。
// 礼仪：小站单人维护，详情按需取并在内存里缓存，不遍历。

const SITE = 'https://chalaoshi.de'
const API = 'https://api.chalaoshi.de'
const INDEX_FILE = 'chalaoshi-index.json'
const INDEX_TTL = 7 * 24 * 3600_000

interface IndexTeacher {
  id: number
  name: string
  xy: number
  hot: number
}

interface Index {
  at: number
  colleges: { id: number; name: string }[]
  teachers: IndexTeacher[]
}

let index: Promise<Index> | undefined
const details = new Map<number, Promise<ClsTeacher>>()

async function get(url: string): Promise<string> {
  const response = await zjuFetch(url, { relogin: false })
  if (response.status !== 200) throw new Error(`查老师请求失败（${response.status}）`)
  return response.text()
}

function loadIndex(): Promise<Index> {
  index ??= (async () => {
    const cached = readConfig<Index>(INDEX_FILE)
    if (cached?.at && Date.now() - cached.at < INDEX_TTL) return cached
    const raw = JSON.parse(await get(`${SITE}/static/json/search.json`)) as { colleges: Index['colleges']; teachers: IndexTeacher[] }
    const fresh: Index = {
      at: Date.now(),
      colleges: raw.colleges.map(({ id, name }) => ({ id, name })),
      teachers: raw.teachers.map(({ id, name, xy, hot }) => ({ id, name, xy, hot }))
    }
    await writeConfig(INDEX_FILE, fresh)
    return fresh
  })().catch((error: unknown) => {
    index = undefined
    throw error
  })
  return index
}

const decode = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .trim()

function parseTeacher(id: number, html: string): ClsTeacher {
  const left = /<div class="teacher">[\s\S]*?<div class="left">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
  const ps = [...left.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, '')))
  const right = /<div class="right">\s*<h2>([^<]*)<\/h2>\s*<p>(\d+)人参与评分/.exec(html)
  const rating = Number(right?.[1])
  return {
    id,
    name: decode(/<h3>([^<]*)<\/h3>/.exec(left)?.[1] ?? ''),
    college: ps[1] ?? '',
    rating: Number.isFinite(rating) && rating > 0 ? rating : null,
    ratingCount: Number(right?.[2] ?? 0),
    rollCall: Number(/([\d.]+)%的人认为该老师会点名/.exec(html)?.[1]) || null,
    courses: [...html.matchAll(/<p class="course_name">([^<]*)<\/p>[\s\S]*?<p>([\d.]+)\/(\d+\+?)<\/p>/g)].map((m) => ({
      name: decode(m[1]),
      gpa: Number(m[2]),
      sample: m[3]
    })),
    commentCount: Number(/(\d+)个评论/.exec(html)?.[1] ?? 0),
    url: `${SITE}/teacher/${id}/`
  }
}

/** 按姓名找教师；同名时优先学院名相近的，再按热度 */
export async function findTeacher(name: string, college?: string): Promise<ClsTeacher | null> {
  const { teachers, colleges } = await loadIndex()
  const collegeName = new Map(colleges.map((c) => [c.id, c.name]))
  const same = teachers.filter((t) => t.name === name.trim())
  if (!same.length) return null
  const near = college
    ? same.filter((t) => {
        const c = collegeName.get(t.xy)
        return !!c && (c.includes(college) || college.includes(c))
      })
    : []
  const pick = (near.length ? near : same).sort((a, b) => b.hot - a.hot)[0]
  if (!details.has(pick.id)) {
    details.set(
      pick.id,
      get(`${SITE}/teacher/${pick.id}/`)
        .then((html) => parseTeacher(pick.id, html))
        .catch((error: unknown) => {
          details.delete(pick.id)
          throw error
        })
    )
  }
  return details.get(pick.id)!
}

export async function getComments(id: number, sort: 'rate' | 'time'): Promise<ClsComment[]> {
  const html = await get(`${API}/comments/${id}?sort=${sort}`)
  return [...html.matchAll(/<div class="hidden" id="comment-page">([\s\S]*?)<hr>\s*<\/div>/g)].map((m) => {
    const block = m[1]
    return {
      id: Number(/id="like_(\d+)"/.exec(block)?.[1] ?? 0),
      text: [...block.matchAll(/<div class="left">\s*<p>([\s\S]*?)<\/p>/g)]
        .map((x) => decode(x[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')))
        .join('\n'),
      likes: Number(decode(/class="\d+-count">([\s\S]*?)<\/p>/.exec(block)?.[1] ?? '0')) || 0,
      date: /发布于&nbsp;([\d.]+)/.exec(block)?.[1] ?? ''
    }
  })
}
