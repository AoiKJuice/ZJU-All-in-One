import { useCallback, useEffect, useState } from 'react'
import type { ZjuApi } from '@shared/ipc'
import type { DataResult } from '@shared/types'
import { useApp } from '@renderer/store'

type DataChannel = { [K in keyof ZjuApi]: K extends `data:${string}` ? K : never }[keyof ZjuApi]
type Payload<K extends DataChannel> = Awaited<ReturnType<ZjuApi[K]>> extends DataResult<infer T> ? T : never

/** Fetches a `data:*` channel on mount and whenever login state changes; exposes `reload`. */
export function useZju<K extends DataChannel>(channel: K) {
  const epoch = useApp((s) => s.epoch)
  const [result, setResult] = useState<DataResult<Payload<K>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setResult((await window.zju[channel]()) as DataResult<Payload<K>>)
    } catch (e) {
      // ipcRenderer.invoke 会把主进程错误包装成 "Error invoking remote method '…': Error: <msg>"
      setError((e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, ''))
    } finally {
      setLoading(false)
    }
  }, [channel])

  useEffect(() => {
    void reload()
  }, [reload, epoch])

  return { data: result?.data, source: result?.source, loading, error, reload }
}
