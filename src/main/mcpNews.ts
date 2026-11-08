import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { McpToolGroup } from '@shared/types'
import type { NewsFeed, NewsItem } from '@shared/news'
import { call } from './ipc'

// 校园资讯的 MCP 工具（由 mcp.ts 的 buildServer 调用）：只读，归查询组。素拓活动的报名 / 收藏是平台写操作，不提供。
// 钉钉消息只在用户开了实验开关时可取；返回里不含账号信息

const json = (value: unknown): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }]
})

const read = { readOnlyHint: true, openWorldHint: true }

const brief = (i: NewsItem): Record<string, unknown> => ({ title: i.title, time: i.time, from: i.from, url: i.url, ...(i.text ? { text: i.text.slice(0, 500) } : {}) })
const briefFeed = (f: NewsFeed, limit: number): Record<string, unknown> => ({ items: f.items.slice(0, limit).map(brief), failed: f.failed, hidden: f.hidden })

export function registerNewsTools(mcp: McpServer, tools: Record<McpToolGroup, boolean>): void {
  if (!tools.query) return

  mcp.registerTool('get_campus_activities', {
    description:
      '校园资讯：素拓数智平台上立项的活动（组织单位开展记点活动前必须在此立项）。每项含组织单位、类别、活动与报名起止、地点、招募人数 quota（null 为不限）/ 已报名 signed、记点范围 points、简介；external 非空表示不在本平台报名，写的是具体报名方式。未结束的在前。不记点的活动、社团内部活动与招新不在这里',
    inputSchema: { keyword: z.string().optional().describe('搜活动名称或立项单位') },
    annotations: read
  }, async ({ keyword }) => json(await call('news:activities', keyword)))

  mcp.registerTool('get_campus_notices', {
    description:
      '校园资讯：通知合并列表。source 选来源：sztz 素拓平台通知；web 用户关注的部处与学院官网栏目（已按规则过滤掉面向教职工的）；wechat 用户在应用里添加的公众号文章（需已登录微信读书）；dingtalk 本机钉钉里用户留着的群聊、单聊、工作通知的消息（实验，用户开启时才有；from 为「会话 · 发送人」，text 可能是 Markdown）',
    inputSchema: {
      source: z.enum(['sztz', 'web', 'wechat', 'dingtalk']).default('web'),
      limit: z.number().int().min(1).max(200).default(50)
    },
    annotations: read
  }, async ({ source, limit }) => {
    const channel = { sztz: 'news:sztzNotices', web: 'news:web', wechat: 'news:wechat', dingtalk: 'news:dingtalk' } as const
    const feed = await call(channel[source])
    if (source !== 'dingtalk') return json(briefFeed(feed, limit))
    // 钉钉只给用户在界面里留着的会话
    const hidden = new Set((await call('news:settings')).dingtalkHidden)
    return json(briefFeed({ ...feed, items: feed.items.filter((i) => !hidden.has(i.sourceId ?? '')) }, limit))
  })

  mcp.registerTool('get_campus_news_sources', {
    description: '校园资讯：官网来源表（部处与学院的栏目、面向对象 audience、收录依据 basis），以及用户当前关注的来源 id（followed）',
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async () => {
    const [sources, settings] = await Promise.all([call('news:sources'), call('news:settings')])
    return json({ followed: settings.sources, audience: settings.audience, sources })
  })

  mcp.registerTool('read_campus_article', {
    description: '校园资讯：读取一条通知的正文文字（只限 *.zju.edu.cn 网页与公众号文章）',
    inputSchema: { url: z.string().url() },
    annotations: read
  }, async ({ url }) => json(await call('news:article', url)))
}
