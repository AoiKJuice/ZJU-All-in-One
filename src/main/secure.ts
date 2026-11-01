import { app, safeStorage } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// userData 下的小文件：加密的凭据与明文的开关配置。安卓端由 src/mobile/secure.ts 以同样的接口替换

const file = (name: string): string => join(app.getPath('userData'), name)

/** safeStorage 加密写入；系统不支持加密时不保存 */
export async function saveSecret(name: string, value: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) return
  await writeFile(file(name), safeStorage.encryptString(value))
}

export async function loadSecret(name: string): Promise<string | null> {
  if (!existsSync(file(name))) return null
  return safeStorage.decryptString(await readFile(file(name)))
}

export async function clearSecret(name: string): Promise<void> {
  await rm(file(name), { force: true })
}

export function readConfig<T>(name: string): T | null {
  return existsSync(file(name)) ? (JSON.parse(readFileSync(file(name), 'utf8')) as T) : null
}

export async function writeConfig(name: string, value: unknown): Promise<void> {
  await writeFile(file(name), JSON.stringify(value))
}
