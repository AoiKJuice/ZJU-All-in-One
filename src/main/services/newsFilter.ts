import { loadSecret, readConfig, writeConfig } from '../secure'

// 校园资讯：官网栏目筛完后的条目级过滤。先按规则判（明确面向教职工 / 采购招标 / 科研管理的去掉，明确面向学生的留下），
// 判不准的：用户在设置里开了「模型判断」且存了 DeepSeek 密钥时，只把标题（公开信息）送 DeepSeek Flash 判断，否则一律保留。
// 判断结果按标题缓存（news-judged.json，只存标题的哈希与结论），同一标题不再重复送。

export type Verdict = 'keep' | 'drop' | 'unsure'

/** 明确面向教职工、行政事务的 */
const DROP = /教职工|教师(?!节)|职工|人才引进|招聘(?!会|信息|宣讲)|博士后|职称|岗位聘任|聘用|干部|任前公示|拟任|任职|离退休|老同志|工会|采购|招标|中标|询价|比选|成交|竞价|遴选.*供应|审计|基建|工程(?:招|验收)|物业|资产处置|科研项目|课题申报|基金申报|国家自然科学基金|社科基金|学科评估|重点实验室|党支部换届|党费|巡察|廉政|统战|民主党派|政协|人大代表/
/** 明确面向学生的 */
const KEEP = /学生|本科|研究生|博士生|硕士生|新生|毕业生|同学|报名|讲座|报告会|学术报告|论坛|沙龙|竞赛|大赛|挑战杯|奖学金|助学|资助|勤工|评优|评奖|荣誉称号|选课|考试|补考|缓考|课程|培养方案|学籍|转专业|推免|保研|夏令营|交流项目|交换|实习|就业|宣讲|招募|志愿|第二课堂|素拓|社会实践|军训|宿舍|寝室|心理|体测|四六级|CET|图书馆|校车|放假|停水|停电|开放日|活动|比赛|展览|演出|观影/

export function judgeByRules(title: string): Verdict {
  const drop = DROP.test(title)
  const keep = KEEP.test(title)
  if (drop && !/学生|本科|研究生|同学/.test(title)) return 'drop'
  if (keep) return 'keep'
  if (drop) return 'drop'
  return 'unsure'
}

const KEY_FILE = 'news-llm-key.bin'
const CACHE_FILE = 'news-judged.json'

/** 标题的短哈希（FNV-1a），缓存里不存标题原文 */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

let cache: Record<string, 0 | 1> | null = null
const loadCache = (): Record<string, 0 | 1> => (cache ??= readConfig<Record<string, 0 | 1>>(CACHE_FILE) ?? {})

/** 用 DeepSeek Flash 判断一批标题是否与在校学生相关；失败时返回 null（调用方按保留处理） */
async function askModel(titles: string[]): Promise<boolean[] | null> {
  const key = await loadSecret(KEY_FILE).catch(() => null)
  if (!key) return null
  const list = titles.map((t, i) => `${i + 1}. ${t}`).join('\n')
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-flash',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            '你在帮浙江大学的学生筛选学院与部门官网上的通知标题。对每个标题判断：这条通知是否可能需要在校学生（本科生或研究生）阅读或行动（报名、申请、参加、注意事项）。只面向教职工、行政管理、采购、科研管理、党政事务的判为 0，与学生相关的判为 1。只输出一个 JSON 数组，按顺序给出 0 或 1，不要其他文字。'
        },
        { role: 'user', content: list }
      ]
    })
  })
  if (!response.ok) return null
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] }
  const match = /\[[\s\S]*\]/.exec(body.choices?.[0]?.message?.content ?? '')
  if (!match) return null
  const parsed = JSON.parse(match[0]) as unknown[]
  return parsed.length === titles.length ? parsed.map((x) => Number(x) === 1) : null
}

/**
 * 给一批标题下结论：规则能判的直接判；判不准的在 useModel 时问模型（缓存过的不再问），否则保留。
 * 返回每个标题是否保留，以及哪些是模型判断后保留的
 */
export async function filterTitles(titles: string[], useModel: boolean): Promise<{ keep: boolean[]; judged: boolean[] }> {
  const verdicts = titles.map(judgeByRules)
  const keep = verdicts.map((v) => v !== 'drop')
  const judged = titles.map(() => false)
  if (!useModel) return { keep, judged }

  const store = loadCache()
  const ask: number[] = []
  verdicts.forEach((v, i) => {
    if (v !== 'unsure') return
    const known = store[hash(titles[i])]
    if (known === undefined) ask.push(i)
    else {
      keep[i] = known === 1
      judged[i] = true
    }
  })
  let dirty = false
  for (let start = 0; start < ask.length; start += 40) {
    const batch = ask.slice(start, start + 40)
    const answers = await askModel(batch.map((i) => titles[i])).catch(() => null)
    if (!answers) break
    batch.forEach((i, k) => {
      keep[i] = answers[k]
      judged[i] = true
      store[hash(titles[i])] = answers[k] ? 1 : 0
      dirty = true
    })
  }
  if (dirty) await writeConfig(CACHE_FILE, store).catch(() => {})
  return { keep, judged }
}

export const LLM_KEY_FILE = KEY_FILE
