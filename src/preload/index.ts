import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { PROGRESS_EVENT, REFRESH_EVENT, ZJU_CHANNELS, type ZjuBridge } from '@shared/ipc'
import type { TaskProgress } from '@shared/types'

const api = Object.fromEntries(
  ZJU_CHANNELS.map((channel) => [channel, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)])
)

const onProgress: ZjuBridge['onProgress'] = (listener) => {
  const handler = (_e: IpcRendererEvent, progress: TaskProgress): void => listener(progress)
  ipcRenderer.on(PROGRESS_EVENT, handler)
  return () => ipcRenderer.off(PROGRESS_EVENT, handler)
}

const onRefresh: ZjuBridge['onRefresh'] = (listener) => {
  const handler = (): void => listener()
  ipcRenderer.on(REFRESH_EVENT, handler)
  return () => ipcRenderer.off(REFRESH_EVENT, handler)
}

contextBridge.exposeInMainWorld('zju', { ...api, onProgress, onRefresh } as ZjuBridge)
