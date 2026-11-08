import type { NewsHandlers, NewsSettings, NewsSettingsPatch } from '@shared/news'
import { clearSecret, loadSecret, readConfig, saveSecret, writeConfig } from '../secure'
import { fetchActivities, fetchSztzNotices } from './newsSztz'
import { allSources, defaultSources, fetchArticle, fetchWebFeed } from './newsWeb'
import { LLM_KEY_FILE } from './newsFilter'
import { studentId } from './zdbk'

// 校园资讯的通道实现（桌面 newsIpc.ts 与安卓 bridge.ts 共用）。公众号（微信读书）与钉钉只在桌面端，见 main/news/

/** 只在桌面端的通道 */
export type NewsLocalChannel = 'news:weread' | 'news:wereadLogin' | 'news:wereadLogout' | 'news:wereadAdd' | 'news:wereadRemove' | 'news:wechat' | 'news:dingtalk'

export type NewsCoreHandlers = Omit<NewsHandlers, NewsLocalChannel>

const FILE = 'news-settings.json'

type Stored = Omit<NewsSettings, 'llmKey'>

/** 没选过「面向」时按学号推断：浙大本科学号 3 开头，研究生 1 / 2 开头；取不到学号时为全部（不写入，下次再推断）。
 *  原先默认「全部」，本科生会看到研工部的整栏通知 */
async function inferAudience(): Promise<NewsSettings['audience']> {
  const id = await studentId().catch(() => '')
  if (/^3\d{9}$/.test(id)) return 'undergrad'
  if (/^[12]\d{7,}$/.test(id)) return 'grad'
  return 'all'
}

async function getSettings(): Promise<NewsSettings> {
  const stored = readConfig<Partial<Stored>>(FILE) ?? {}
  const known = new Set(allSources().map((s) => s.id))
  return {
    sources: (stored.sources ?? defaultSources()).filter((id) => known.has(id)),
    audience: stored.audience ?? (await inferAudience()),
    llm: stored.llm ?? false,
    llmKey: Boolean(await loadSecret(LLM_KEY_FILE).catch(() => null)),
    dingtalk: stored.dingtalk ?? false,
    dingtalkHidden: Array.isArray(stored.dingtalkHidden) ? stored.dingtalkHidden.filter((id) => typeof id === 'string') : []
  }
}

/** 写设置排队进行：连着勾几项时各次「读文件 → 合并 → 写回」不交错，后写的不会把先写的盖掉 */
let writing: Promise<unknown> = Promise.resolve()

async function setSettings(patch: NewsSettingsPatch): Promise<NewsSettings> {
  const run = writing.then(async () => {
    const { llmKey, ...rest } = patch
    if (llmKey === null) await clearSecret(LLM_KEY_FILE)
    else if (typeof llmKey === 'string' && llmKey.trim()) await saveSecret(LLM_KEY_FILE, llmKey.trim())
    // 只合并文件里已有的项：没设过的（面向、关注的来源）照旧按默认与推断，也不在写入前去取学号（要走网络，慢）
    await writeConfig(FILE, { ...(readConfig<Partial<Stored>>(FILE) ?? {}), ...rest })
  })
  writing = run.catch(() => undefined)
  await run
  return getSettings()
}

export const newsHandlers: NewsCoreHandlers = {
  'news:activities': (keyword) => fetchActivities(keyword),
  'news:sztzNotices': () => fetchSztzNotices(),
  'news:web': async (force) => fetchWebFeed(await getSettings(), force),
  'news:sources': async () => allSources(),
  'news:article': (url) => fetchArticle(url),
  'news:settings': () => getSettings(),
  'news:setSettings': (patch) => setSettings(patch)
}

export { getSettings as getNewsSettings }
