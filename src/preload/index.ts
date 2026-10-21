import { contextBridge, ipcRenderer } from 'electron'
import { ZJU_CHANNELS, type ZjuApi } from '@shared/ipc'

const api = Object.fromEntries(
  ZJU_CHANNELS.map((channel) => [channel, () => ipcRenderer.invoke(channel)])
) as unknown as ZjuApi

contextBridge.exposeInMainWorld('zju', api)
