import type { BrowserWindow } from 'electron'
import type { LibraryApi, LibraryChannel, LibraryHandlers } from '@shared/library'
import { libraryHandlers } from './services/libraryApi'
import { demoLibrary } from './services/demoLibrary'
import { getLibPresets, getLibWatches, removeLibPreset, removeLibWatch, saveLibPreset, saveLibWatch } from './libwatch'

// 桌面端的图书馆预约通道：通道实现在 services/libraryApi.ts（与安卓共用），这里接上订阅与套餐并补上 ipc.ts handler 的 win 参数；
// 演示模式换成 services/demoLibrary.ts，订阅仍走 libwatch（它经 call 查余座，查到的也是演示数据）

type WithWin = { [K in LibraryChannel]: (win: BrowserWindow | null, ...args: Parameters<LibraryApi[K]>) => ReturnType<LibraryApi[K]> }

export function libraryChannels(demo: boolean): WithWin {
  const all: LibraryHandlers = {
    ...(demo ? demoLibrary : libraryHandlers),
    'lib:watches': async () => getLibWatches(),
    'lib:watch': (input) => saveLibWatch(input),
    'lib:unwatch': (id) => removeLibWatch(id),
    'lib:presets': async () => getLibPresets(),
    'lib:savePreset': (input) => saveLibPreset(input),
    'lib:removePreset': (id) => removeLibPreset(id)
  }
  return Object.fromEntries(
    Object.entries(all).map(([channel, fn]) => [channel, (_win: unknown, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args)])
  ) as WithWin
}
