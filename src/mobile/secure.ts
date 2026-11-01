import { native } from './native'

// 安卓端的 src/main/secure.ts：凭据经 Android Keystore 加密，开关配置放 localStorage

export async function saveSecret(name: string, value: string): Promise<void> {
  await native.secureSet({ key: name, value })
}

export async function loadSecret(name: string): Promise<string | null> {
  return (await native.secureGet({ key: name })).value
}

export async function clearSecret(name: string): Promise<void> {
  await native.secureRemove({ key: name })
}

export function readConfig<T>(name: string): T | null {
  const raw = localStorage.getItem(`config:${name}`)
  return raw ? (JSON.parse(raw) as T) : null
}

export async function writeConfig(name: string, value: unknown): Promise<void> {
  localStorage.setItem(`config:${name}`, JSON.stringify(value))
}
