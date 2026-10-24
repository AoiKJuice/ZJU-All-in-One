import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { FilePreview as Preview } from '@shared/types'
import { useApp } from '@renderer/store'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

/** 本机文件预览：图片 / PDF / 文本在应用内显示，其余（及过大的文件）给"默认程序打开" */
export function FilePreview() {
  const path = useApp((s) => s.preview)
  const close = useApp((s) => s.openPreview)
  return <AnimatePresence>{path && <View key={path} path={path} onClose={() => close(null)} />}</AnimatePresence>
}

function View({ path, onClose }: { path: string; onClose: () => void }) {
  const [file, setFile] = useState<Preview | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let blob: string | undefined
    window.zju['file:preview'](path).then((f) => {
      setFile(f)
      if (!f.data) return
      if (f.kind === 'text') setText(new TextDecoder().decode(f.data))
      else setUrl((blob = URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.mime }))))
    }, (e) => setError(errorText(e)))
    return () => {
      if (blob) URL.revokeObjectURL(blob)
    }
  }, [path])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openExternally = (): void => {
    window.zju['file:open'](path).catch((e) => setError(errorText(e)))
  }

  return (
    <motion.div
      className="preview"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="preview-bar">
        <span className="truncate">{file?.name ?? path.split(/[\\/]/).pop()}</span>
        <span className="flex-1" />
        <button className="act" onClick={openExternally}>
          默认程序打开
        </button>
        <button className="act" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="preview-stage">
        {error ? (
          <p className="quiet">{error}</p>
        ) : !file ? (
          <p className="quiet">…</p>
        ) : file.kind === 'image' && url ? (
          <img src={url} alt="" />
        ) : file.kind === 'pdf' && url ? (
          <iframe src={url} title={file.name} />
        ) : text !== null ? (
          <pre className="preview-text scroll-bar">{text}</pre>
        ) : (
          <button className="act" onClick={openExternally}>
            默认程序打开
          </button>
        )}
      </div>
    </motion.div>
  )
}
