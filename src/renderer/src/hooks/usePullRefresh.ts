import { useEffect, useState } from 'react'

// 约三格滚轮
const THRESHOLD = 300

/** 滚到顶后继续向上滚轮（即"下拉"）累积到阈值时刷新；返回 0–1 的拉动进度，1 表示已触发 */
export function usePullRefresh(onRefresh: () => void): number {
  const [pull, setPull] = useState(0)

  useEffect(() => {
    let acc = 0
    let cooling = false
    let timer: ReturnType<typeof setTimeout> | undefined

    // 鼠标下任一可滚动祖先不在顶部时，滚轮是在翻内容，不算下拉
    const atTop = (el: Element | null): boolean => {
      for (let n = el; n; n = n.parentElement) if (n.scrollTop > 0) return false
      return true
    }

    const onWheel = (e: WheelEvent): void => {
      if (cooling) return
      if (e.deltaY >= 0 || !atTop(e.target as Element)) {
        if (acc) {
          acc = 0
          setPull(0)
        }
        return
      }
      acc -= e.deltaY
      clearTimeout(timer)
      if (acc >= THRESHOLD) {
        cooling = true
        setPull(1)
        onRefresh()
        timer = setTimeout(() => {
          cooling = false
          acc = 0
          setPull(0)
        }, 900)
        return
      }
      setPull(acc / THRESHOLD)
      // 停手即回弹
      timer = setTimeout(() => {
        acc = 0
        setPull(0)
      }, 400)
    }

    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('wheel', onWheel)
      clearTimeout(timer)
    }
  }, [onRefresh])

  return pull
}
