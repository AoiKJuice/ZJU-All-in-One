/// <reference path="./mammoth.d.ts" />
import { useEffect, useRef, useState } from 'react'
import { Choice } from '@renderer/components/Type'
import { MOBILE } from '@renderer/lib/platform'
// 只是 worker 文件的地址，pdf.js 本身仍按需加载
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

// Office 文件在界面里解析显示（两端共用，库按需加载）：Word 转成网页、表格画成表、演示文稿逐页列出文字与图片。
// 只为看清内容，不追求还原版式；解析不了的交给其他应用

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

/** 解析出的网页去掉脚本、事件属性再显示 */
function clean(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, iframe, object, embed').forEach((n) => n.remove())
  doc.querySelectorAll('*').forEach((n) => {
    for (const a of [...n.attributes]) {
      if (a.name.startsWith('on') || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name)
    }
  })
  return doc.body.innerHTML
}

/** 解析期间与出错时的占位；blob 地址随组件卸载释放 */
function useParsed<T>(parse: (blobs: string[]) => Promise<T>, deps: unknown[]): { value: T | null; error: string | null } {
  const [value, setValue] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const blobs: string[] = []
    let live = true
    parse(blobs).then(
      (v) => live && setValue(v),
      (e) => live && setError(`无法解析：${errorText(e)}`)
    )
    return () => {
      live = false
      blobs.forEach((b) => URL.revokeObjectURL(b))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { value, error }
}

function Pending({ error }: { error: string | null }) {
  return <p className="quiet">{error ?? '…'}</p>
}

/* ---------------- Word（docx） ---------------- */

export function DocxView({ data }: { data: Uint8Array }) {
  const { value, error } = useParsed(async (blobs) => {
    const mammoth = (await import('mammoth/mammoth.browser.min.js')).default
    const result = await mammoth.convertToHtml(
      { arrayBuffer: data.slice().buffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const url = URL.createObjectURL(new Blob([await image.readAsArrayBuffer()], { type: image.contentType }))
          blobs.push(url)
          return { src: url }
        })
      }
    )
    return clean(result.value)
  }, [data])
  if (!value) return <Pending error={error} />
  return <article className="preview-doc rich scroll-bar" dangerouslySetInnerHTML={{ __html: value || '<p>无</p>' }} />
}

/* ---------------- 表格（xlsx / xls / ods / csv） ---------------- */

const ROW_LIMIT = 2000

interface Sheet {
  name: string
  rows: string[][]
  more: number
}

export function SheetView({ data, name }: { data: Uint8Array; name: string }) {
  const { value, error } = useParsed(async () => {
    const XLSX = await import('xlsx')
    const csv = /\.csv$/i.test(name)
    // csv 多为 GBK 或 UTF-8：先按 UTF-8 解，出现替换字符再按 GB18030
    const book = csv
      ? XLSX.read(decodeText(data), { type: 'string' })
      : XLSX.read(data, { type: 'array', cellDates: true })
    return book.SheetNames.map((sheetName): Sheet => {
      const all = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheetName]!, { header: 1, raw: false, blankrows: false, defval: '' })
      const rows = all.slice(0, ROW_LIMIT).map((r) => r.map((c) => String(c ?? '')))
      return { name: sheetName, rows, more: Math.max(0, all.length - ROW_LIMIT) }
    })
  }, [data, name])
  const [index, setIndex] = useState(0)
  if (!value) return <Pending error={error} />
  const sheet = value[index] ?? value[0]
  return (
    <div className="preview-sheet">
      {value.length > 1 && (
        <div className="preview-tabs scroll-bar">
          {value.map((s, i) => (
            <Choice key={s.name} group="preview-sheet" active={i === index} onClick={() => setIndex(i)}>
              {s.name}
            </Choice>
          ))}
        </div>
      )}
      {!sheet || sheet.rows.length === 0 ? (
        <p className="quiet">无</p>
      ) : (
        <div className="preview-table scroll-bar">
          <table>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r}>
                  <th>{r + 1}</th>
                  {row.map((cell, c) => (
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {sheet.more > 0 && <p className="quiet">另有 {sheet.more} 行</p>}
        </div>
      )}
    </div>
  )
}

function decodeText(data: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(data)
  return utf8.includes('�') ? new TextDecoder('gb18030').decode(data) : utf8
}

/* ---------------- 演示文稿（pptx） ---------------- */

interface Slide {
  title: string
  lines: string[]
  images: string[]
}

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' }

/** 相对 base 文件所在目录解析 target（rels 里的 ../media/image1.png） */
function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

function relsOf(xml: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!xml) return map
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  for (const r of doc.getElementsByTagName('Relationship')) map.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '')
  return map
}

export function SlidesView({ data }: { data: Uint8Array }) {
  const { value, error } = useParsed(async (blobs) => {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(data)
    const read = (path: string): Promise<string> | undefined => zip.file(path)?.async('string')

    // 按 presentation.xml 里的顺序取页，取不到时按文件名序号
    const presRels = relsOf(await read('ppt/_rels/presentation.xml.rels'))
    const pres = new DOMParser().parseFromString((await read('ppt/presentation.xml')) ?? '<p/>', 'application/xml')
    let paths = [...pres.getElementsByTagName('p:sldId')]
      .map((n) => presRels.get(n.getAttribute('r:id') ?? ''))
      .filter((t): t is string => !!t)
      .map((t) => resolvePart('ppt/presentation.xml', t))
    if (paths.length === 0) {
      paths = Object.keys(zip.files)
        .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
        .sort((a, b) => Number(/\d+/.exec(a.slice(11))![0]) - Number(/\d+/.exec(b.slice(11))![0]))
    }

    const slides: Slide[] = []
    for (const path of paths) {
      const xml = await read(path)
      if (!xml) continue
      const doc = new DOMParser().parseFromString(xml, 'application/xml')
      const rels = relsOf(await read(path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')))
      let title = ''
      const lines: string[] = []
      for (const shape of doc.getElementsByTagName('p:sp')) {
        const ph = shape.getElementsByTagName('p:ph')[0]?.getAttribute('type') ?? ''
        const paras = [...shape.getElementsByTagName('a:p')]
          .map((p) => [...p.getElementsByTagName('a:t')].map((t) => t.textContent ?? '').join('').trim())
          .filter(Boolean)
        if (!title && (ph === 'title' || ph === 'ctrTitle')) title = paras.join(' ')
        else lines.push(...paras)
      }
      // 表格里的文字
      for (const cell of doc.getElementsByTagName('a:tc')) {
        const text = [...cell.getElementsByTagName('a:t')].map((t) => t.textContent ?? '').join('').trim()
        if (text) lines.push(text)
      }
      const images: string[] = []
      for (const blip of doc.getElementsByTagName('a:blip')) {
        const target = rels.get(blip.getAttribute('r:embed') ?? '')
        if (!target) continue
        const part = resolvePart(path, target)
        const type = IMAGE_TYPES[part.split('.').pop()?.toLowerCase() ?? '']
        const file = zip.file(part)
        if (!type || !file) continue
        const url = URL.createObjectURL(new Blob([(await file.async('uint8array')) as BlobPart], { type }))
        blobs.push(url)
        images.push(url)
      }
      slides.push({ title, lines, images })
    }
    return slides
  }, [data])
  if (!value) return <Pending error={error} />
  if (value.length === 0) return <p className="quiet">无</p>
  return (
    <ol className="preview-slides scroll-bar">
      {value.map((s, i) => (
        <li key={i} className="preview-slide">
          <span className="preview-slide-no">{i + 1}</span>
          {s.title && <h3>{s.title}</h3>}
          {s.lines.length > 0 && (
            <ul>
              {s.lines.map((line, j) => (
                <li key={j}>{line}</li>
              ))}
            </ul>
          )}
          {s.images.length > 0 && (
            <div className="preview-slide-images">
              {s.images.map((src) => (
                <img key={src} src={src} alt="" loading="lazy" />
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

/* ---------------- PDF（安卓 WebView 没有内置查看器，用 pdf.js 逐页画） ---------------- */

export function PdfView({ data }: { data: Uint8Array }) {
  const box = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState(0)

  useEffect(() => {
    let cancelled = false
    let destroy: (() => void) | undefined
    ;(async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker
      const task = pdfjs.getDocument({ data: data.slice() })
      destroy = () => void task.destroy()
      const doc = await task.promise
      if (cancelled) return
      setPages(doc.numPages)
      // 等页框渲染出来再逐页画；滚到附近才画，免得大文件一次占满内存
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const frames = [...(box.current?.querySelectorAll<HTMLCanvasElement>('canvas') ?? [])]
      const drawn = new Set<number>()
      const draw = async (i: number): Promise<void> => {
        if (drawn.has(i) || cancelled) return
        drawn.add(i)
        const page = await doc.getPage(i + 1)
        const canvas = frames[i]!
        const width = canvas.parentElement!.clientWidth
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (width / base.width) * Math.min(devicePixelRatio, 2) })
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.aspectRatio = `${base.width} / ${base.height}`
        await page.render({ canvas, viewport }).promise
      }
      const observer = new IntersectionObserver(
        (entries) => entries.forEach((e) => e.isIntersecting && void draw(frames.indexOf(e.target as HTMLCanvasElement))),
        { root: box.current, rootMargin: '800px 0px' }
      )
      frames.forEach((f) => observer.observe(f))
      const prev = destroy
      destroy = () => {
        observer.disconnect()
        prev()
      }
    })().catch((e) => !cancelled && setError(`无法解析：${errorText(e)}`))
    return () => {
      cancelled = true
      destroy?.()
    }
  }, [data])

  if (error || !pages) return (
    <div ref={box} className="preview-pdf">
      <Pending error={error} />
    </div>
  )
  return (
    <div ref={box} className="preview-pdf scroll-bar">
      {Array.from({ length: pages }, (_, i) => (
        <div key={i} className="preview-pdf-page">
          <canvas style={{ aspectRatio: '1 / 1.414' }} />
        </div>
      ))}
    </div>
  )
}

/** 桌面端 PDF 用 Chromium 自带查看器（iframe），手机端用 pdf.js */
export const NATIVE_PDF = !MOBILE
