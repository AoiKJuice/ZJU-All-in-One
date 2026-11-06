import type { NewsHandlers, NewsSettings, NewsSettingsPatch } from '@shared/news'
import { clearSecret, loadSecret, readConfig, saveSecret, writeConfig } from '../secure'
import { fetchActivities, fetchSztzNotices } from './newsSztz'
import { allSources, defaultSources, fetchArticle, fetchWebFeed } from './newsWeb'
import { LLM_KEY_FILE } from './newsFilter'

// 校园资讯的通道实现（桌面 newsIpc.ts 与安卓 bridge.ts 共用）。公众号（微信读书）与钉钉只在桌面端，见 main/news/

/** 只在桌面端的通道 */
export type NewsLocalChannel = 'news:weread' | 'news:wereadLogin' | 'news:wereadLogout' | 'news:wereadAdd' | 'news:wereadRemove' | 'news:wechat' | 'news:dingtalk'

export type NewsCoreHandlers = Omit<NewsHandlers, NewsLocalChannel>

const FILE = 'news-settings.json'

type Stored = Omit<NewsSettings, 'llmKey'>

async function getSettings(): Promise<NewsSettings> {
  const stored = readConfig<Partial<Stored>>(FILE) ?? {}
  const known = new Set(allSources().map((s) => s.id))
  return {
    sources: (stored.sources ?? defaultSources()).filter((id) => known.has(id)),
    audience: stored.audience ?? 'all',
    llm: stored.llm ?? false,
    llmKey: Boolean(await loadSecret(LLM_KEY_FILE).catch(() => null)),
    dingtalk: stored.dingtalk ?? false
  }
}

async function setSettings(patch: NewsSettingsPatch): Promise<NewsSettings> {
  const { llmKey, ...rest } = patch
  if (llmKey === null) await clearSecret(LLM_KEY_FILE)
  else if (typeof llmKey === 'string' && llmKey.trim()) await saveSecret(LLM_KEY_FILE, llmKey.trim())
  const current = await getSettings()
  const { llmKey: _, ...stored } = { ...current, ...rest }
  await writeConfig(FILE, stored)
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
