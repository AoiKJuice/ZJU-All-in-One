import { useState } from 'react'
import { useApp } from '@renderer/store'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; path: string } | { kind: 'error'; message: string }

/** 应用内下载：保存框 → 主进程用登录会话写文件；完成后可在资源管理器中显示 */
export function useDownload() {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const start = async (url: string, name: string): Promise<void> => {
    setState({ kind: 'busy' })
    try {
      const path = await window.zju['file:download'](url, name)
      setState(path ? { kind: 'done', path } : { kind: 'idle' })
    } catch (e) {
      setState({ kind: 'error', message: errorText(e) })
    }
  }
  const reveal = (): void => {
    if (state.kind === 'done') void window.zju['file:reveal'](state.path)
  }
  return { state, start, reveal }
}

/** 附件一行：点名字下载，尾注显示进度 / 打开位置 */
export function DownloadRow({ url, name }: { url: string; name: string }) {
  const { state, start, reveal } = useDownload()
  return (
    <li className="row !grid-cols-[minmax(0,1fr)_auto] !py-2">
      <button className="text-left" disabled={state.kind === 'busy'} onClick={() => void start(url, name)}>
        <span className="row-title !text-base">{name}</span>
      </button>
      <span className="row-end">
        {state.kind === 'busy' && '下载中'}
        {state.kind === 'error' && <span className="text-[var(--shu)]">{state.message}</span>}
        {state.kind === 'done' && (
          <button className="act" onClick={reveal}>
            打开位置
          </button>
        )}
      </span>
    </li>
  )
}

/** 一次性下载（如课件图）：结果用底部轻提示报告，成功时可打开所在位置 */
export async function downloadFile(url: string, name: string): Promise<void> {
  const { notify } = useApp.getState()
  try {
    const path = await window.zju['file:download'](url, name)
    if (path) notify('已保存', { label: '打开位置', run: () => void window.zju['file:reveal'](path) })
  } catch (e) {
    notify(errorText(e))
  }
}
