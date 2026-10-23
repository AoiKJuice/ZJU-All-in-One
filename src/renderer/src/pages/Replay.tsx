import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { PlaybackSource, Slide, TranscriptFormat, TranscriptSegment } from '@shared/types'
import { useApp } from '@renderer/store'
import { OutlineWord, Reveal, SectionHead } from '@renderer/components/Type'
import { dotDate } from '@renderer/lib/format'
import { Player } from '@renderer/components/Player'
import { TranscribeProgress } from '@renderer/components/TranscribeProgress'
import { LectureStrip } from '@renderer/components/LectureStrip'

const hms = (sec: number): string =>
  [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), Math.floor(sec % 60)].map((n) => String(n).padStart(2, '0')).join(':')

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

/** 回放页：左侧播放器与课件，右侧文字稿（本地 Whisper）；点时间跳转播放，课件与文字稿均可导出 */
export function Replay() {
  const replay = useApp((s) => s.replay)!
  const key = `transcribe:${replay.id}`
  const task = useApp((s) => s.tasks[key])
  const partial = useApp((s) => s.partials[key])
  const clearPartials = useApp((s) => s.clearPartials)
  const live = replay.status === 'live'
  const [slides, setSlides] = useState<Slide[] | null>(null)
  const [slidesError, setSlidesError] = useState<string | null>(null)
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [src, setSrc] = useState<PlaybackSource | null>(null)
  const [srcError, setSrcError] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // 只有停在底部时才跟随新结果；用户往上翻阅时刷新不动滚动位置
  const following = useRef(true)
  const onPlayerError = useCallback((m: string) => setSrcError(m), [])
  // 铺满：播放器占满整个窗口（不是系统全屏），Esc 还原
  const [expanded, setExpanded] = useState(false)
  // 字幕：用已有文字稿叠在画面下方
  const [captions, setCaptions] = useState(true)
  const subtitle = useRef<HTMLParagraphElement>(null)
  const title = `${replay.courseName} ${replay.title}`.trim()

  useEffect(() => {
    let active = true
    setSlides(null)
    setSegments(null)
    setSrc(null)
    setSrcError(null)
    setSlidesError(null)
    setError(null)
    window.zju['replay:playback'](replay.courseId, replay.id).then(
      (value) => { if (active) setSrc(value) },
      (e) => { if (active) setSrcError(errorText(e)) }
    )
    window.zju['replay:slides'](replay.courseId, replay.id).then(
      (value) => { if (active) setSlides(value) },
      (e) => { if (active) setSlidesError(errorText(e)) }
    )
    window.zju['replay:transcript'](replay.id).then(
      (value) => { if (active) setSegments(value) },
      (e) => { if (active) setError(errorText(e)) }
    )
    const timer = live
      ? setInterval(() => {
          window.zju['replay:slides'](replay.courseId, replay.id).then((value) => { if (active) setSlides(value) }, () => {})
        }, 30_000)
      : undefined
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [replay, live])

  useEffect(() => {
    const player = video.current
    const rows = transcript.current?.children
    if (!player || !rows || !segments) return

    // 播放时只更新变化段落的高亮属性，文字稿 DOM 保持稳定。
    let highlighted = new Set<number>()
    const update = (): void => {
      const next = new Set<number>()
      const time = player.currentTime
      segments.forEach((segment, i) => {
        if (time >= segment.start && time < segment.end) next.add(i)
      })
      for (const i of highlighted) {
        if (!next.has(i)) rows[i]?.removeAttribute('data-now')
      }
      for (const i of next) {
        if (!highlighted.has(i)) rows[i]?.setAttribute('data-now', '')
      }
      highlighted = next
      // 字幕直接写 DOM，不触发 React 重渲染
      if (subtitle.current) {
        const [i] = next
        subtitle.current.textContent = i === undefined ? '' : segments[i].text
      }
    }
    update()
    player.addEventListener('timeupdate', update)
    player.addEventListener('seeking', update)
    return () => {
      player.removeEventListener('timeupdate', update)
      player.removeEventListener('seeking', update)
      for (const i of highlighted) rows[i]?.removeAttribute('data-now')
    }
  }, [segments, src, captions])

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const running = task !== undefined && task.stage !== 'done' && task.stage !== 'error'

  useEffect(() => {
    const el = scroller.current
    if (running && partial?.length && el && following.current) el.scrollTop = el.scrollHeight
  }, [running, partial?.length])

  const transcribe = async (): Promise<void> => {
    setError(null)
    clearPartials(key)
    try {
      setSegments(await window.zju['replay:transcribe'](replay.courseId, replay.id))
    } catch (e) {
      setError(errorText(e))
    }
  }

  const exportSlides = async (): Promise<void> => {
    setBusy(true)
    await window.zju['replay:exportSlides'](replay.courseId, replay.id, title).finally(() => setBusy(false))
  }

  const seek = (sec: number): void => {
    const v = video.current
    if (!v) return
    setSrcError(null)
    v.currentTime = sec
    if (v.paused) {
      void v.play().catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (video.current === v) setSrcError(errorText(e))
      })
    }
  }

  const exportText = (format: TranscriptFormat): void => void window.zju['replay:exportTranscript'](replay.id, format, title)

  return (
    <div className="page page-fit">
      <OutlineWord text="Replay" />
      <Reveal>
        <h1 className="page-title">
          {replay.courseName}
          {live && <span className="live-mark ml-5 align-middle text-[0.35em]">直播</span>}
        </h1>
      </Reveal>
      <Reveal i={1}>
        <p className="page-lede">
          {replay.title}　·　{replay.teacher}　·　{dotDate(replay.recordedAt)}
          {replay.url && (
            <a className="act ml-6" href={replay.url} target="_blank" rel="noreferrer">
              原页面 ↗
            </a>
          )}
        </p>
        <LectureStrip current={replay} />
      </Reveal>

      <div className="panes grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Reveal i={2} className="pane gap-5">
          <div className="player" data-expanded={expanded || undefined}>
            {src ? (
              <Player ref={video} source={src} onError={onPlayerError} />
            ) : (
              <p className="quiet">{srcError ?? '…'}</p>
            )}
            {captions && segments && <p ref={subtitle} className="subtitle" />}
            {src && (
              <button className="player-expand" onClick={() => setExpanded((x) => !x)}>
                {expanded ? '还原' : '铺满'}
              </button>
            )}
          </div>
          {src && srcError && <p className="quiet">{srcError}</p>}
          <SectionHead
            title="课件"
            note={
              <span className="acts">
                {slides && slides.length > 0 && <span>{slides.length} 页</span>}
                <button className="act" disabled={!slides?.length || busy} onClick={exportSlides}>
                  {busy ? '导出中' : '导出 PDF'}
                </button>
              </span>
            }
          />
          <div className="pane-scroll pt-4">
            {slides === null ? (
              <p className="quiet">{slidesError ?? '…'}</p>
            ) : slides.length === 0 ? (
              <p className="quiet">无</p>
            ) : (
              <div className="slides">
                {slides.map((s, i) => (
                  <button key={s.imageUrl} className="slide" onClick={() => (s.time !== undefined ? seek(s.time) : setZoom(s.imageUrl))}>
                    <img src={s.imageUrl} alt="" loading="lazy" decoding="async" />
                    <span className="slide-no">{i + 1}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Reveal>

        <Reveal i={3} className="pane">
          <SectionHead
            title="文字稿"
            note={
              segments ? (
                <span className="acts">
                  <button className="act" data-on={captions || undefined} onClick={() => setCaptions((x) => !x)}>
                    {captions ? '字幕 ·' : '字幕'}
                  </button>
                  {(['txt', 'srt', 'md'] as const).map((f) => (
                    <button key={f} className="act" onClick={() => exportText(f)}>
                      {f.toUpperCase()}
                    </button>
                  ))}
                </span>
              ) : (
                !live && (
                  <button className="act" disabled={running} onClick={transcribe}>
                    转写
                  </button>
                )
              )
            }
          />
          {running && <TranscribeProgress task={task} />}
          <div
            ref={scroller}
            className="pane-scroll scroll-bar pt-2"
            onScroll={(e) => {
              const el = e.currentTarget
              following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
            }}
          >
            {segments ? (
              <div ref={transcript} className="transcript">
                {segments.map((s, i) => (
                  <p key={`${s.start}:${i}`}>
                    <button onClick={() => seek(s.start)}>
                      <time>{hms(s.start)}</time>
                    </button>
                    <span>{s.text}</span>
                  </p>
                ))}
              </div>
            ) : running && partial?.length ? (
              <div className="transcript">
                {partial.map((s, i) => (
                  <p key={`${s.start}:${i}`}>
                    <time>{hms(s.start)}</time>
                    <span>{s.text}</span>
                  </p>
                ))}
              </div>
            ) : (
              !running && <p className="quiet">{error ?? '无'}</p>
            )}
          </div>
        </Reveal>
      </div>

      <AnimatePresence>
        {zoom && (
          <motion.div
            className="lightbox"
            onClick={() => setZoom(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <motion.img
              src={zoom}
              alt=""
              initial={{ scale: 0.96, filter: 'blur(6px)' }}
              animate={{ scale: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
