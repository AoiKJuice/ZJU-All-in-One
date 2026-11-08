import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { NewsArticle, NewsFeed, NewsItem, NewsKind, NewsSettings, SztzActivity, WebSource, WereadState } from '@shared/news'
import { useApp } from '@renderer/store'
import { Choice, Joined, Reveal } from '@renderer/components/Type'
import { CloseButton, IconButton } from '@renderer/components/IconButton'
import { MOBILE } from '@renderer/lib/platform'
import { dur } from '@renderer/lib/motion'
import { SourcesSheet, type DingChat } from './SourcesSheet'
import { Chevron, SourcePick, dayText, whenText } from './bits'
import { Markdown } from './Markdown'
import './news.css'
import { swipeToClose } from '@renderer/lib/swipe'

const EASE = [0.22, 1, 0.36, 1] as const

type Loaded<T> = { data: T } | { error: string } | null
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')
const dataOf = <T,>(l: Loaded<T>): T | null => (l && 'data' in l ? l.data : null)

type Stage = 'joined' | 'open' | 'soon' | 'full' | 'over' | 'closed'
const STAGE: Record<Stage, string> = { joined: '已报名', open: '报名中', soon: '未开始', full: '已满', over: '已结束', closed: '报名截止' }

export function stageOf(a: SztzActivity, now = Date.now()): Stage {
  const t = (s: string | null): number => (s ? Date.parse(s) : NaN)
  if (t(a.end) < now) return 'over'
  if (a.joined) return 'joined'
  if (t(a.signupStart) > now) return 'soon'
  if (t(a.signupEnd) < now) return 'closed'
  if (a.quota !== null && a.signed >= a.quota) return 'full'
  return 'open'
}

/** 来源页签里再按出处分：官网按单位，公众号按号，钉钉按群（同名群按会话区分） */
const sourceKey = (item: NewsItem): string => (item.kind === 'dingtalk' ? (item.sourceId ?? item.from) : item.from.split(' · ')[0]!)
const sourceLabel = (item: NewsItem): string => item.from.split(' · ')[0]!

const TABS: { kind: NewsKind | 'all'; label: string; desktop?: boolean }[] = [
  { kind: 'all', label: '全部' },
  { kind: 'web', label: '官网' },
  { kind: 'sztz', label: '素拓' },
  { kind: 'wechat', label: '公众号', desktop: true },
  { kind: 'dingtalk', label: '钉钉', desktop: true }
]

/**
 * 工具「校园资讯」：左边通知（全部 / 官网 / 素拓 / 公众号 / 钉钉，按时间合并），右边素拓平台上立项的活动。
 * 来源（官网栏目、面向对象、公众号、模型判断、钉钉）在侧页里设。手机端顶部切换 通知 / 活动，没有公众号与钉钉
 */
export function NewsTool() {
  const epoch = useApp((s) => s.epoch)
  const loggedIn = useApp((s) => s.auth.loggedIn)
  const setLoginOpen = useApp((s) => s.setLoginOpen)
  const [settings, setSettings] = useState<NewsSettings | null>(null)
  const [sources, setSources] = useState<WebSource[]>([])
  const [weread, setWeread] = useState<WereadState | null>(null)
  const [feeds, setFeeds] = useState<Record<NewsKind, Loaded<NewsFeed>>>({ web: null, sztz: null, wechat: null, dingtalk: null })
  const [activities, setActivities] = useState<Loaded<SztzActivity[]>>(null)
  const [keyword, setKeyword] = useState('')
  const [tab, setTab] = useState<NewsKind | 'all'>('all')
  const [source, setSource] = useState<string | null>(null)
  const [view, setView] = useState<'notices' | 'activities'>('notices')
  const [reading, setReading] = useState<NewsItem | null>(null)
  const [activity, setActivity] = useState<SztzActivity | null>(null)
  const [sheet, setSheet] = useState<false | 'sources' | 'wechat'>(false)
  const [failedOpen, setFailedOpen] = useState(false)

  const load = useCallback((kind: NewsKind, force = false) => {
    setFeeds((f) => ({ ...f, [kind]: f[kind] && 'data' in f[kind]! ? f[kind] : null }))
    const call =
      kind === 'web' ? window.zju['news:web'](force) : kind === 'sztz' ? window.zju['news:sztzNotices']() : kind === 'wechat' ? window.zju['news:wechat']() : window.zju['news:dingtalk']()
    void call.then(
      (data) => setFeeds((f) => ({ ...f, [kind]: { data } })),
      (e) => setFeeds((f) => ({ ...f, [kind]: { error: errorText(e) } }))
    )
  }, [])

  const loadActivities = useCallback((word: string) => {
    void window.zju['news:activities'](word || undefined).then(
      (data) => setActivities({ data }),
      (e) => setActivities({ error: errorText(e) })
    )
  }, [])

  useEffect(() => {
    void window.zju['news:settings']().then(setSettings)
    void window.zju['news:sources']().then(setSources)
    if (!MOBILE) void window.zju['news:weread']().then(setWeread)
  }, [])

  useEffect(() => {
    load('web')
    load('sztz')
    loadActivities('')
  }, [epoch, load, loadActivities])

  useEffect(() => {
    if (!MOBILE && weread?.status === 'ok') load('wechat')
  }, [weread?.status, weread?.accounts.length, load])

  useEffect(() => {
    if (!MOBILE && settings?.dingtalk) load('dingtalk')
  }, [settings?.dingtalk, load])

  // 搜活动：输入停顿后再请求
  useEffect(() => {
    const timer = setTimeout(() => loadActivities(keyword.trim()), 450)
    return () => clearTimeout(timer)
  }, [keyword, loadActivities])

  // 先在界面上改（连着勾几项时，下一项按已改的状态算），回来的结果只认最后一次的，免得早回来的把后面的勾选冲掉
  const saving = useRef(0)
  const updateSettings = async (patch: Parameters<(typeof window.zju)['news:setSettings']>[0]): Promise<void> => {
    const local = patch
    setSettings((s) => (s ? { ...s, ...local } : s))
    const mine = ++saving.current
    const next = await window.zju['news:setSettings'](patch)
    if (mine === saving.current) setSettings(next)
    if ('sources' in patch || 'audience' in patch) load('web', true)
  }

  const tabs = TABS.filter((t) => !(MOBILE && t.desktop) && !(t.kind === 'dingtalk' && !settings?.dingtalk))

  // 钉钉：用户在来源里取消勾选的会话不看
  const hiddenChats = useMemo(() => new Set(settings?.dingtalkHidden ?? []), [settings?.dingtalkHidden])
  const items = useMemo(() => {
    const kinds: NewsKind[] = tab === 'all' ? ['web', 'sztz', 'wechat', 'dingtalk'] : [tab]
    return kinds
      .flatMap((k) => dataOf(feeds[k])?.items ?? [])
      .filter((item) => item.kind !== 'dingtalk' || !hiddenChats.has(item.sourceId ?? ''))
      .sort((a, b) => (b.time ?? '').slice(0, 10).localeCompare((a.time ?? '').slice(0, 10)) || (b.time ?? '').localeCompare(a.time ?? ''))
  }, [feeds, tab, hiddenChats])

  // 本机钉钉的全部会话（含不看的），给来源侧页勾选；最近有消息的在前
  const dingChats = useMemo<DingChat[]>(() => {
    const map = new Map<string, DingChat>()
    for (const item of dataOf(feeds.dingtalk)?.items ?? []) {
      const id = item.sourceId ?? item.from
      const chat = map.get(id) ?? { id, name: sourceLabel(item), count: 0, latest: '', single: id.includes(':') }
      chat.count++
      if ((item.time ?? '') > chat.latest) chat.latest = item.time ?? ''
      map.set(id, chat)
    }
    return [...map.values()].sort((a, b) => b.latest.localeCompare(a.latest))
  }, [feeds.dingtalk])

  // 当前页签里的出处与条数（多的在前），给表头的出处下拉；全部页签不分
  const sourceList = useMemo(() => {
    if (tab === 'all') return []
    const map = new Map<string, { key: string; label: string; count: number }>()
    for (const item of items) {
      const key = sourceKey(item)
      const entry = map.get(key) ?? { key, label: sourceLabel(item), count: 0 }
      entry.count++
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'))
  }, [items, tab])
  const activeSource = source && sourceList.some((s) => s.key === source) ? source : null
  const shown = activeSource ? items.filter((item) => sourceKey(item) === activeSource) : items
  const { limit, sentinel } = useGrow(`${tab}/${activeSource ?? ''}`)

  const failed = useMemo(() => {
    const kinds: NewsKind[] = tab === 'all' ? ['web', 'sztz', 'wechat', 'dingtalk'] : [tab]
    return kinds.flatMap((k) => {
      const f = feeds[k]
      if (!f) return []
      if ('error' in f) return k === 'dingtalk' && f.error === '未开启' ? [] : [{ from: TABS.find((t) => t.kind === k)!.label, message: f.error }]
      return f.data.failed
    })
  }, [feeds, tab])

  const loading = (tab === 'all' ? (['web', 'sztz'] as NewsKind[]) : [tab]).some((k) => feeds[k] === null)
  const refresh = (): void => {
    for (const k of tab === 'all' ? (['web', 'sztz', 'wechat', 'dingtalk'] as NewsKind[]) : [tab]) {
      if (k === 'wechat' && weread?.status !== 'ok') continue
      if (k === 'dingtalk' && !settings?.dingtalk) continue
      if (MOBILE && (k === 'wechat' || k === 'dingtalk')) continue
      load(k, true)
    }
  }

  /** 空状态：「无」加下一步 */
  const empty = (): ReactNode => {
    const sztzLogin = !loggedIn && !import.meta.env.VITE_ZJU_DEMO && (tab === 'sztz' || tab === 'all')
    if (sztzLogin && !items.length)
      return (
        <Empty>
          <button className="btn btn-solid" data-login-toggle onClick={() => setLoginOpen(true)}>
            登录
          </button>
        </Empty>
      )
    if (tab === 'web' && settings && !settings.sources.length)
      return (
        <Empty>
          <button className="btn btn-solid" onClick={() => setSheet('sources')}>
            选择来源
          </button>
        </Empty>
      )
    if (tab === 'wechat' && weread && weread.status !== 'ok')
      return (
        <Empty>
          <button className="btn btn-solid" onClick={() => setSheet('wechat')}>
            {weread.status === 'signedOut' ? '扫码登录微信读书' : weread.status === 'expired' ? '重新扫码登录' : '查看限制'}
          </button>
        </Empty>
      )
    if (tab === 'wechat' && weread && !weread.accounts.length)
      return (
        <Empty>
          <button className="btn btn-solid" onClick={() => setSheet('wechat')}>
            添加公众号
          </button>
        </Empty>
      )
    return <Empty />
  }

  const noticePanel = (
    <section className="panel news-panel news-notices">
      <header className="news-head">
        <div className="news-tabs" role="tablist">
          {tabs.map((t) => (
            <Choice
              key={t.kind}
              group="news-tab"
              active={tab === t.kind}
              onClick={() => {
                setTab(t.kind)
                setSource(null)
              }}
            >
              {t.label}
            </Choice>
          ))}
        </div>
        <span className="news-head-tools">
          {sourceList.length > 1 && (
            <SourcePick options={sourceList} total={items.length} value={activeSource} onChange={setSource} />
          )}
          <IconButton label="刷新" onClick={refresh}>
            <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
            <path d="M19.5 4.5v4h-4" />
          </IconButton>
          <IconButton label="来源" onClick={() => setSheet('sources')}>
            <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" />
            <circle cx="15" cy="7" r="2" />
            <circle cx="9" cy="12" r="2" />
            <circle cx="17" cy="17" r="2" />
          </IconButton>
        </span>
      </header>
      {failed.length > 0 && (
        <div className="news-failed">
          <button className="news-failed-toggle" data-open={failedOpen || undefined} onClick={() => setFailedOpen((o) => !o)}>
            {failed.length} 处未取到
            <Chevron />
          </button>
          <AnimatePresence initial={false}>
            {failedOpen && (
              <motion.ul
                className="news-failed-list"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: dur(0.35), ease: EASE }}
              >
                {/* 同一原因的归在一起：原因一行，下面列出是哪些栏目 */}
                {byReason(failed).map(([why, list]) => (
                  <li key={why}>
                    <span className="news-failed-why">
                      {why}
                      <span className="news-failed-n">{list.length}</span>
                    </span>
                    <span className="news-failed-from">{list.map((f) => f.from).join('、')}</span>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
      <div className="pane-scroll news-scroll">
        {loading && !items.length ? (
          <p className="quiet">…</p>
        ) : shown.length ? (
          <ul className="news-cards">
            {shown.slice(0, limit).map((item) => (
              <li key={item.id}>
                <button className="news-card news-note" onClick={() => setReading(item)}>
                  <span className="news-card-title">{item.title}</span>
                  <span className="news-card-meta">
                    <Joined parts={[item.time && dayText(item.time), ...item.from.split(' · ')]} />
                  </span>
                </button>
              </li>
            ))}
            {shown.length > limit && <li ref={sentinel} className="news-more" aria-hidden />}
          </ul>
        ) : (
          empty()
        )}
      </div>
    </section>
  )

  const list = dataOf(activities)
  const activityPanel = (
    <section className="panel news-panel news-acts">
      <header className="news-head">
        <h2 className="news-title">活动</h2>
        <label className="news-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20l-4.5-4.5" />
          </svg>
          <input className="field" value={keyword} placeholder="活动名称、立项单位" onChange={(e) => setKeyword(e.target.value)} />
        </label>
      </header>
      <div className="pane-scroll news-scroll">
        {activities === null ? (
          <p className="quiet">…</p>
        ) : 'error' in activities ? (
          !loggedIn && !import.meta.env.VITE_ZJU_DEMO ? (
            <Empty>
              <button className="btn btn-solid" data-login-toggle onClick={() => setLoginOpen(true)}>
                登录
              </button>
            </Empty>
          ) : (
            <Empty text={activities.error}>
              <button className="btn" onClick={() => loadActivities(keyword.trim())}>
                重试
              </button>
            </Empty>
          )
        ) : list && list.length ? (
          <ul className="news-cards">
            {list.map((a) => (
              <li key={a.id}>
                <ActivityCard activity={a} onOpen={() => setActivity(a)} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            {keyword && (
              <button className="btn" onClick={() => setKeyword('')}>
                清除搜索
              </button>
            )}
          </Empty>
        )}
      </div>
    </section>
  )

  return (
    <div className="news">
      {MOBILE && (
        <div className="news-switch">
          <Choice group="news-view" active={view === 'notices'} onClick={() => setView('notices')}>
            通知
          </Choice>
          <Choice group="news-view" active={view === 'activities'} onClick={() => setView('activities')}>
            活动
          </Choice>
        </div>
      )}
      <div className="news-main">
        {(!MOBILE || view === 'notices') && (
          <Reveal i={1} flat className="news-col news-col-notices">
            {noticePanel}
          </Reveal>
        )}
        {(!MOBILE || view === 'activities') && (
          <Reveal i={2} flat className="news-col news-col-acts">
            {activityPanel}
          </Reveal>
        )}
      </div>

      <Sheet open={reading !== null} onClose={() => setReading(null)}>
        {reading && <Reader item={reading} />}
      </Sheet>
      <Sheet open={activity !== null} onClose={() => setActivity(null)}>
        {activity && <ActivityDetail activity={activity} />}
      </Sheet>
      <Sheet open={sheet !== false} onClose={() => setSheet(false)}>
        {settings && (
          <SourcesSheet
            focus={sheet === 'wechat' ? 'wechat' : undefined}
            settings={settings}
            sources={sources}
            weread={weread}
            dingChats={dingChats}
            onSettings={updateSettings}
            onWeread={setWeread}
          />
        )}
      </Sheet>
    </div>
  )
}

/** 未取到的来源按原因归组，多的在前 */
function byReason(failed: { from: string; message: string }[]): [string, { from: string; message: string }[]][] {
  const groups = new Map<string, { from: string; message: string }[]>()
  for (const f of failed) groups.set(f.message, [...(groups.get(f.message) ?? []), f])
  return [...groups].sort((a, b) => b[1].length - a[1].length)
}

/** 长列表分批画：先画 200 条，滚到底再加 200 条；换页签、换出处时从头来 */
function useGrow(key: string): { limit: number; sentinel: (el: HTMLLIElement | null) => void } {
  const STEP = 200
  const [state, setState] = useState({ key, limit: STEP })
  const limit = state.key === key ? state.limit : STEP
  const observer = useRef<IntersectionObserver | null>(null)
  const sentinel = useCallback(
    (el: HTMLLIElement | null) => {
      observer.current?.disconnect()
      if (!el) return
      observer.current = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) setState((s) => ({ key, limit: (s.key === key ? s.limit : STEP) + STEP }))
      }, { rootMargin: '400px' })
      observer.current.observe(el)
    },
    [key]
  )
  useEffect(() => () => observer.current?.disconnect(), [])
  return { limit, sentinel }
}

function Empty({ text = '无', children }: { text?: string; children?: ReactNode }) {
  return (
    <div className="news-empty">
      <p className="quiet">{text}</p>
      {children}
    </div>
  )
}

function ActivityCard({ activity: a, onOpen }: { activity: SztzActivity; onOpen: () => void }) {
  const stage = stageOf(a)
  return (
    <button className="news-card" data-stage={stage} onClick={onOpen}>
      <span className="news-card-top">
        <span className="news-card-title">{a.title}</span>
        {(stage === 'joined' || stage === 'open') && (
          <span className="news-pill" data-tone={stage === 'joined' ? 'solid' : undefined}>
            {STAGE[stage]}
          </span>
        )}
      </span>
      <span className="news-card-meta">
        <Joined parts={[whenText(a.start), a.place && !a.org.includes(a.place) ? a.place : null, a.org]} />
      </span>
      <span className="news-card-meta">
        <Joined
          parts={[
            a.points ? `${a.points} 记点` : null,
            a.quota !== null ? `${a.signed}/${a.quota} 人` : `已报 ${a.signed} 人`,
            a.external ? '平台外报名' : null,
            stage !== 'open' && stage !== 'joined' ? STAGE[stage] : null
          ]}
        />
      </span>
    </button>
  )
}

/** 起止：同一天只写一次日期 */
function span(from: string | null, to: string | null): string {
  if (!from || !to) return whenText(from ?? to)
  const same = new Date(from).toDateString() === new Date(to).toDateString()
  return `${whenText(from)} – ${same ? new Date(to).toTimeString().slice(0, 5) : whenText(to)}`
}

function ActivityDetail({ activity: a }: { activity: SztzActivity }) {
  const stage = stageOf(a)
  const rows: [string, ReactNode][] = [
    ['活动', span(a.start, a.end)],
    ['报名', span(a.signupStart, a.signupEnd)],
    ['地点', a.place],
    ['记点', a.points ? `${a.points}` : ''],
    ['名额', a.quota !== null ? `${a.signed}/${a.quota} 人` : `不限，已报 ${a.signed} 人`],
    ['类别', [a.category, a.type].filter(Boolean).join(' ')],
    ['联系', a.contact]
  ]
  return (
    <>
      <h2 className="sheet-title">{a.title}</h2>
      <p className="sheet-meta">
        <Joined parts={[a.org, STAGE[stage]]} />
      </p>
      <div className="sheet-body pane-scroll">
        <dl className="news-facts">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        {a.external && (
          <section className="news-block news-block-hot">
            <h3 className="group-title">{a.signup || '报名方式'}</h3>
            <p className="news-text">{a.external}</p>
          </section>
        )}
        {a.intro && (
          <section className="news-block">
            <h3 className="group-title">简介</h3>
            <p className="news-text">{a.intro}</p>
          </section>
        )}
        {a.notes && (
          <section className="news-block">
            <h3 className="group-title">注意事项</h3>
            <p className="news-text">{a.notes}</p>
          </section>
        )}
        <div className="news-sheet-acts">
          <a className="btn btn-solid" href="https://sztz.zju.edu.cn/dekt/" target="_blank" rel="noreferrer">
            {a.external || stage !== 'open' ? '在素拓平台查看' : '去素拓平台报名'}
          </a>
        </div>
      </div>
    </>
  )
}

/** 消息第一行就是标题（Markdown 的 # 标题、加粗的一行）时，侧页标题已经写了，正文里去掉 */
function withoutTitle(text: string, title: string): string {
  const [first = '', ...rest] = text.split('\n')
  const plain = first.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/(\*\*|__)/g, '').trim()
  return plain && plain === title.trim() ? rest.join('\n').replace(/^\s+/, '') : text
}

function Reader({ item }: { item: NewsItem }) {
  const [article, setArticle] = useState<Loaded<NewsArticle>>(item.text ? { data: { title: null, text: item.text } } : null)
  useEffect(() => {
    if (item.text || !item.url || item.kind === 'sztz') return
    let alive = true
    void window.zju['news:article'](item.url).then(
      (data) => alive && setArticle({ data }),
      (e) => alive && setArticle({ error: errorText(e) })
    )
    return () => {
      alive = false
    }
  }, [item])
  const text = dataOf(article)?.text
  return (
    <>
      <div className="news-reader-head">
        <h2 className="sheet-title">{item.title}</h2>
        {item.url && (
          <a className="icon-btn" href={item.url} target="_blank" rel="noreferrer" aria-label="原网页" title="原网页">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 5h5v5M19 5l-8 8" />
              <path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
            </svg>
          </a>
        )}
      </div>
      <p className="sheet-meta">
        <Joined parts={[...item.from.split(' · '), item.kind === 'dingtalk' ? whenText(item.time) : dayText(item.time)]} />
      </p>
      <div className="sheet-body pane-scroll">
        {article === null ? (
          <p className="quiet">…</p>
        ) : 'error' in article ? (
          <p className="quiet">{article.error}</p>
        ) : item.kind === 'dingtalk' ? (
          text && <Markdown text={withoutTitle(text, item.title)} className="news-md" />
        ) : (
          text?.split(/\n+/).map((p, i) => (
            <p key={i} className="news-text">
              {p}
            </p>
          ))
        )}
      </div>
    </>
  )
}

/** 本工具自己的侧页（右侧滑出，挂到 body）；Esc、点遮罩、关闭都能收起 */
function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="veil" className="sheet-veil" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside key="sheet" className="sheet local-sheet news-sheet" {...swipeToClose(onClose)} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: dur(0.6), ease: EASE }}>
            <CloseButton className="news-sheet-close" onClick={onClose} />
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
