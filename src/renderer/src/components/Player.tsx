import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { PlaybackSource } from '@shared/types'

/** 回放直链交给 <video>；直播 m3u8 用 hls.js（Chromium 不原生支持 HLS） */
export const Player = forwardRef<HTMLVideoElement | null, { source: PlaybackSource; onError: (message: string) => void }>(
  function Player({ source, onError }, ref) {
    const video = useRef<HTMLVideoElement>(null)
    useImperativeHandle(ref, () => video.current!, [])

    useEffect(() => {
      const v = video.current!
      if (source.kind === 'mp4') {
        v.src = source.url
        return
      }
      let destroyed = false
      let hls: { destroy: () => void } | undefined
      void import('hls.js').then(({ default: Hls }) => {
        if (destroyed) return
        const h = new Hls({ lowLatencyMode: true })
        h.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) onError(`直播流错误：${data.details}`)
        })
        h.loadSource(source.url)
        h.attachMedia(v)
        h.on(Hls.Events.MANIFEST_PARSED, () => void v.play().catch(() => {}))
        hls = h
      })
      return () => {
        destroyed = true
        hls?.destroy()
      }
    }, [source, onError])

    return <video ref={video} controls preload="metadata" />
  }
)
