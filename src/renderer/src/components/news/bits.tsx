// 校园资讯界面共用的小件：日期文字、展开箭头、出处下拉
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const pad = (n: number): string => String(n).padStart(2, '0')
const WEEK = '日一二三四五六'

/** 列表上的日期：今天 / 昨天 / 11月6日 */
export function dayText(time: string | null): string {
  if (!time) return ''
  const d = new Date(time.length === 10 ? `${time}T00:00:00+08:00` : time)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / 86_400_000)
  if (diff === 0) return '今天'
  if (diff === -1) return '昨天'
  if (diff === 1) return '明天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 活动时间：11月9日 周六 18:30；零点（平台只填了日期）不写时刻 */
export function whenText(time: string | null): string {
  if (!time) return ''
  const d = new Date(time)
  const day = `${dayText(time)} 周${WEEK[d.getDay()]}`
  return d.getHours() || d.getMinutes() ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day
}

export function Chevron() {
  return (
    <svg className="news-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 10l5 5 5-5" />
    </svg>
  )
}


export interface PickOption {
  key: string
  label: string
  count: number
}

/**
 * 出处下拉：一枚浅底胶囊（「出处」+ 当前值 + 箭头），点开是一列带条数的选项，多了才有搜索框。
 * 不用一长条横向滚动的胶囊（用户明确不要）
 */
export function SourcePick({ options, total, value, onChange }: { options: PickOption[]; total: number; value: string | null; onChange: (key: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const current = options.find((o) => o.key === value)

  useLayoutEffect(() => {
    if (!open || !button.current || !panel.current) return
    const r = button.current.getBoundingClientRect()
    const w = panel.current.offsetWidth
    setAt({ left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)), top: r.bottom + 6 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    const onDown = (e: PointerEvent): void => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [open])

  const pick = (key: string | null): void => {
    onChange(key)
    setOpen(false)
    setQuery('')
  }
  const q = query.trim()
  const shown = q ? options.filter((o) => o.label.includes(q)) : options

  return (
    <>
      <button ref={button} className="news-pick" data-on={current ? true : undefined} data-open={open || undefined} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <span className="news-pick-label">出处</span>
        <span className="news-pick-value">{current?.label ?? '全部'}</span>
        <Chevron />
      </button>
      {open && (
        <div ref={panel} className="news-pop" role="listbox" style={at ?? { visibility: 'hidden', left: 0, top: 0 }}>
          {options.length > 10 && (
            <label className="news-search news-pop-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <circle cx="11" cy="11" r="6" />
                <path d="M20 20l-4.5-4.5" />
              </svg>
              <input className="field" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          )}
          <div className="news-pop-list">
            {!q && (
              <button className="news-pop-opt" role="option" aria-selected={!current} data-active={!current || undefined} onClick={() => pick(null)}>
                <span className="news-pop-name">全部</span>
                <span className="news-pop-count">{total}</span>
              </button>
            )}
            {shown.map((o) => (
              <button key={o.key} className="news-pop-opt" role="option" aria-selected={o.key === value} data-active={o.key === value || undefined} onClick={() => pick(o.key)}>
                <span className="news-pop-name">{o.label}</span>
                <span className="news-pop-count">{o.count}</span>
              </button>
            ))}
            {!shown.length && <p className="quiet news-pop-empty">无</p>}
          </div>
        </div>
      )}
    </>
  )
}
