import { Buffer } from 'buffer'

// node:fs/promises 的替身：作业提交只读用户刚选的文件（homework:pick 存进 picked）

export const picked = new Map<string, File>()

export async function readFile(path: string): Promise<Buffer> {
  const file = picked.get(path)
  if (!file) throw new Error('文件已失效，请重新选择')
  return Buffer.from(await file.arrayBuffer())
}
