// 渲染端数据缓存：切页面时先显示缓存，过期（5 分钟）或 epoch 变化（登录状态变化、手动刷新）后才在后台静默重取。
// persist 的条目同时写 localStorage，冷启动先显示上次的数据；确认未登录时整体清掉，避免显示上一个账号的内容
const TTL = 5 * 60_000
const PREFIX = 'zju-cache:'

interface Entry {
  value: unknown
  at: number
  /** 取数时的 epoch；从 localStorage 恢复的条目记为 -1，总会在后台重取一次 */
  epoch: number
}

const memory = new Map<string, Entry>()

export function peek<T>(key: string, persist = false): T | undefined {
  let entry = memory.get(key)
  if (!entry && persist) {
    try {
      const raw = localStorage.getItem(PREFIX + key)
      if (raw) {
        entry = { ...(JSON.parse(raw) as Omit<Entry, 'epoch'>), epoch: -1 }
        memory.set(key, entry)
      }
    } catch {}
  }
  return entry?.value as T | undefined
}

export function isFresh(key: string, epoch: number): boolean {
  const entry = memory.get(key)
  return !!entry && entry.epoch === epoch && Date.now() - entry.at < TTL
}

export function put(key: string, value: unknown, epoch: number, persist = false): void {
  const at = Date.now()
  memory.set(key, { value, at, epoch })
  if (persist) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify({ value, at }))
    } catch {}
  }
}

export function clearCache(): void {
  memory.clear()
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key)
  } catch {}
}

/** 新鲜则直接返回缓存，否则请求并写入 */
export async function cached<T>(key: string, epoch: number, fetcher: () => Promise<T>, persist = false): Promise<T> {
  if (isFresh(key, epoch)) return peek<T>(key)!
  const value = await fetcher()
  put(key, value, epoch, persist)
  return value
}
