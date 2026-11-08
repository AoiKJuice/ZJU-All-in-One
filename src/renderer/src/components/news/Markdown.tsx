import type { ReactNode } from 'react'

// 钉钉消息里的 Markdown（机器人推送、工作通知、群公告常用）：标题、粗体 / 斜体 / 删除线、行内代码与代码块、链接、图片、
// 有序 / 无序列表、引用、分隔线，以及钉钉常夹带的 <font> / <br> 标签。自己解析成 React 元素，不插 HTML，不加载外部内容：
// 图片（要登录态，地址也可能是内网）只显示成链接。单个换行照原样换行（群消息习惯这样写）

const SAFE_URL = /^(https?:|dingtalk:|mailto:)/i

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function link(href: string, children: ReactNode, key: string): ReactNode {
  const url = href.trim()
  if (!SAFE_URL.test(url)) return <span key={key}>{children}</span>
  return (
    <a key={key} href={url} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

const INLINE = /(`[^`]+`)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*|__[^_]+__)|(~~[^~]+~~)|(\*[^*\s][^*]*\*)|(https?:\/\/[^\s<>()（）]+)/

/** 行内：代码、图片、链接、粗体、删除线、斜体、裸网址 */
function inline(text: string, key = 'i'): ReactNode[] {
  const source = decode(text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
  const out: ReactNode[] = []
  let rest = source
  let n = 0
  while (rest) {
    const m = INLINE.exec(rest)
    if (!m) {
      out.push(rest)
      break
    }
    if (m.index) out.push(rest.slice(0, m.index))
    const token = m[0]
    const k = `${key}-${n++}`
    if (m[1]) out.push(<code key={k}>{token.slice(1, -1)}</code>)
    else if (m[2]) {
      const [, alt = '', href = ''] = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token) ?? []
      out.push(link(href, `[${alt || '图片'}]`, k))
    } else if (m[3]) {
      const [, label = '', href = ''] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token) ?? []
      out.push(link(href, inline(label, k), k))
    } else if (m[4]) out.push(<strong key={k}>{inline(token.slice(2, -2), k)}</strong>)
    else if (m[5]) out.push(<del key={k}>{inline(token.slice(2, -2), k)}</del>)
    else if (m[6]) out.push(<em key={k}>{inline(token.slice(1, -1), k)}</em>)
    else out.push(link(token, token, k))
    rest = rest.slice(m.index + token.length)
  }
  return out
}

/** 一段里的几行：单个换行照原样换行 */
function lines(list: string[], key: string): ReactNode[] {
  return list.flatMap((line, i) => (i ? [<br key={`${key}-br${i}`} />, ...inline(line, `${key}-${i}`)] : inline(line, `${key}-${i}`)))
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const rows = text.replace(/\r\n?/g, '\n').replace(/<br\s*\/?>/gi, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  const key = (): string => `b${blocks.length}`
  while (i < rows.length) {
    const row = rows[i]!
    // 代码块
    if (/^\s*```/.test(row)) {
      const body: string[] = []
      i++
      while (i < rows.length && !/^\s*```/.test(rows[i]!)) body.push(rows[i++]!)
      i++
      blocks.push(<pre key={key()}>{body.join('\n')}</pre>)
      continue
    }
    if (!row.trim()) {
      i++
      continue
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(row)
    if (heading) {
      const level = Math.min(heading[1]!.length + 2, 6)
      const H = `h${level}` as 'h3' | 'h4' | 'h5' | 'h6'
      blocks.push(<H key={key()}>{inline(heading[2]!.replace(/\s+#+\s*$/, ''), key())}</H>)
      i++
      continue
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(row)) {
      blocks.push(<hr key={key()} />)
      i++
      continue
    }
    if (/^\s{0,3}>/.test(row)) {
      const body: string[] = []
      while (i < rows.length && /^\s{0,3}>/.test(rows[i]!)) body.push(rows[i++]!.replace(/^\s{0,3}>\s?/, ''))
      blocks.push(<blockquote key={key()}>{lines(body, key())}</blockquote>)
      continue
    }
    const bullet = /^\s*([-*+]|\d+[.)、])\s+/
    if (bullet.test(row)) {
      const ordered = /^\s*\d/.test(row)
      const items: string[][] = []
      while (i < rows.length && rows[i]!.trim()) {
        if (bullet.test(rows[i]!)) items.push([rows[i]!.replace(bullet, '')])
        else items[items.length - 1]!.push(rows[i]!.trim())
        i++
      }
      const k = key()
      const List = ordered ? 'ol' : 'ul'
      blocks.push(
        <List key={k}>
          {items.map((it, j) => (
            <li key={j}>{lines(it, `${k}-${j}`)}</li>
          ))}
        </List>
      )
      continue
    }
    // 普通段落：到空行、标题、列表、引用、代码块为止
    const body: string[] = []
    while (i < rows.length && rows[i]!.trim() && !/^\s{0,3}(#{1,6}\s|>|```)/.test(rows[i]!) && !(body.length && bullet.test(rows[i]!))) body.push(rows[i++]!)
    blocks.push(<p key={key()}>{lines(body, key())}</p>)
  }
  return <div className={`md ${className}`}>{blocks}</div>
}
