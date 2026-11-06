import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { FilePreview as Preview } from '@shared/types'
import { useApp, type PreviewTarget } from '@renderer/store'
import { dur } from '@renderer/lib/motion'
import { MOBILE } from '@renderer/lib/platform'
import { CloseButton, IconButton } from '@renderer/components/IconButton'
import { downloadFile } from '@renderer/components/Download'
import { DocxView, NATIVE_PDF, PdfView, SheetView, SlidesView } from '@renderer/components/preview/Office'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

const keyOf = (t: PreviewTarget): string => (typeof t === 'string' ? t : t.url)
const nameOf = (t: PreviewTarget): string => (typeof t === 'string' ? (t.split(/[\/]/).pop() ?? t) : t.name)

/**
 * 应用内预览：本机文件（待提交的文件）或校内文件（作业附件、已交文件，用登录会话取回、不落盘）。
 * 图片、PDF、文本、Word、表格、演示文稿在应用里显示，其余（及超过 50MB 的）交给其他应用或下载
 */
export function FilePreview() {
  const target = useApp((s) => s.preview)
  const close = useApp((s) => s.openPreview)
  return <AnimatePresence>{target && <View key={keyOf(target)} target={target} onClose={() => close(null)} />}</AnimatePresence>
}

function View({ target, onClose }: { target: PreviewTarget; onClose: () => void }) {
  const [file, setFile] = useState<Preview | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const local = typeof target === 'string'

  useEffect(() => {
    let blob: string | undefined
    const load = typeof target === 'string' ? window.zju['file:preview'](target) : window.zju['file:previewUrl'](target.url, target.name)
    load.then((f) => {
      setFile(f)
      if (!f.data) return
      if (f.kind === 'text') setText(new TextDecoder().decode(f.data))
      else if (f.kind === 'image' || (f.kind === 'pdf' && NATIVE_PDF)) setUrl((blob = URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.mime }))))
    }, (e) => setError(errorText(e)))
    return () => {
      if (blob) URL.revokeObjectURL(blob)
    }
  }, [target])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 本机文件交给其他应用打开；校内文件下载到本机（下载完可再打开）
  const handOff = (): void => {
    if (typeof target === 'string') window.zju['file:open'](target).catch((e) => setError(errorText(e)))
    else void downloadFile(target.url, target.name)
  }
  const handOffLabel = local ? (MOBILE ? '用其他应用打开' : '用默认程序打开') : '下载'

  const body = (): React.ReactNode => {
    if (error) return <p className="quiet">{error}</p>
    if (!file) return <p className="quiet">…</p>
    if (!file.data)
      return (
        <div className="preview-handoff">
          <p className="quiet">无法在应用内预览</p>
          <button className="btn btn-solid" onClick={handOff}>
            {handOffLabel}
          </button>
        </div>
      )
    if (file.kind === 'image' && url) return <img src={url} alt="" />
    if (file.kind === 'pdf') return NATIVE_PDF ? url && <iframe src={url} title={file.name} /> : <PdfView data={file.data} />
    if (file.kind === 'docx') return <DocxView data={file.data} />
    if (file.kind === 'sheet') return <SheetView data={file.data} name={file.name} />
    if (file.kind === 'slides') return <SlidesView data={file.data} />
    if (text !== null) return <pre className="preview-text scroll-bar">{text}</pre>
    return null
  }

  return (
    <motion.div
      className="preview"
      data-kind={file?.kind}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: dur(0.3), ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="preview-bar">
        <span className="preview-name">{file?.name ?? nameOf(target)}</span>
        <span className="acts shrink-0">
          {local ? (
            <IconButton label={handOffLabel} onClick={handOff}>
              <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
            </IconButton>
          ) : (
            <IconButton label="下载" onClick={handOff}>
              <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
            </IconButton>
          )}
          <CloseButton onClick={onClose} />
        </span>
      </div>
      <div className="preview-stage">{body()}</div>
    </motion.div>
  )
}
