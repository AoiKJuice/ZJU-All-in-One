// 生成「校园资讯」官网来源表：学校名录 → 学院中文网（语言选择页跳到中文入口）→ 栏目 → 按规则筛选。
// 用法：node scripts/news-sources.mjs  （Node ≥ 23.6，直接加载 .ts 解析器）
// 输出：src/main/services/newsSources.ts（保留的栏目，带依据）与 docs/research/campus-news-columns.json（全部候选及取舍原因）
// 部处来源（及爬不到的学院补缺）不爬，手工整理在 docs/research/news-manual.json（带依据），这里只核对能否打开、最近更新时间。
// 只读公开页面；不带任何账号信息。

import { readFile, writeFile } from 'node:fs/promises'
import { parseList, links, isColumnUrl, entryLinks, charsetOf } from '../src/main/services/newsWebplus.ts'

const ROOT = new URL('..', import.meta.url)
const DIRECTORY = 'https://www.zju.edu.cn/xywxw/list.htm'
const STALE_DAYS = 400
const DUP_RATIO = 0.8
const RECENT = 15

/** 名录里没有或名录地址不对的单位（用户列出的已知缺口） */
const EXTRA = [
  { org: '竺可桢学院', url: 'http://ckc.zju.edu.cn/', kind: 'college' },
  { org: '求是学院', url: 'http://qsxy.zju.edu.cn/', kind: 'college' },
  { org: '求是学院丹阳青溪学园', url: 'https://dqxy.zju.edu.cn/', kind: 'college' },
  { org: '求是学院紫云碧峰学园', url: 'http://yunfeng.zju.edu.cn/on/', kind: 'college' },
  { org: '求是学院蓝田学园', url: 'http://lantian.zju.edu.cn/ltoffice/', kind: 'college' },
  { org: '工程师学院', url: 'https://pi.zju.edu.cn/', kind: 'college' },
  { org: '海宁国际校区', url: 'https://www.intl.zju.edu.cn/', kind: 'campus' }
]

// ---- 栏目取舍规则（依据写进输出） ----
const KEEP = /通知|公告|公示|预告|奖励|荣誉|学籍|选课|考试|创新创业|教务|教学|评奖|评优|奖助|资助|奖学金|助学|就业|实习|学工|学生|本科|研究生|学术报告|报告会|讲座|学术活动|论坛|竞赛|第二课堂|培养|重要提示|重点提示|办事指南|招聘信息|选调|心理|活动/
const DROP = /培养方案|教学成果|成果|教学研究|教改|文件资料|资料|出国|出境|系友|院友|浙江大学|办事指南|流程|人事|招聘|师资|博士后|校友|工会|科研|学科建设|党务|党建|纪检|新闻|动态|风采|招生|下载|教工|离退休|采购|招标|简介|概况|领导|机构|沿革|联系|名录|学者|视频|图片|媒体|专题|宣传|年鉴|会议纪要|制度|文件|规章|English/i
/** 挂在学生名下的仍保留（「学生党建」「学生就业」） */
const STUDENT = /学生/
// 「招聘信息」是给学生的就业招聘，与师资「人才招聘」区分：名称含「招聘」且上级或本名含就业 / 学生时保留
const audienceOf = (names) => {
  const s = names.join(' ')
  if (/研究生|博士生|硕士/.test(s)) return 'grad'
  if (/本科/.test(s)) return 'undergrad'
  return 'all'
}

function classify(name, parents) {
  const all = [...parents, name].join(' / ')
  if (STUDENT.test(name) || (/招聘/.test(name) && /就业|学生/.test(all))) return { keep: true, why: `名称含「${name.match(/学生|招聘/)[0]}」，挂在学生名下` }
  const drop = DROP.exec(name) ?? (parents.some((p) => DROP.test(p) && !STUDENT.test(p)) ? DROP.exec(parents.find((p) => DROP.test(p))) : null)
  if (drop) return { keep: false, why: `名称或上级含「${drop[0]}」` }
  const keep = KEEP.exec(name)
  if (keep) return { keep: true, why: `名称含「${keep[0]}」` }
  return { keep: false, why: '名称不属通知 / 教务 / 评奖 / 资助 / 就业 / 讲座类' }
}

// ---- 抓取 ----
async function get(url) {
  const ctrl = AbortSignal.timeout(20000)
  const res = await fetch(url, { signal: ctrl, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36', Accept: 'text/html,*/*' } })
  const buf = new Uint8Array(await res.arrayBuffer())
  const head = new TextDecoder('latin1').decode(buf.slice(0, 2048))
  const type = res.headers.get('content-type') ?? ''
  const cs = /charset=([\w-]+)/i.exec(type)?.[1]?.toLowerCase() ?? charsetOf(head)
  let html
  try {
    html = new TextDecoder(cs).decode(buf)
  } catch {
    html = new TextDecoder().decode(buf)
  }
  return { url: res.url, status: res.status, html, charset: cs }
}

async function pool(items, size, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) {
      const k = i++
      try {
        out[k] = await fn(items[k], k)
      } catch (e) {
        out[k] = { error: String(e?.cause?.code ?? e?.message ?? e) }
      }
    }
  }))
  return out
}

const daysAgo = (date) => (date ? Math.floor((Date.now() - Date.parse(date)) / 86400000) : Infinity)
const STUDENTISH = /人才培养|学生|本科|研究生|教学|教务|通知|公告|学工|就业|讲座|学术/

const columnKey = (u) => u.replace(/list\d*\.(htm|psp)(\?.*)?$/i, 'list.htm')

async function columnsOf(site) {
  // 入口页（中文网 / 办公网 / English）跟进中文网与办公网，各自的栏目都收
  let homes = [await get(site.url)]
  for (let depth = 0; depth < 2; depth++) {
    const next = []
    for (const h of homes) {
      const entries = entryLinks(h.html, h.url)
      if (!entries.length) next.push(h)
      else for (const u of entries.slice(0, 3)) next.push(await get(u).catch(() => null))
    }
    homes = next.filter(Boolean)
  }
  const roots = homes.map((h) => new URL(h.url))
  // 子路径站点（如 lantian.zju.edu.cn/ltoffice/）只收子路径下的栏目
  const inSite = (u) => {
    const x = new URL(u)
    return roots.some((r) => {
      const prefix = r.pathname.replace(/[^/]*$/, '')
      return x.host === r.host && x.pathname.startsWith(prefix)
    })
  }
  const home = homes[0] ?? { url: site.url, charset: null }
  const queue = new Map()
  for (const h of homes) for (const l of links(h.html, h.url)) if (isColumnUrl(l.url) && inSite(l.url)) queue.set(columnKey(l.url), l.name)
  const seen = new Map()
  const visit = async (url, hint) => {
    if (seen.has(url) || seen.size >= 90) return
    seen.set(url, null)
    const page = await get(url)
    const parsed = parseList(page.html, page.url)
    const name = parsed.column && parsed.column.length <= 20 && !/更多|more|浙江大学/i.test(parsed.column) ? parsed.column : hint
    seen.set(url, { url, name, parents: parsed.parents, entries: parsed.entries, charset: page.charset })
    if (STUDENTISH.test([...parsed.parents, name].join(' '))) {
      for (const l of links(page.html, page.url)) {
        const u = columnKey(l.url)
        if (isColumnUrl(l.url) && inSite(l.url) && !seen.has(u) && !queue.has(u)) queue.set(u, l.name)
      }
    }
  }
  while (queue.size) {
    const batch = [...queue.entries()]
    queue.clear()
    await pool(batch, 4, ([u, n]) => visit(u, /更多|more|>>/i.test(n) ? null : n))
  }
  return { home: home.url, charset: home.charset, columns: [...seen.values()].filter(Boolean) }
}

function select(site, columns) {
  const decided = columns.map((c) => {
    const name = c.name ?? '(无名栏目)'
    const latest = c.entries.map((e) => e.date).filter(Boolean).sort().at(-1) ?? null
    let { keep, why } = classify(name, c.parents)
    if (keep && c.entries.length === 0) [keep, why] = [false, '列表页没有可解析的条目']
    if (keep && daysAgo(latest) > STALE_DAYS) [keep, why] = [false, `${STALE_DAYS} 天未更新（最近 ${latest ?? '无日期'}）`]
    return { ...c, name, latest, keep, why }
  })
  // 近期条目八成以上与已保留栏目重复的去掉：条目多的（汇总栏目）先留
  const kept = decided.filter((c) => c.keep).sort((a, b) => b.entries.length - a.entries.length)
  const taken = new Set()
  for (const c of kept) {
    const recent = c.entries.slice(0, RECENT).map((e) => e.url)
    const dup = recent.filter((u) => taken.has(u)).length
    if (recent.length && dup / recent.length >= DUP_RATIO) {
      c.keep = false
      c.why = `近期条目 ${dup}/${recent.length} 与其他栏目重复`
    } else recent.forEach((u) => taken.add(u))
  }
  return decided
}

/** 审计记录：保留的栏目逐条写依据，去掉的按原因归并成栏目名列表 */
export function compact(site) {
  const dropped = {}
  for (const c of site.columns.filter((x) => !x.keep)) {
    const why = c.why.replace(/「[^」]*」/, '「…」').replace(/（最近[^）]*）/, '').replace(/\d+\/\d+/, 'n')
    ;(dropped[why] ??= []).push(c.name)
  }
  return {
    org: site.org,
    url: site.url,
    home: site.home,
    kept: site.columns.filter((x) => x.keep).map((c) => ({ column: c.name, url: c.url, basis: c.why, count: c.count, latest: c.latest })),
    dropped: Object.fromEntries(Object.entries(dropped).map(([k, v]) => [k, [...new Set(v)]]))
  }
}

async function main() {
  const dir = await get(DIRECTORY)
  const colleges = [...dir.html.matchAll(/title\s*:\s*'([^']*)'[\s,]*link\s*:\s*'([^']*)'/g)]
    .map((m) => ({ org: m[1], url: m[2], kind: 'college' }))
    .filter((c) => /^https?:/.test(c.url))
  const sites = [...colleges, ...EXTRA.filter((e) => !colleges.some((c) => c.org === e.org))]
  console.log(`名录 ${colleges.length} 个学院（系），另加 ${sites.length - colleges.length} 个`)

  const report = []
  const kept = []
  const results = await pool(sites, 5, async (site) => {
    const r = await columnsOf(site)
    const decided = select(site, r.columns)
    console.log(`${site.org}  ${decided.filter((c) => c.keep).length}/${decided.length}`)
    return { site, ...r, decided }
  })
  results.forEach((r, i) => {
    const site = sites[i]
    if (!r || r.error) {
      report.push({ org: site.org, url: site.url, error: r?.error ?? '无结果' })
      console.log(`${site.org}  打不开：${r?.error}`)
      return
    }
    report.push(compact({ org: site.org, url: site.url, home: r.home, columns: r.decided.map(({ entries, ...c }) => ({ ...c, count: entries.length })) }))
    const keptCols = r.decided.filter((x) => x.keep)
    // 同一单位里重名的栏目（几个「最新通知」）带上上级栏目名区分
    const count = (n) => keptCols.filter((x) => x.name === n).length
    for (const c of keptCols) {
      const label = count(c.name) > 1 && c.parents.length ? `${c.parents.at(-1)} · ${c.name}` : c.name
      kept.push({
        id: new URL(c.url).host.replace(/\.zju\.edu\.cn$/, '').replace(/^www\./, '') + new URL(c.url).pathname.replace(/\/list\d*\.(htm|psp)$/, '').replace(/[^\w]+/g, '-'),
        org: site.org,
        kind: site.kind,
        column: label,
        url: c.url,
        audience: audienceOf([...c.parents, c.name]),
        basis: c.why,
        updated: c.latest
      })
    }
  })

  // 部处（手工整理）：核对能否打开与最近更新
  const offices = JSON.parse(await readFile(new URL('docs/research/news-manual.json', ROOT), 'utf8'))
  const checked = await pool(offices, 4, async (o) => {
    const page = await get(o.url)
    const parsed = parseList(page.html, page.url)
    const latest = parsed.entries.map((e) => e.date).filter(Boolean).sort().at(-1) ?? null
    return { ...o, count: parsed.entries.length, updated: latest }
  })
  checked.forEach((o, i) => {
    const src = offices[i]
    if (!o || o.error || !o.count) {
      report.push({ org: src.org, url: src.url, error: o?.error ?? '列表页没有可解析的条目' })
      console.log(`部处 ${src.org} ${src.column} 不可用：${o?.error ?? '无条目'}`)
      return
    }
    kept.push({ id: src.id, org: src.org, kind: src.kind ?? 'office', column: src.column, url: src.url, audience: src.audience, basis: src.basis, updated: o.updated })
  })

  const ids = new Set()
  for (const k of kept) {
    while (ids.has(k.id)) k.id += '_'
    ids.add(k.id)
  }

  const ts = `// 由 scripts/news-sources.mjs 生成（${new Date().toISOString().slice(0, 10)}），勿手改；取舍依据见 docs/research/campus-news.md 与 campus-news-columns.json
import type { WebSource } from '@shared/news'

export const WEB_SOURCES: WebSource[] = [
${kept.map((k) => '  ' + JSON.stringify(k)).join(',\n')}
]
`
  await writeFile(new URL('src/main/services/newsSources.ts', ROOT), ts)
  await writeFile(new URL('docs/research/campus-news-columns.json', ROOT), JSON.stringify(report, null, 1))
  console.log(`保留 ${kept.length} 个栏目`)
}

if (!process.env.NEWS_SOURCES_NO_RUN) await main()
