import type { ZjuBridge } from '@shared/ipc'

declare global {
  interface Window {
    zju: ZjuBridge
  }
}

export {}
