import type { ZjuApi } from '@shared/ipc'

declare global {
  interface Window {
    zju: ZjuApi
  }
}

export {}
