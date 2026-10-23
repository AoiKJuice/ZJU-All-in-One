import { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import type {
  Slide,
  TranscriptFormat,
  TranscriptSegment
} from '@shared/types'
import { zjuSession } from './auth/zjuam'
import { upgrade } from './download'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function exportSlidesPdf(
  slides: Slide[],
  title: string,
  filePath: string
): Promise<void> {
  if (slides.length === 0) throw new Error('没有可导出的课件')

  // 图片先通过认证会话读取，打印窗口只加载内联数据。
  const images: string[] = []
  for (const slide of slides) {
    const response = await zjuSession().fetch(upgrade(slide.imageUrl), {
      headers: { Referer: 'https://classroom.zju.edu.cn/' }
    })
    if (!response.ok) throw new Error('课件图片下载失败')

    const type = response.headers.get('content-type')?.split(';')[0]
    const bytes = Buffer.from(await response.arrayBuffer())
    images.push(`data:${type ?? 'image/jpeg'};base64,${bytes.toString('base64')}`)
  }

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: 13.333in 7.5in; margin: 0; }
  html, body { margin: 0; padding: 0; }
  section {
    width: 13.333in;
    height: 7.5in;
    break-after: page;
    overflow: hidden;
  }
  section:last-child { break-after: auto; }
  img { display: block; width: 100%; height: 100%; object-fit: contain; }
</style>
</head>
<body>
${images.map(image => `<section><img src="${escapeHtml(image)}"></section>`).join('\n')}
</body>
</html>`

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: zjuSession(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await win.webContents.executeJavaScript(`
      Promise.all(Array.from(document.images, image => image.decode()))
        .catch(() => { throw new Error('课件图片加载失败') })
    `)

    const pdf = await win.webContents.printToPDF({
      pageSize: { width: 13.333, height: 7.5 },
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    await writeFile(filePath, pdf)
  } finally {
    win.destroy()
  }
}

function clock(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60
  return [hours, minutes, seconds]
    .map(value => String(value).padStart(2, '0'))
    .join(':')
}

function srtTime(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  return `${clock(milliseconds / 1000)},${String(milliseconds % 1000).padStart(3, '0')}`
}

export async function writeTranscript(
  segments: TranscriptSegment[],
  format: TranscriptFormat,
  title: string,
  filePath: string
): Promise<void> {
  let content: string

  switch (format) {
    case 'txt':
      content = segments.map(segment => segment.text.trim()).join('\n\n')
      break
    case 'srt':
      content = segments.map((segment, index) => [
        String(index + 1),
        `${srtTime(segment.start)} --> ${srtTime(segment.end)}`,
        segment.text.trim()
      ].join('\n')).join('\n\n')
      break
    case 'md':
      content = `# ${title.replace(/[\r\n]+/g, ' ')}\n\n`
      content += segments.map(segment =>
        `[${clock(segment.start)}] ${segment.text.trim()}`
      ).join('\n\n')
      break
    default:
      throw new Error('不支持的转写导出格式')
  }

  await writeFile(filePath, `${content}\n`, 'utf8')
}
