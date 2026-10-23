import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Slide } from '@shared/types'
import { downloadFile } from './Download'
import { useCurrentSlide } from '@renderer/hooks/useCurrentSlide'

const EASE = [0.22, 1, 0.36, 1] as const

interface Props {
  slides: Slide[] | null
  error: string | null
  video: RefObject<HTMLVideoElement | null>
  /** 播放器就绪的标志，用于重新订阅 timeupdate */
  ready: unknown
  live: boolean
  courseName: string
  /** 回放时从某页开始播放 */
  onSeek: (time: number) => void
  /** 区块标题右侧的其他动作（导出 PDF） */
  extra: ReactNode
}

/**
 * 课件区：缩略图 / 大图两种视图。
 * 大图可翻页，默认跟随当前讲解页，手动翻页后停止跟随，"回到当前"恢复。
 * 点击课件不影响播放（直播尤其不能暂停）；右键：全窗口查看、下载。
 */
export function SlideViewer({ slides, error, video, ready, live, courseName, onSeek, extra }: Props) {
  const [mode, setMode] = useState<'grid' | 'single'>('grid')
  const [index, setIndex] = useState(0)
  const [follow, setFollow] = useState(true)
  const [menu, setMenu] = useState<{ x: number; y: number; i: number } | null>(null)
  const [full, setFull] = useState<number | null>(null)
  const viewer = useRef<HTMLDivElement>(null)
  const count = slides?.length ?? 0

  const current = useCurrentSlide(slides, video, live, ready)

  useEffect(() => {
    if (follow) setIndex(current)
  }, [follow, current])

  const go = (i: number): void => {
    setIndex(Math.max(0, Math.min(count - 1, i)))
    setFollow(false)
  }

  // 大图视图下，鼠标在课件区时 ←/→ 翻页；全窗口查看时 ←/→ 翻页、Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (full !== null) {
        if (e.key === 'Escape') setFull(null)
        if (e.key === 'ArrowLeft') setFull((f) => Math.max(0, (f ?? 0) - 1))
        if (e.key === 'ArrowRight') setFull((f) => Math.min(count - 1, (f ?? 0) + 1))
        return
      }
      if (mode !== 'single' || !viewer.current?.matches(':hover')) return
      if (e.key === 'ArrowLeft') go(index - 1)
      if (e.key === 'ArrowRight') go(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const openMenu = (e: MouseEvent, i: number): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, i })
  }

  const download = (i: number): void => {
    const url = slides![i].imageUrl
    const ext = new URL(url).pathname.match(/\.\w+$/)?.[0] ?? '.jpg'
    void downloadFile(url, `${courseName}-${String(i + 1).padStart(2, '0')}${ext}`)
  }

  const slide = slides?.[index]

  return (
    <>
      <div className="acts tab-tools">
        {count > 0 && (
          <>
            <button className="act" data-on={mode === 'grid' || undefined} onClick={() => setMode('grid')}>
              缩略图
            </button>
            <button className="act" data-on={mode === 'single' || undefined} onClick={() => setMode('single')}>
              大图
            </button>
          </>
        )}
        <span className="flex-1" />
        {extra}
      </div>
      <div ref={viewer} className={mode === 'grid' ? 'pane-scroll scroll-bar' : 'slide-single'}>
        {slides === null ? (
          <p className="quiet">{error ?? '…'}</p>
        ) : count === 0 ? (
          <p className="quiet">无</p>
        ) : mode === 'grid' ? (
          <div className="slides">
            {slides.map((s, i) => (
              <button
                key={`${s.imageUrl}:${i}`}
                className="slide"
                data-current={i === current || undefined}
                onClick={() => {
                  setIndex(i)
                  setFollow(i === current)
                  setMode('single')
                }}
                onContextMenu={(e) => openMenu(e, i)}
              >
                <img src={s.imageUrl} alt="" loading="lazy" decoding="async" />
                <span className="slide-no">{i + 1}</span>
              </button>
            ))}
          </div>
        ) : (
          slide && (
            <>
              <div className="slide-stage" onContextMenu={(e) => openMenu(e, index)}>
                <img src={slide.imageUrl} alt="" />
              </div>
              {/* 翻页一行在图片框之外，图片限制在自己的框内，不会盖住按钮 */}
              <div className="acts slide-nav">
                <button className="act" disabled={index === 0} onClick={() => go(index - 1)}>
                  上一页
                </button>
                <span className="tabular-nums">
                  {index + 1} / {count}
                </span>
                <button className="act" disabled={index === count - 1} onClick={() => go(index + 1)}>
                  下一页
                </button>
                <span className="flex-1" />
                {!live && slide.time !== undefined && (
                  <button className="act" onClick={() => onSeek(slide.time!)}>
                    从此页播放
                  </button>
                )}
                <button className="act" data-on={(follow && index === current) || undefined} onClick={() => setFollow(true)}>
                  回到当前
                </button>
              </div>
            </>
          )
        )}
      </div>

      {menu && (
        <ul className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <li>
            <button
              onClick={() => {
                setFull(menu.i)
                setMenu(null)
              }}
            >
              全窗口查看
            </button>
          </li>
          <li>
            <button
              onClick={() => {
                download(menu.i)
                setMenu(null)
              }}
            >
              下载
            </button>
          </li>
        </ul>
      )}

      <AnimatePresence>
        {full !== null && slides?.[full] && (
          <motion.div
            className="lightbox"
            onClick={() => setFull(null)}
            onContextMenu={(e) => openMenu(e, full)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            <motion.img
              key={full}
              src={slides[full].imageUrl}
              alt=""
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.45, ease: EASE }}
            />
            <span className="lightbox-no">
              {full + 1} / {count}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
