import { useEffect, useState, type RefObject } from 'react'
import type { Slide } from '@shared/types'

/** 当前讲解页：直播取最新一页；回放取播放时间之前最近的一页。ready 变化时重新订阅播放器 */
export function useCurrentSlide(slides: Slide[] | null, video: RefObject<HTMLVideoElement | null>, live: boolean, ready: unknown): number {
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    if (!slides?.length) return
    if (live) {
      setCurrent(slides.length - 1)
      return
    }
    const v = video.current
    if (!v) return
    const update = (): void => {
      const t = v.currentTime
      let i = 0
      for (let k = 0; k < slides.length; k++) if ((slides[k].time ?? 0) <= t) i = k
      setCurrent(i)
    }
    update()
    v.addEventListener('timeupdate', update)
    v.addEventListener('seeked', update)
    return () => {
      v.removeEventListener('timeupdate', update)
      v.removeEventListener('seeked', update)
    }
  }, [slides, live, video, ready])

  return current
}
