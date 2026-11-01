// node:path 的替身

export const basename = (path: string): string => path.split(/[\/]/).pop() ?? path

export function extname(path: string): string {
  const name = basename(path)
  const at = name.lastIndexOf('.')
  return at > 0 ? name.slice(at) : ''
}

export const join = (...parts: string[]): string => parts.join('/')
