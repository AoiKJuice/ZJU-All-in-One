import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import type { PlaybackSource } from '@shared/types'

const SPEEDS = [1, 1.25, 1.5, 2]

const clock = (sec: number): string => {
  if (!Number.isFinite(sec)) return '0:00'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

interface Props {
  source: PlaybackSource
  onError: (message: string) => void
  /** 铺满窗口 */
  expanded: boolean
  onToggleExpand: () => void
  /** 叠在画面上的内容（字幕） */
  children?: ReactNode
}

/**
 * 播放器：自绘安静的控制条。
 * 回放：播放/暂停、进度、时间、音量、倍速、铺满、全屏。
 * 直播（hls）：不允许暂停与拖动，只有音量、铺满、全屏；被暂停时立即恢复播放。
 */
export const Player = forwardRef<HTMLVideoElement | null, Props>(function Player({ source, onError, expanded, onToggleExpand, children }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  useImperativeHandle(ref, () => video.current!, [])
  const live = source.kind === 'hls'

  const [paused, setPaused] = useState(true)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [speed, setSpeed] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [idle, setIdle] = useState(false)

  // 加载源：mp4 直接给 <video>；直播 m3u8 用 hls.js（Chromium 不原生支持 HLS）
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
      v.removeAttribute('src')
      v.load()
    }
  }, [source, onError])

  // 同步媒体状态；直播被暂停（媒体键、系统等）时立刻恢复
  useEffect(() => {
    const v = video.current!
    const sync = (): void => {
      setPaused(v.paused)
      setTime(v.currentTime)
      setDuration(v.duration)
      setMuted(v.muted)
      setVolume(v.volume)
    }
    const onPause = (): void => {
      if (live) void v.play().catch(() => {})
      sync()
    }
    const events = ['play', 'timeupdate', 'durationchange', 'volumechange', 'loadedmetadata'] as const
    events.forEach((e) => v.addEventListener(e, sync))
    v.addEventListener('pause', onPause)
    return () => {
      events.forEach((e) => v.removeEventListener(e, sync))
      v.removeEventListener('pause', onPause)
    }
  }, [live])

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // 播放中鼠标静止 2.5 秒隐藏控制条
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const wake = (): void => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), 2500)
  }
  useEffect(() => () => clearTimeout(idleTimer.current), [])

  const toggle = (): void => {
    const v = video.current!
    if (live) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }

  // 回放快捷键：空格播放/暂停，←/→ 前后 5 秒（输入框中不响应）
  useEffect(() => {
    if (live) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      const v = video.current
      if (!v) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowRight' && e.altKey === false && (e.target as HTMLElement).closest('.player')) {
        v.currentTime = Math.min(v.duration, v.currentTime + 5)
      } else if (e.key === 'ArrowLeft' && (e.target as HTMLElement).closest('.player')) {
        v.currentTime = Math.max(0, v.currentTime - 5)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [live])

  const fullscreenToggle = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void box.current?.requestFullscreen()
  }

  const setVol = (value: number): void => {
    const v = video.current!
    v.volume = value
    v.muted = value === 0
  }

  return (
    <div
      ref={box}
      className="player"
      data-expanded={expanded || undefined}
      data-idle={(idle && !paused) || undefined}
      tabIndex={-1}
      onMouseMove={wake}
      onMouseLeave={() => setIdle(true)}
    >
      {/* 单击播放/暂停，双击全屏，右键铺满 / 还原 */}
      <video
        ref={video}
        preload="metadata"
        playsInline
        onClick={toggle}
        onDoubleClick={fullscreenToggle}
        onContextMenu={(e) => {
          e.preventDefault()
          onToggleExpand()
        }}
      />
      {children}
      <div className="player-bar" onMouseMove={wake}>
        {live ? (
          <span className="live-mark">直播</span>
        ) : (
          <>
            <button onClick={toggle}>{paused ? '播放' : '暂停'}</button>
            <input
              className="player-seek"
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={time}
              style={{ ['--p' as string]: duration ? `${(time / duration) * 100}%` : '0%' }}
              onChange={(e) => {
                video.current!.currentTime = Number(e.target.value)
              }}
            />
            <span className="player-time">
              {clock(time)} / {clock(duration)}
            </span>
          </>
        )}
        <span className="player-spacer" />
        <button onClick={() => setVol(muted || volume === 0 ? 1 : 0)}>{muted || volume === 0 ? '静音' : '声音'}</button>
        <input
          className="player-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          style={{ ['--p' as string]: `${(muted ? 0 : volume) * 100}%` }}
          onChange={(e) => setVol(Number(e.target.value))}
        />
        {!live && (
          <button
            onClick={() => {
              const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
              video.current!.playbackRate = next
              setSpeed(next)
            }}
          >
            {speed}×
          </button>
        )}
        <button onClick={onToggleExpand}>{expanded ? '还原' : '铺满'}</button>
        <button onClick={fullscreenToggle}>{fullscreen ? '退出全屏' : '全屏'}</button>
      </div>
    </div>
  )
})
