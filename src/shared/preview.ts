import type { FilePreview } from './types'

// 应用内预览按扩展名分类（桌面主进程、安卓桥与界面共用）；Office 文件在界面里解析成网页显示
const KINDS: Record<string, [FilePreview['kind'], string]> = {
  png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'],
  gif: ['image', 'image/gif'], webp: ['image', 'image/webp'], bmp: ['image', 'image/bmp'], svg: ['image', 'image/svg+xml'],
  pdf: ['pdf', 'application/pdf'],
  docx: ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  xls: ['sheet', 'application/vnd.ms-excel'],
  ods: ['sheet', 'application/vnd.oasis.opendocument.spreadsheet'],
  csv: ['sheet', 'text/csv'],
  pptx: ['slides', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
}
const TEXT = new Set(['txt', 'md', 'json', 'log', 'tex', 'py', 'c', 'cpp', 'h', 'hpp', 'java', 'js', 'ts', 'html', 'css', 'xml', 'm', 'r', 'go', 'rs', 'sql', 'yaml', 'yml'])

/** 超过这个大小不读内容，交给其他应用 */
export const PREVIEW_LIMIT = 50 * 1024 * 1024

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.split(/[?#]/)[0] ?? '')
  return m ? m[1]!.toLowerCase() : ''
}

export function previewKind(name: string): [FilePreview['kind'], string] {
  const ext = extOf(name)
  return KINDS[ext] ?? (TEXT.has(ext) ? ['text', 'text/plain'] : ['other', 'application/octet-stream'])
}

/** 能在应用里打开的文件（附件行点名字直接预览，其余照旧下载） */
export const canPreview = (name: string): boolean => previewKind(name)[0] !== 'other'
