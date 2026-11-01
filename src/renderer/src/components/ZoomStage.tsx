import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

interface Props {
  src: string
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  onContextMenu: (e: MouseEvent) => void
}

type Point = { x: number; y: number }

const MAX = 5
// 单指横滑超过这个距离才翻页
const SWIPE = 56

/**
 * 课件大图的触屏手势：双指缩放（以两指中点为中心）、放大后单指拖动、双击放大 / 复原，
 * 未放大时单指左右滑动翻页。只处理触屏指针，鼠标照旧（点击、右键菜单）。
 * 变换直接写在 img 的 style 上，不经 React 重渲染
 */
export function ZoomStage({ src, canPrev, canNext, onPrev, onNext, onContextMenu }: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const view = useRef({ scale: 1, x: 0, y: 0 })
  const points = useRef(new Map<number, Point>())
  const start = useRef<{ view: { scale: number; x: number; y: number }; a: Point; b?: Point } | null>(null)
  const lastTap = useRef<{ t: number; p: Point } | null>(null)
  // 翻页方向：新图从这一侧滑入
  const entering = useRef(0)

  const apply = (animate: boolean): void => {
    const el = img.current
    if (!el) return
    const { scale, x, y } = view.current
    el.style.transition = animate ? 'transform calc(0.32s * var(--speed, 1)) cubic-bezier(0.22, 1, 0.36, 1), opacity calc(0.32s * var(--speed, 1))' : 'none'
    el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
    // 放大后由这里处理单指拖动；未放大时竖向滑动交给页面滚动
    stage.current!.style.touchAction = scale > 1 ? 'none' : 'pan-y'
  }

  // 放大后拖动不超出图片范围
  const clamp = (): void => {
    const box = stage.current!.getBoundingClientRect()
    const v = view.current
    const mx = ((v.scale - 1) * box.width) / 2
    const my = ((v.scale - 1) * box.height) / 2
    v.x = Math.max(-mx, Math.min(mx, v.x))
    v.y = Math.max(-my, Math.min(my, v.y))
  }

  useEffect(() => {
    const el = img.current
    if (!el) return
    const dir = entering.current
    entering.current = 0
    view.current = { scale: 1, x: dir * 48, y: 0 }
    el.style.opacity = dir ? '0' : '1'
    apply(false)
    if (!dir) return
    const id = requestAnimationFrame(() => {
      view.current.x = 0
      el.style.opacity = '1'
      apply(true)
    })
    return () => cancelAnimationFrame(id)
  }, [src])

  // 相对舞台中心的坐标
  const local = (e: { clientX: number; clientY: number }): Point => {
    const box = stage.current!.getBoundingClientRect()
    return { x: e.clientX - box.left - box.width / 2, y: e.clientY - box.top - box.height / 2 }
  }

  const begin = (): void => {
    const [a, b] = [...points.current.values()]
    start.current = { view: { ...view.current }, a, b }
  }

  const zoomAt = (p: Point, scale: number): void => {
    const v = view.current
    v.x = p.x - (scale * (p.x - v.x)) / v.scale
    v.y = p.y - (scale * (p.y - v.y)) / v.scale
    v.scale = scale
  }

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    points.current.set(e.pointerId, local(e))
    if (points.current.size > 2) return
    begin()
  }

  const onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || !points.current.has(e.pointerId)) return
    points.current.set(e.pointerId, local(e))
    const s = start.current
    if (!s) return
    const v = view.current
    if (s.b && points.current.size >= 2) {
      const [a, b] = [...points.current.values()]
      const d0 = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) || 1
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      const m0 = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      // 两指中点下的那一点跟着手指走
      v.scale = Math.max(0.8, Math.min(MAX, (s.view.scale * d) / d0))
      v.x = m.x - (v.scale * (m0.x - s.view.x)) / s.view.scale
      v.y = m.y - (v.scale * (m0.y - s.view.y)) / s.view.scale
      apply(false)
      return
    }
    const p = points.current.get(e.pointerId)!
    const dx = p.x - s.a.x
    const dy = p.y - s.a.y
    if (s.view.scale > 1) {
      v.x = s.view.x + dx
      v.y = s.view.y + dy
      clamp()
    } else {
      // 横滑翻页：图片跟手，没有上一页 / 下一页时阻尼
      v.x = (dx > 0 ? canPrev : canNext) ? dx : dx / 4
      v.y = 0
    }
    apply(false)
  }

  const onUp = (e: PointerEvent): void => {
    if (!points.current.delete(e.pointerId)) return
    const s = start.current
    const v = view.current
    // 还剩一根手指：从当前状态接着拖
    if (points.current.size > 0) {
      begin()
      return
    }
    start.current = null
    if (!s) return
    if (e.type === 'pointercancel') {
      view.current = { ...s.view }
      apply(true)
      return
    }
    if (s.b) {
      if (v.scale < 1.05) view.current = { scale: 1, x: 0, y: 0 }
      else clamp()
      apply(true)
      return
    }
    const p = local(e)
    const moved = Math.hypot(p.x - s.a.x, p.y - s.a.y)
    if (moved < 10) {
      // 双击：放大到点击处 / 复原
      const now = performance.now()
      const prev = lastTap.current
      if (prev && now - prev.t < 300 && Math.hypot(p.x - prev.p.x, p.y - prev.p.y) < 30) {
        lastTap.current = null
        if (v.scale > 1) view.current = { scale: 1, x: 0, y: 0 }
        else {
          zoomAt(p, 2.5)
          clamp()
        }
      } else lastTap.current = { t: now, p }
      apply(true)
      return
    }
    if (s.view.scale <= 1) {
      const dx = p.x - s.a.x
      if (dx < -SWIPE && canNext) {
        entering.current = 1
        onNext()
        return
      }
      if (dx > SWIPE && canPrev) {
        entering.current = -1
        onPrev()
        return
      }
      view.current = { scale: 1, x: 0, y: 0 }
    }
    apply(true)
  }

  return (
    <div
      ref={stage}
      className="slide-stage"
      onContextMenu={onContextMenu}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <img ref={img} src={src} alt="" draggable={false} />
    </div>
  )
}
