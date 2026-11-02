import type { BrowserWindow } from 'electron'
import type { XkApi, XkChannel, XkHandlers } from '@shared/xk'
import { xkHandlers } from './services/xkApi'
import { demoXk } from './services/demoXk'
import { addWatch, getWatches, removeWatch } from './xkwatch'

// 桌面端的选课通道：通道实现在 services/xkApi.ts（与安卓共用），这里接上订阅并补上 ipc.ts handler 的 win 参数；
// 演示模式换成 services/demoXk.ts，订阅仍走 xkwatch（它经 call 查余量，查到的也是演示数据）

type WithWin = { [K in XkChannel]: (win: BrowserWindow | null, ...args: Parameters<XkApi[K]>) => ReturnType<XkApi[K]> }

export function xkChannels(demo: boolean): WithWin {
  const all: XkHandlers = {
    ...(demo ? demoXk : xkHandlers),
    'xk:watches': async () => getWatches(),
    'xk:watch': (course, section, auto) => addWatch(course, section, auto),
    'xk:unwatch': (sectionId) => removeWatch(sectionId)
  }
  return Object.fromEntries(
    Object.entries(all).map(([channel, fn]) => [channel, (_win: unknown, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args)])
  ) as WithWin
}
