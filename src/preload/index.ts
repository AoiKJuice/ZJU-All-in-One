import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { PROGRESS_EVENT, ZJU_CHANNELS, type ZjuBridge } from '@shared/ipc'
import type { TaskProgress } from '@shared/types'

const api = Object.fromEntries(
  ZJU_CHANNELS.map((channel) => [channel, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)])
)

const onProgress: ZjuBridge['onProgress'] = (listener) => {
  const handler = (_e: IpcRendererEvent, progress: TaskProgress): void => listener(progress)
  ipcRenderer.on(PROGRESS_EVENT, handler)
  return () => ipcRenderer.off(PROGRESS_EVENT, handler)
}

contextBridge.exposeInMainWorld('zju', { ...api, onProgress } as ZjuBridge)
