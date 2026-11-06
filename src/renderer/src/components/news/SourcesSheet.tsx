import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { NewsAudience, NewsSettings, NewsSettingsPatch, WebSource, WereadState } from '@shared/news'
import { useApp } from '@renderer/store'
import { Choice } from '@renderer/components/Type'
import { IconButton } from '@renderer/components/IconButton'
import { MOBILE } from '@renderer/lib/platform'
import { dur } from '@renderer/lib/motion'
import { Chevron, dayText } from './bits'

const EASE = [0.22, 1, 0.36, 1] as const
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

const AUDIENCE: { value: NewsAudience; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'undergrad', label: '本科' },
  { value: 'grad', label: '研究生' }
]

const GROUPS: { kind: WebSource['kind'][]; label: string }[] = [
  { kind: ['office'], label: '部处' },
  { kind: ['college', 'campus'], label: '学院' }
]

type Mark = 'on' | 'partial' | undefined

function Box({ mark }: { mark: Mark }) {
  return (
    <span className="news-box" data-mark={mark} aria-hidden>
      {mark === 'on' && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 12.5l4 4 8-9" />
        </svg>
      )}
      {mark === 'partial' && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M7 12h10" />
        </svg>
      )}
    </span>
  )
}

/** 来源侧页：面向对象、官网栏目（按单位勾选，展开到栏目）、公众号（桌面）、模型判断、钉钉（桌面实验） */
export function SourcesSheet(props: {
  focus?: 'wechat'
  settings: NewsSettings
  sources: WebSource[]
  weread: WereadState | null
  onSettings: (patch: NewsSettingsPatch) => Promise<void>
  onWeread: (state: WereadState) => void
}) {
  const { settings, sources, onSettings } = props
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const wechatRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (props.focus === 'wechat') wechatRef.current?.scrollIntoView({ block: 'start' })
  }, [props.focus])

  const chosen = useMemo(() => new Set(settings.sources), [settings.sources])
  const orgs = useMemo(() => {
    const map = new Map<string, WebSource[]>()
    for (const s of sources) map.set(s.org, [...(map.get(s.org) ?? []), s])
    return [...map.entries()].map(([org, list]) => ({ org, kind: list[0].kind, list }))
  }, [sources])
  const q = query.trim()
  const visible = orgs.filter((o) => !q || o.org.includes(q) || o.list.some((s) => s.column.includes(q)))

  const markOf = (list: WebSource[]): Mark => {
    const n = list.filter((s) => chosen.has(s.id)).length
    return n === 0 ? undefined : n === list.length ? 'on' : 'partial'
  }
  const setIds = (ids: string[], on: boolean): void => {
    const next = new Set(chosen)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    void onSettings({ sources: [...next] })
  }

  return (
    <>
      <h2 className="sheet-title">来源</h2>
      <div className="sheet-body pane-scroll news-sources">
        <section className="news-block">
          <h3 className="group-title">面向</h3>
          <div className="news-choices">
            {AUDIENCE.map((a) => (
              <Choice key={a.value} group="news-aud" active={settings.audience === a.value} onClick={() => void onSettings({ audience: a.value })}>
                {a.label}
              </Choice>
            ))}
          </div>
        </section>

        <section className="news-block">
          <h3 className="group-title">官网栏目</h3>
          <label className="news-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="6" />
              <path d="M20 20l-4.5-4.5" />
            </svg>
            <input className="field" value={query} placeholder="学院、部处、栏目" onChange={(e) => setQuery(e.target.value)} />
          </label>
          {GROUPS.map((g) => {
            const list = visible.filter((o) => g.kind.includes(o.kind))
            if (!list.length) return null
            return (
              <div key={g.label} className="news-org-group">
                <h4 className="news-org-head">{g.label}</h4>
                <ul className="news-orgs">
                  {list.map((o) => {
                    const mark = markOf(o.list)
                    const expanded = open === o.org || (q !== '' && !o.org.includes(q))
                    const picked = o.list.filter((s) => chosen.has(s.id)).length
                    return (
                      <li key={o.org} className="news-org" data-mark={mark}>
                        <div className="news-org-row">
                          <button className="news-org-hit" aria-pressed={mark !== undefined} onClick={() => setIds(o.list.map((s) => s.id), mark !== 'on')}>
                            <Box mark={mark} />
                            <span className="news-org-name">{o.org}</span>
                            {mark === 'partial' && <span className="news-org-count">{`${picked}/${o.list.length} 栏`}</span>}
                          </button>
                          <button className="news-org-more" data-open={expanded || undefined} aria-expanded={expanded} aria-label="栏目" title="栏目" onClick={() => setOpen(open === o.org ? null : o.org)}>
                            <Chevron />
                          </button>
                        </div>
                        <AnimatePresence initial={false}>
                          {expanded && (
                            <motion.ul
                              key="cols"
                              className="news-cols"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: dur(0.35), ease: EASE }}
                            >
                              {o.list.map((s) => (
                                <li key={s.id}>
                                  <button className="news-col-hit" title={s.basis} aria-pressed={chosen.has(s.id)} onClick={() => setIds([s.id], !chosen.has(s.id))}>
                                    <Box mark={chosen.has(s.id) ? 'on' : undefined} />
                                    <span className="news-col-name">{s.column}</span>
                                    <span className="news-org-count">
                                      {s.audience === 'undergrad' ? '本科' : s.audience === 'grad' ? '研究生' : ''}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </motion.ul>
                          )}
                        </AnimatePresence>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </section>

        {!MOBILE && (
          <section className="news-block" ref={wechatRef}>
            <h3 className="group-title">公众号</h3>
            <Weread state={props.weread} onState={props.onWeread} />
          </section>
        )}

        <section className="news-block">
          <h3 className="group-title">判断</h3>
          <ModelSwitch settings={settings} onSettings={onSettings} />
        </section>

        {!MOBILE && (
          <section className="news-block">
            <h3 className="group-title">钉钉群</h3>
            <div className="news-line">
              <button className="act news-toggle" role="switch" aria-checked={settings.dingtalk} data-on={settings.dingtalk || undefined} onClick={() => void onSettings({ dingtalk: !settings.dingtalk })}>
                <span className="news-knob" aria-hidden />
                读取本机钉钉群
              </button>
              <span className="news-tag">实验</span>
            </div>
          </section>
        )}
      </div>
    </>
  )
}

/** 判不准的标题交给 DeepSeek Flash：开关 + 密钥（只存本机加密） */
function ModelSwitch({ settings, onSettings }: { settings: NewsSettings; onSettings: (patch: NewsSettingsPatch) => Promise<void> }) {
  const [key, setKey] = useState('')
  return (
    <div className="news-stack">
      <div className="news-line">
        <button
          className="act news-toggle"
          role="switch"
          aria-checked={settings.llm && settings.llmKey}
          data-on={(settings.llm && settings.llmKey) || undefined}
          disabled={!settings.llmKey}
          onClick={() => void onSettings({ llm: !settings.llm })}
        >
          <span className="news-knob" aria-hidden />
          DeepSeek 判断不确定的标题
        </button>
      </div>
      {settings.llmKey ? (
        <div className="news-line">
          <span className="news-org-count">已存密钥</span>
          <IconButton label="删除密钥" onClick={() => void onSettings({ llmKey: null, llm: false })}>
            <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
          </IconButton>
        </div>
      ) : (
        <form
          className="news-line"
          onSubmit={(e) => {
            e.preventDefault()
            if (key.trim()) void onSettings({ llmKey: key.trim(), llm: true }).then(() => setKey(''))
          }}
        >
          <input className="field news-grow" type="password" autoComplete="off" value={key} placeholder="DeepSeek API 密钥" onChange={(e) => setKey(e.target.value)} />
          <button className="btn" type="submit" disabled={!key.trim()}>
            保存并开启
          </button>
        </form>
      )}
    </div>
  )
}

/** 微信读书的四种状态，各自给出下一步 */
function Weread({ state, onState }: { state: WereadState | null; onState: (s: WereadState) => void }) {
  const notify = useApp((s) => s.notify)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  if (!state) return <p className="quiet">…</p>

  const run = async (fn: () => Promise<WereadState>, done?: string): Promise<void> => {
    setBusy(true)
    try {
      onState(await fn())
      if (done) notify(done)
    } catch (e) {
      notify(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const login = (): Promise<void> => run(() => window.zju['news:wereadLogin']())

  return (
    <div className="news-stack">
      {state.status === 'signedOut' && (
        <div className="news-line">
          <button className="btn btn-solid" disabled={busy} onClick={() => void login()}>
            扫码登录微信读书
          </button>
        </div>
      )}
      {state.status === 'expired' && (
        <div className="news-line">
          <span className="news-warn">登录已过期</span>
          <button className="btn btn-solid" disabled={busy} onClick={() => void login()}>
            重新扫码登录
          </button>
        </div>
      )}
      {state.status === 'limited' && (
        <div className="news-line">
          <span className="news-warn">添加太频繁，已被限制</span>
          <button className="btn" disabled>
            {state.until ? `${dayText(new Date(state.until).toISOString())} ${new Date(state.until).toTimeString().slice(0, 5)} 后再试` : '24 小时后再试'}
          </button>
        </div>
      )}
      {state.accounts.length > 0 && (
        <ul className="news-accounts">
          {state.accounts.map((a) => (
            <li key={a.id} className="news-account">
              <span className="news-account-name">{a.name}</span>
              {a.error && <span className="news-warn">{a.error}</span>}
              <IconButton label={`移除 ${a.name}`} onClick={() => void run(() => window.zju['news:wereadRemove'](a.id))}>
                <path d="M7 7l10 10M17 7L7 17" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="news-line"
        onSubmit={(e) => {
          e.preventDefault()
          if (link.trim()) void run(() => window.zju['news:wereadAdd'](link.trim()), '已添加').then(() => setLink(''))
        }}
      >
        <input className="field news-grow" value={link} placeholder="粘贴该公众号任一篇文章的链接" onChange={(e) => setLink(e.target.value)} />
        <button className="btn" type="submit" disabled={busy || !link.trim()}>
          添加
        </button>
      </form>
      {state.status === 'ok' && (
        <div className="news-line">
          <button className="act" disabled={busy} onClick={() => void run(() => window.zju['news:wereadLogout']())}>
            退出微信读书
          </button>
        </div>
      )}
    </div>
  )
}
