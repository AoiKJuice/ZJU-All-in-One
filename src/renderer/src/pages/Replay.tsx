import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Slide, TranscriptFormat, TranscriptSegment } from '@shared/types'
import { useApp } from '@renderer/store'
import { OutlineWord, Reveal, SectionHead } from '@renderer/components/Type'
import { dotDate } from '@renderer/lib/format'

const STAGE: Record<string, string> = { engine: '下载引擎', model: '下载模型', audio: '提取音频', transcribe: '识别' }

const hms = (sec: number): string =>
  [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), Math.floor(sec % 60)].map((n) => String(n).padStart(2, '0')).join(':')

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

/** 回放页：左侧播放器与课件，右侧文字稿（本地 Whisper）；点时间跳转播放，课件与文字稿均可导出 */
export function Replay() {
  const replay = useApp((s) => s.replay)!
  const task = useApp((s) => s.tasks[`transcribe:${replay.id}`])
  const [slides, setSlides] = useState<Slide[] | null>(null)
  const [slidesError, setSlidesError] = useState<string | null>(null)
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [srcError, setSrcError] = useState<string | null>(null)
  const [now, setNow] = useState(0)
  const video = useRef<HTMLVideoElement>(null)
  const title = `${replay.courseName} ${replay.title}`.trim()

  useEffect(() => {
    setSlides(null)
    setSegments(null)
    setSrc(null)
    window.zju['replay:playback'](replay.courseId, replay.id).then(setSrc, (e) => setSrcError(errorText(e)))
    window.zju['replay:slides'](replay.courseId, replay.id).then(setSlides, (e) => setSlidesError(errorText(e)))
    void window.zju['replay:transcript'](replay.id).then(setSegments)
  }, [replay])

  const running = task !== undefined && task.stage !== 'done' && task.stage !== 'error'

  const transcribe = async (): Promise<void> => {
    setError(null)
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
    v.currentTime = sec
    void v.play()
  }

  const exportText = (format: TranscriptFormat): void => void window.zju['replay:exportTranscript'](replay.id, format, title)

  return (
    <div className="page page-fit">
      <OutlineWord text="Replay" />
      <Reveal>
        <h1 className="page-title">{replay.courseName}</h1>
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
      </Reveal>

      <div className="panes grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Reveal i={2} className="pane gap-5">
          <div className="player">
            {src ? (
              <video ref={video} src={src} controls preload="metadata" onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />
            ) : (
              <p className="quiet">{srcError ?? '…'}</p>
            )}
          </div>
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
                  {(['txt', 'srt', 'md'] as const).map((f) => (
                    <button key={f} className="act" onClick={() => exportText(f)}>
                      {f.toUpperCase()}
                    </button>
                  ))}
                </span>
              ) : (
                <button className="act" disabled={running} onClick={transcribe}>
                  转写
                </button>
              )
            }
          />
          {running && (
            <div className="mt-3">
              <div className="progress">
                <span style={{ width: `${(task.ratio ?? 0) * 100}%` }} />
              </div>
              <p className="quiet !py-2">
                {STAGE[task.stage]}
                {task.ratio !== undefined && ` ${Math.round(task.ratio * 100)}%`}
              </p>
            </div>
          )}
          <div className="pane-scroll pt-2">
            {segments ? (
              <div className="transcript">
                {segments.map((s) => (
                  <p key={s.start} data-now={(now >= s.start && now < s.end) || undefined}>
                    <button onClick={() => seek(s.start)}>
                      <time>{hms(s.start)}</time>
                    </button>
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
