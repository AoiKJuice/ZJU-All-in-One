import { useCallback, useRef, useState, type RefObject } from 'react'

// 三块面板之间的分隔：看不见的空隙，悬停或拖动时中间出现一道短把手；双击回到默认。比例记在本机

const STORE = 'xk-layout'
const DEFAULT = { left: 0.53, top: 0.5 }
const LIMIT = { left: [0.3, 0.72], top: [0.22, 0.78] } as const

type Split = typeof DEFAULT

const clamp = (k: keyof Split, v: number): number => Math.min(LIMIT[k][1], Math.max(LIMIT[k][0], v))

function load(): Split {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Split> | null
    if (saved) return { left: clamp('left', saved.left ?? DEFAULT.left), top: clamp('top', saved.top ?? DEFAULT.top) }
  } catch {
    // 读不到就用默认
  }
  return DEFAULT
}

export function useSplit() {
  const [split, setSplit] = useState<Split>(load)
  const latest = useRef(split)
  latest.current = split
  const set = useCallback((patch: Partial<Split>) => {
    setSplit((s) => {
      const next = { ...s }
      for (const k of Object.keys(patch) as (keyof Split)[]) next[k] = clamp(k, patch[k]!)
      return next
    })
  }, [])
  const save = useCallback(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(latest.current))
    } catch {
      // 存不了不影响使用
    }
  }, [])
  const reset = useCallback(
    (k: keyof Split) => {
      setSplit((s) => {
        const next = { ...s, [k]: DEFAULT[k] }
        latest.current = next
        save()
        return next
      })
    },
    [save]
  )
  return { ...split, set, save, reset }
}

/** axis x：左右分（比例按容器宽度）；y：上下分 */
export function Splitter({
  axis,
  container,
  onMove,
  onEnd,
  onReset
}: {
  axis: 'x' | 'y'
  container: RefObject<HTMLElement | null>
  onMove: (fraction: number) => void
  onEnd: () => void
  onReset: () => void
}) {
  const [drag, setDrag] = useState(false)
  return (
    <div
      className="xk-split"
      data-axis={axis}
      data-drag={drag || undefined}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        setDrag(true)
      }}
      onPointerMove={(e) => {
        if (!drag || !container.current) return
        const r = container.current.getBoundingClientRect()
        onMove(axis === 'x' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height)
      }}
      onPointerUp={(e) => {
        if (!drag) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        setDrag(false)
        onEnd()
      }}
      onPointerCancel={() => {
        setDrag(false)
        onEnd()
      }}
    />
  )
}
