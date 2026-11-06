import { useState } from 'react'
import { useApp } from '@renderer/store'
import { MOBILE } from '@renderer/lib/platform'
import { canPreview } from '@shared/preview'
import { IconButton } from './IconButton'

// 手机端下到系统"下载"目录，没有"所在位置"，直接用其他应用打开
const REVEAL = MOBILE ? '打开' : '打开位置'

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

/** 附件一行：点名字在应用内预览（能预览的类型），否则下载；行尾下载图标，下完换成打开 */
export function DownloadRow({ url, name }: { url: string; name: string }) {
  const { state, start, reveal } = useDownload()
  const openPreview = useApp((s) => s.openPreview)
  const preview = canPreview(name)
  return (
    <li className="row file-row">
      <button className="text-left" disabled={state.kind === 'busy'} onClick={() => (preview ? openPreview({ url, name }) : void start(url, name))}>
        <span className="row-title !text-base">{name}</span>
      </button>
      <span className="row-end">
        {state.kind === 'busy' && '下载中'}
        {state.kind === 'error' && (
          <span className="file-error" title={state.message}>
            {state.message}
          </span>
        )}
        {state.kind === 'done' && (
          <button className="act" onClick={reveal}>
            {REVEAL}
          </button>
        )}
        {(state.kind === 'idle' || state.kind === 'error') && (
          <IconButton label="下载" onClick={() => void start(url, name)}>
            <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
          </IconButton>
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
    if (path) notify('已保存', { label: REVEAL, run: () => void window.zju['file:reveal'](path) })
  } catch (e) {
    notify(errorText(e))
  }
}
