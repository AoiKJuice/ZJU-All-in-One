import type { BrowserWindow } from 'electron'
import type { NewsApi, NewsChannel, NewsHandlers } from '@shared/news'
import { newsHandlers, getNewsSettings } from './services/newsApi'
import { demoNews } from './services/demoNews'
import * as weread from './news/weread'
import { fetchDingtalk } from './news/dingtalk'
import { logDiagnostic } from './diagnostics'

// 桌面端的校园资讯通道：共用部分在 services/newsApi.ts（与安卓共用），这里接上只在桌面端的公众号（微信读书）与钉钉，
// 并补上 ipc.ts handler 的 win 参数；演示模式整体换成 services/demoNews.ts

type WithWin = { [K in NewsChannel]: (win: BrowserWindow | null, ...args: Parameters<NewsApi[K]>) => ReturnType<NewsApi[K]> }

export function newsChannels(demo: boolean): WithWin {
  const all: NewsHandlers = demo
    ? demoNews
    : {
        ...newsHandlers,
        'news:weread': () => weread.getState(),
        'news:wereadLogin': () => weread.getState(),
        'news:wereadLogout': () => weread.logout(),
        'news:wereadAdd': (url) => weread.addAccount(url),
        'news:wereadRemove': (id) => weread.removeAccount(id),
        'news:wechat': () => weread.fetchWechat(),
        'news:dingtalk': async () => {
          if (!(await getNewsSettings()).dingtalk) throw new Error('未开启')
          const feed = await fetchDingtalk()
          logDiagnostic('news-dingtalk', { notices: feed.items.length, failed: feed.failed.length })
          return feed
        }
      }
  const withWin = Object.fromEntries(
    Object.entries(all).map(([channel, fn]) => [channel, (_win: unknown, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args)])
  ) as WithWin
  // 登录要弹窗，挂在主窗口下
  if (!demo) withWin['news:wereadLogin'] = (win) => weread.login(win ?? undefined)
  return withWin
}
