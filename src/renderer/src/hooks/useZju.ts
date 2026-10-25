import { useCallback, useEffect, useState } from 'react'
import type { ZjuApi } from '@shared/ipc'
import type { DataResult } from '@shared/types'
import { useApp } from '@renderer/store'
import { clearCache, isFresh, peek, put } from '@renderer/lib/cache'

// 只收无参数、返回 DataResult 的 data:* 通道
type DataChannel = {
  [K in keyof ZjuApi]: K extends `data:${string}` ? (ZjuApi[K] extends () => Promise<DataResult<unknown>> ? K : never) : never
}[keyof ZjuApi]
type Payload<K extends DataChannel> = Awaited<ReturnType<ZjuApi[K]>> extends DataResult<infer T> ? T : never

/**
 * Fetches a `data:*` channel once logged in. Cached results (also persisted across launches) render immediately;
 * a refetch runs quietly in the background only when the cache is stale or the epoch changed; exposes `reload`.
 */
export function useZju<K extends DataChannel>(channel: K) {
  const epoch = useApp((s) => s.epoch)
  const ready = useApp((s) => s.authReady)
  const loggedIn = useApp((s) => s.auth.loggedIn)
  // 演示模式下主进程不看登录态，渲染端也照常取数
  const enabled = ready && (loggedIn || import.meta.env.VITE_ZJU_DEMO === '1')
  const [result, setResult] = useState(() => peek<DataResult<Payload<K>>>(channel, true) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => !peek(channel, true))

  const reload = useCallback(async () => {
    setError(null)
    // 有缓存时静默刷新，不出加载态
    if (!peek(channel)) setLoading(true)
    try {
      const value = (await window.zju[channel]()) as DataResult<Payload<K>>
      put(channel, value, useApp.getState().epoch, true)
      setResult(value)
    } catch (e) {
      // ipcRenderer.invoke 会把主进程错误包装成 "Error invoking remote method '…': Error: <msg>"
      setError((e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, ''))
    } finally {
      setLoading(false)
    }
  }, [channel])

  useEffect(() => {
    if (enabled) {
      if (!isFresh(channel, epoch)) void reload()
      return
    }
    // 已确认未登录：丢掉缓存（可能是上一个账号的）
    if (ready) {
      clearCache()
      setResult(null)
    }
    setLoading(!ready)
  }, [reload, channel, epoch, enabled, ready])

  return { data: result?.data, source: result?.source, loading, error, reload }
}
