import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { AUTH_EVENT, CONFIRM_EVENT, OPEN_EVENT, PROGRESS_EVENT, REFRESH_EVENT, ZJU_CHANNELS, type ZjuBridge } from '@shared/ipc'
import type { ConfirmRequest, OpenRequest, TaskProgress } from '@shared/types'

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

const onOpen: ZjuBridge['onOpen'] = (listener) => {
  const handler = (_e: IpcRendererEvent, request: OpenRequest): void => listener(request)
  ipcRenderer.on(OPEN_EVENT, handler)
  return () => ipcRenderer.off(OPEN_EVENT, handler)
}

const onConfirm: ZjuBridge['onConfirm'] = (listener) => {
  const handler = (_e: IpcRendererEvent, request: ConfirmRequest): void => listener(request)
  ipcRenderer.on(CONFIRM_EVENT, handler)
  return () => ipcRenderer.off(CONFIRM_EVENT, handler)
}

const onAuth: ZjuBridge['onAuth'] = (listener) => {
  const handler = (): void => listener()
  ipcRenderer.on(AUTH_EVENT, handler)
  return () => ipcRenderer.off(AUTH_EVENT, handler)
}

contextBridge.exposeInMainWorld('zju', { ...api, onProgress, onRefresh, onOpen, onConfirm, onAuth } as ZjuBridge)
