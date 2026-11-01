import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaybackSource, Slide, TranscriptFormat, TranscriptSegment, TranscriptSource } from '@shared/types'
import { useApp } from '@renderer/store'
import { Choice, Joined, OutlineWord, Reveal } from '@renderer/components/Type'
import { dotDate } from '@renderer/lib/format'
import { Player } from '@renderer/components/Player'
import { TranscribeProgress } from '@renderer/components/TranscribeProgress'
import { LectureList } from '@renderer/components/LectureList'
import { SlideViewer } from '@renderer/components/SlideViewer'
import { FormatMenu } from '@renderer/components/FormatMenu'
import { useCurrentSlide } from '@renderer/hooks/useCurrentSlide'
import { MOBILE } from '@renderer/lib/platform'

const hms = (sec: number): string =>
  [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), Math.floor(sec % 60)].map((n) => String(n).padStart(2, '0')).join(':')

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

type Tab = 'slides' | 'transcript' | 'lectures'
const SOURCES: { id: TranscriptSource; label: string }[] = [
  { id: 'local', label: '本地' },
  { id: 'platform', label: '智云' }
]

const TABS: { id: Tab; label: string }[] = [
  { id: 'slides', label: '课件' },
  { id: 'transcript', label: '文字稿' },
  { id: 'lectures', label: '选集' }
]

/**
 * 回放 / 直播页：左侧整列给视频（16:9 按列宽与可用高度取较小者），右侧侧栏在 课件 / 文字稿 / 选集 之间切换。
 * 三个面板都保持挂载、只是隐藏：字幕依赖文字稿行定位当前句，课件要保留跟随状态。
 * 手机端视频在上、侧栏在下，只有智云文字稿（没有本地转写与导出），全屏为横屏铺满。
 */
export function Replay() {
  const replay = useApp((s) => s.replay)!
  const notify = useApp((s) => s.notify)
  const key = `transcribe:${replay.id}`
  const task = useApp((s) => s.tasks[key])
  const partial = useApp((s) => s.partials[key])
  const clearPartials = useApp((s) => s.clearPartials)
  const live = replay.status === 'live'
  const [tab, setTab] = useState<Tab>('slides')
  const [slides, setSlides] = useState<Slide[] | null>(null)
  const [slidesError, setSlidesError] = useState<string | null>(null)
  // 文字稿两个来源：本地 Whisper 转写与智云自带转写；没有本地稿时默认看智云的
  const [source, setSource] = useState<TranscriptSource>('local')
  const [local, setLocal] = useState<TranscriptSegment[] | null>(null)
  const [platform, setPlatform] = useState<TranscriptSegment[] | null>(null)
  const [platformError, setPlatformError] = useState<string | null>(null)
  const segments = source === 'local' ? local : platform?.length ? platform : null
  // 智云课后会重新生成回放、换掉视频：缓存的文字稿对应旧视频时提示重新转写
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  const currentSlide = useCurrentSlide(slides, video, live, src)
  const back = useApp((s) => s.back)

  // 手机端的全屏就是铺满 + 横屏、隐藏系统栏
  useEffect(() => {
    if (!MOBILE) return
    window.zju.immersive?.(expanded)
    return () => window.zju.immersive?.(false)
  }, [expanded])

  useEffect(() => {
    let active = true
    setSlides(null)
    setLocal(null)
    setPlatform(null)
    setPlatformError(null)
    setSource('local')
    setStale(false)
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
    const loadPlatform = (): void => {
      window.zju['replay:platformTranscript'](replay.id).then(
        (value) => { if (active) setPlatform(value) },
        (e) => { if (active) setPlatformError(errorText(e)) }
      )
    }
    loadPlatform()
    window.zju['replay:transcript'](replay.id).then(
      (value) => {
        if (!active) return
        setLocal(value)
        if (!value) setSource('platform')
        if (value && !live) {
          window.zju['replay:transcriptStale'](replay.courseId, replay.id).then((v) => { if (active) setStale(v) }, () => {})
        }
      },
      (e) => { if (active) setError(errorText(e)) }
    )
    const timer = live
      ? setInterval(() => {
          window.zju['replay:slides'](replay.courseId, replay.id).then((value) => { if (active) setSlides(value) }, () => {})
          loadPlatform()
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

  // force：忽略缓存重新转写；进行中显示实时结果，失败时恢复原文字稿
  const transcribe = async (force = false): Promise<void> => {
    const previous = local
    setError(null)
    clearPartials(key)
    setTab('transcript')
    setSource('local')
    if (force) setLocal(null)
    try {
      setLocal(await window.zju['replay:transcribe'](replay.courseId, replay.id, force))
      setStale(false)
    } catch (e) {
      setError(errorText(e))
      // 恢复原文字稿后错误行不显示，改用轻提示
      if (force) {
        setLocal(previous)
        notify(errorText(e))
      }
    }
  }

  const exportSlides = async (): Promise<void> => {
    setBusy(true)
    try {
      const path = await window.zju['replay:exportSlides'](replay.courseId, replay.id, title)
      if (path) notify('已导出', { label: '打开位置', run: () => void window.zju['file:reveal'](path) })
    } catch (e) {
      notify(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const exportText = async (format: TranscriptFormat): Promise<void> => {
    try {
      const path = await window.zju['replay:exportTranscript'](replay.id, format, title, source)
      if (path) notify('已导出', { label: '打开位置', run: () => void window.zju['file:reveal'](path) })
    } catch (e) {
      notify(errorText(e))
    }
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

  return (
    <div className="page page-fit page-wide replay-page">
      <OutlineWord text={live ? 'Live' : 'Replay'} />
      <Reveal className="replay-head">
        {MOBILE && (
          <button className="replay-back" aria-label="返回" onClick={back}>
            ←
          </button>
        )}
        <h1 className="replay-title">
          {replay.courseName}
          {live && <span className="live-mark ml-4 text-[0.55em]">直播</span>}
        </h1>
        <p className="replay-meta">
          <Joined parts={[replay.title, replay.teacher, dotDate(replay.recordedAt)]} />
          {replay.url && !MOBILE && (
            // 与前面的标签同样是一枚小标签，随标签一起换行
            <a className="part meta-link" href={replay.url} target="_blank" rel="noreferrer">
              原页面 ↗
            </a>
          )}
        </p>
      </Reveal>

      <div className="replay-layout">
        <Reveal i={1} flat className="replay-main">
          <div className="player-wrap">
            {src ? (
              <Player
                ref={video}
                source={src}
                onError={onPlayerError}
                expanded={expanded}
                onToggleExpand={() => setExpanded((x) => !x)}
                slide={slides?.[currentSlide]?.imageUrl}
              >
                {captions && segments && <p ref={subtitle} className="subtitle" />}
              </Player>
            ) : (
              <div className="player">
                <p className="quiet">{srcError ?? '…'}</p>
              </div>
            )}
          </div>
          {src && srcError && <p className="quiet !py-1">{srcError}</p>}
        </Reveal>

        <Reveal i={2} flat className="replay-side">
          <nav className="tabs">
            {TABS.map((t) => (
              <Choice key={t.id} group="replay-tab" active={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
              </Choice>
            ))}
          </nav>

          <section className="tab-panel" hidden={tab !== 'slides'}>
            <SlideViewer
              slides={slides}
              error={slidesError}
              video={video}
              ready={src}
              live={live}
              courseName={replay.courseName}
              onSeek={seek}
              extra={
                !MOBILE && (
                  <button className="act" disabled={!slides?.length || busy} onClick={exportSlides}>
                    {busy ? '导出中' : '导出 PDF'}
                  </button>
                )
              }
            />
          </section>

          <section className="tab-panel" hidden={tab !== 'transcript'}>
            <div className="acts tab-tools">
              {!MOBILE && SOURCES.map((o) => (
                <Choice key={o.id} group="transcript-source" className="small" active={source === o.id} onClick={() => setSource(o.id)}>
                  {o.label}
                </Choice>
              ))}
              <span className="tools-end">
                {segments && (
                  <button className="act" data-on={captions || undefined} onClick={() => setCaptions((x) => !x)}>
                    字幕
                  </button>
                )}
                {source === 'local' && !live && !MOBILE && segments && (
                  <button className="act" data-on={stale || undefined} title={stale ? '视频已更新' : undefined} onClick={() => void transcribe(true)}>
                    重新转写
                  </button>
                )}
                {segments && !MOBILE && <FormatMenu label="下载" formats={['txt', 'srt', 'md'] as const} onPick={(f) => void exportText(f)} />}
              </span>
            </div>
            {running && source === 'local' && <TranscribeProgress task={task} />}
            <div
              ref={scroller}
              className="pane-scroll scroll-bar pt-1"
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
              ) : source === 'local' && running && partial?.length ? (
                <div className="transcript">
                  {partial.map((s, i) => (
                    <p key={`${s.start}:${i}`}>
                      <time>{hms(s.start)}</time>
                      <span>{s.text}</span>
                    </p>
                  ))}
                </div>
              ) : (
                !(source === 'local' && running) && (
                  <div className="transcript-empty">
                    <p className="quiet">{(source === 'local' ? error : platformError) ?? (source === 'platform' && platform === null ? '…' : '无')}</p>
                    {/* 还没有本地文字稿时，转写是这里唯一的操作，放在空状态里而不是工具行上孤零零一个 */}
                    {source === 'local' && !live && !MOBILE && (
                      <button className="btn btn-solid" onClick={() => void transcribe()}>
                        转写
                      </button>
                    )}
                  </div>
                )
              )}
            </div>
          </section>

          <section className="tab-panel" hidden={tab !== 'lectures'}>
            <div className="pane-scroll scroll-bar">
              <LectureList current={replay} />
            </div>
          </section>
        </Reveal>
      </div>
    </div>
  )
}
