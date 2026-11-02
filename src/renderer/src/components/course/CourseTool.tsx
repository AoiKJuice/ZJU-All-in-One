import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { AuditNode } from '@shared/types'
import type { XkContext, XkCourse, XkSection, XkWatch } from '@shared/xk'
import { useApp } from '@renderer/store'
import { Choice, Joined, Quiet, Reveal } from '@renderer/components/Type'
import { MOBILE } from '@renderer/lib/platform'
import { dur } from '@renderer/lib/motion'
import { TeacherSheet, errorText, useTeacher } from './TeacherSheet'
import { XkTimetable } from './XkTimetable'
import { clashesOf, groupChosen, groupFor, groupTitle, halfOf, isLead, parityLabel, slotLabel, type Clash, type PrefGroup } from './xkLogic'
import './course.css'

const EASE = [0.22, 1, 0.36, 1] as const
const TERM: Record<string, string> = { '1': '秋冬', '2': '春夏' }
/** 找课的两个特殊页签：培养方案里还没修的必修课（取自毕业自审）、搜索结果 */
const PLAN = 'plan'
const SEARCH = 'search'

type Loaded<T> = { data: T } | { error: string }

/** 2027年01月15日(08:00-10:00) → 1月15日 08:00 */
const examLabel = (exam: string): string => {
  const m = /(\d{4})年(\d{1,2})月(\d{1,2})日\s*\((\d{1,2}:\d{2})/.exec(exam)
  return m ? `${Number(m[2])}月${Number(m[3])}日 ${m[4]}` : exam
}

const fmt = (n: number): string => String(Number(n.toFixed(2)))

/** 培养方案里还没修完的必修课（本身或上级标为必修），按名称去重 */
function unfinishedRequired(nodes: AuditNode[]): AuditNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const required = (n: AuditNode): boolean => {
    for (let cur: AuditNode | undefined = n; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (cur.kind?.includes('必修') || (!cur.code && cur.name.includes('必修'))) return true
    }
    return false
  }
  const seen = new Set<string>()
  return nodes.filter((n) => n.code && (n.status === 'none' || n.status === 'failed') && required(n) && !seen.has(n.name) && seen.add(n.name))
}

/**
 * 工具「选课」：左边找课（类别 / 搜索 / 培养方案），课程展开后就地列出教学班；右边是我的志愿：上方课表、下方按志愿组列出。
 * 志愿组：普通课同一门课的几个教学班排 1/2/3 志愿；通识按上课时间分组。悬停教学班时课表里预览它占的格子并标出冲突。
 * 加入志愿一次点击、可撤销；只有退选已选上的课要二次确认
 */
export function CourseTool() {
  const notify = useApp((s) => s.notify)
  const epoch = useApp((s) => s.epoch)
  const [ctx, setCtx] = useState<Loaded<XkContext> | null>(null)
  const [tab, setTab] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [searched, setSearched] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [lists, setLists] = useState<Record<string, Loaded<XkCourse[]>>>({})
  const [plan, setPlan] = useState<Loaded<AuditNode[]> | null>(null)
  const [open, setOpen] = useState<XkCourse | null>(null)
  const [sections, setSections] = useState<Record<string, Loaded<XkSection[]>>>({})
  const [chosen, setChosen] = useState<Loaded<XkSection[]> | null>(null)
  const [watches, setWatches] = useState<XkWatch[]>([])
  const [side, setSide] = useState<'prefs' | 'watch'>('prefs')
  const [view, setView] = useState<'find' | 'mine'>('find')
  const [hover, setHover] = useState<XkSection | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [teacher, setTeacher] = useState<{ name: string; college: string } | null>(null)
  const pendingOpen = useRef<string | null>(null)

  const mine = useMemo(() => (chosen && 'data' in chosen ? chosen.data : []), [chosen])
  const context = ctx && 'data' in ctx ? ctx.data : null
  const max = context?.maxChoices ?? 3
  const groups = useMemo(() => groupChosen(mine), [mine])

  const refreshChosen = useCallback(
    () =>
      window.zju['xk:selected']().then(
        (data) => setChosen({ data }),
        (e) => setChosen({ error: errorText(e) })
      ),
    []
  )
  const refreshContext = useCallback(
    () =>
      window.zju['xk:context']().then(
        (data) => {
          setCtx({ data })
          return data
        },
        (e) => {
          setCtx({ error: errorText(e) })
          return null
        }
      ),
    []
  )

  const loadList = useCallback((id: string, run: () => Promise<XkCourse[]>) => {
    setLists((all) => {
      const { [id]: _, ...rest } = all
      return rest
    })
    run().then(
      (data) => setLists((all) => ({ ...all, [id]: { data } })),
      (e) => setLists((all) => ({ ...all, [id]: { error: errorText(e) } }))
    )
  }, [])

  const openTab = useCallback(
    (id: string) => {
      setTab(id)
      if (id === PLAN) {
        if (!plan || 'error' in plan) {
          window.zju['data:graduation']().then(
            (r) => setPlan(r.data.nodes ? { data: unfinishedRequired(r.data.nodes) } : { error: r.data.nodesError ?? '无' }),
            (e) => setPlan({ error: errorText(e) })
          )
        }
        return
      }
      if (id !== SEARCH && !lists[id]) loadList(id, () => window.zju['xk:courses'](id))
    },
    [plan, lists, loadList]
  )

  useEffect(() => {
    setLists({})
    setSections({})
    void refreshContext().then((c) => {
      if (c?.categories[0]) {
        setTab(c.categories[0].id)
        loadList(c.categories[0].id, () => window.zju['xk:courses'](c.categories[0].id))
      }
    })
    void refreshChosen()
    if (MOBILE) return
    void window.zju['xk:watches']().then(setWatches)
    const timer = setInterval(() => void window.zju['xk:watches']().then(setWatches), 15_000)
    return () => clearInterval(timer)
  }, [epoch, refreshContext, refreshChosen, loadList])

  const toggleCourse = (c: XkCourse): void => {
    if (open?.pool === c.pool && open.tab === c.tab) {
      setOpen(null)
      return
    }
    setOpen(c)
    const key = `${c.tab}|${c.pool}`
    if (sections[key] && 'data' in sections[key]) return
    window.zju['xk:sections'](c).then(
      (data) => setSections((all) => ({ ...all, [key]: { data } })),
      (e) => setSections((all) => ({ ...all, [key]: { error: errorText(e) } }))
    )
  }

  const search = (text: string, openName?: string): void => {
    const k = text.trim()
    if (!k) return
    setKeyword(k)
    setSearched(k)
    setTab(SEARCH)
    setView('find')
    pendingOpen.current = openName ?? null
    loadList(SEARCH, () => window.zju['xk:search'](k, onlyAvailable))
  }

  // 从志愿或培养方案跳过来时，搜索结果到了就展开同名的课
  const searchList = lists[SEARCH]
  useEffect(() => {
    const name = pendingOpen.current
    if (!name || !searchList || !('data' in searchList)) return
    pendingOpen.current = null
    const hit = searchList.data.find((c) => c.name === name)
    if (hit) toggleCourse(hit)
    // toggleCourse 只依赖当时的状态，这里只在搜索结果到达时跑一次
  }, [searchList])

  const isGeneral = (c: XkCourse): boolean => /通识/.test(c.category) || !!context?.categories.find((x) => x.id === c.tab)?.name.includes('通识')

  // ---- 写操作：加入 / 移出 / 调整顺序 ----
  const add = async (s: XkSection, quiet = false): Promise<void> => {
    setBusy(s.id)
    try {
      const r = await window.zju['xk:select'](s)
      const now = await window.zju['xk:selected']()
      setChosen({ data: now })
      void refreshContext()
      if (quiet) return
      const order = now.find((x) => x.id === s.id)?.order
      if (r.status === 'saved') notify(order ? `已加入第 ${order} 志愿` : r.message, { label: '撤销', run: () => void remove(s, true) })
      else notify(r.message)
    } catch (e) {
      notify(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (s: XkSection, quiet = false): Promise<void> => {
    setBusy(s.id)
    try {
      const r = await window.zju['xk:drop'](s.id)
      await refreshChosen()
      void refreshContext()
      if (quiet) return
      if (r.status === 'saved' && s.state !== 'selected') notify('已移出志愿', { label: '撤销', run: () => void add(s, true) })
      else notify(r.message)
    } catch (e) {
      notify(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const move = async (items: XkSection[], index: number, step: -1 | 1): Promise<void> => {
    const next = [...items]
    const [it] = next.splice(index, 1)
    next.splice(index + step, 0, it)
    const ids = next.map((s) => s.id)
    // 先改界面，再以回查结果为准
    setChosen({ data: mine.map((s) => (ids.includes(s.id) ? { ...s, order: ids.indexOf(s.id) + 1 } : s)) })
    setBusy(it.id)
    try {
      const r = await window.zju['xk:reorder'](ids)
      if (r.status !== 'saved') notify(r.message)
    } catch (e) {
      notify(errorText(e))
    } finally {
      await refreshChosen()
      setBusy(null)
    }
  }

  const watchOf = (id: string): XkWatch | undefined => watches.find((w) => w.section.id === id && !w.done)
  const watch = (course: XkCourse, s: XkSection, auto: boolean): void => void window.zju['xk:watch'](course, s, auto).then(setWatches)
  const unwatch = (id: string): void => void window.zju['xk:unwatch'](id).then(setWatches)

  // 志愿里点一门课：找课那边搜出这门课并展开；通识的空位跳到通识类别
  const reveal = (s: XkSection): void => search(s.courseName, s.courseName)
  const revealGroup = (g: PrefGroup): void => {
    const general = context?.categories.find((c) => c.name.includes('通识'))
    if (g.byTime && general) {
      setView('find')
      openTab(general.id)
    } else reveal(g.items[0])
  }

  const hoverGroup = hover ? groupFor(hover, mine, open ? isGeneral(open) : false) : null

  const submitSearch = (e: FormEvent): void => {
    e.preventDefault()
    search(keyword)
  }

  const current = tab === PLAN ? null : tab ? lists[tab] : undefined

  return (
    <div className="xk" data-view={view}>
      {MOBILE && (
        <div className="xk-switch">
          <Choice group="xk-view" active={view === 'find'} onClick={() => setView('find')}>
            找课
          </Choice>
          <Choice group="xk-view" active={view === 'mine'} onClick={() => setView('mine')}>
            志愿
          </Choice>
        </div>
      )}

      <Reveal i={1} flat className="panel xk-find">
        <form className="xk-search" onSubmit={submitSearch}>
          <input className="field xk-field" placeholder="搜索课程" value={keyword} onChange={(e) => setKeyword(e.target.value)} enterKeyHint="search" />
          <button type="button" className="act" data-on={onlyAvailable || undefined} onClick={() => setOnlyAvailable((x) => !x)}>
            有余量
          </button>
        </form>
        <div className="xk-tabs">
          {context?.categories.map((c) => (
            <Choice key={c.id} group="xk-tab" className="small" active={tab === c.id} onClick={() => openTab(c.id)}>
              {c.name.replace(/课程$/, '')}
            </Choice>
          ))}
          {context && (
            <Choice group="xk-tab" className="small" active={tab === PLAN} onClick={() => openTab(PLAN)}>
              培养方案
            </Choice>
          )}
          {searched && (
            <Choice group="xk-tab" className="small" active={tab === SEARCH} onClick={() => setTab(SEARCH)}>
              “{searched}”
            </Choice>
          )}
        </div>
        <div className="pane-scroll xk-list">
          {!ctx ? (
            <Quiet loading error={null} empty="无" />
          ) : 'error' in ctx && tab !== SEARCH ? (
            <Quiet loading={false} error={ctx.error} empty="无" />
          ) : tab === PLAN ? (
            <PlanList plan={plan} onPick={(n) => search(n.name, n.name)} />
          ) : !current ? (
            <Quiet loading error={null} empty="无" />
          ) : 'error' in current ? (
            <Quiet loading={false} error={current.error} empty="无" />
          ) : current.data.length === 0 ? (
            <p className="quiet">无</p>
          ) : (
            <ul className="xk-courses">
              {current.data.map((c) => {
                const expanded = open?.pool === c.pool && open.tab === c.tab
                const loaded = sections[`${c.tab}|${c.pool}`]
                const general = isGeneral(c)
                return (
                  <li key={`${c.tab}|${c.pool}`} data-open={expanded || undefined}>
                    <button className="xk-course" onClick={() => toggleCourse(c)} aria-expanded={expanded}>
                      <span className="min-w-0">
                        <span className="row-title">{c.name}</span>
                        <span className="xk-course-sub">
                          <Joined parts={[c.credit !== null && `${fmt(c.credit)} 学分`, c.category, c.college]} />
                        </span>
                      </span>
                      <CourseState chosen={mine} code={c.code} />
                      <Chevron />
                    </button>
                    <AnimatePresence initial={false}>
                      {expanded && (
                        <motion.div
                          key="sections"
                          className="xk-drawer"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: dur(0.4), ease: EASE }}
                        >
                          {!loaded ? (
                            <p className="quiet xk-drawer-quiet">…</p>
                          ) : 'error' in loaded ? (
                            <p className="quiet xk-drawer-quiet">{loaded.error}</p>
                          ) : (
                            <SectionList
                              course={c}
                              sections={loaded.data.filter((s) => !onlyAvailable || s.remaining !== 0 || mine.some((x) => x.id === s.id))}
                              chosen={mine}
                              max={max}
                              general={general}
                              busy={busy}
                              watchOf={watchOf}
                              onHover={setHover}
                              onTeacher={(name) => setTeacher({ name, college: c.college })}
                              onAdd={(s) => void add(s)}
                              onRemove={(s) => void remove(s)}
                              onWatch={(s) => (watchOf(s.id) ? unwatch(s.id) : watch(c, s, false))}
                            />
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Reveal>

      <Reveal i={2} flat className="panel xk-mine">
        <div className="xk-mine-head">
          {/* 手机上顶部已有 找课 / 志愿 切换，订阅只在桌面端 */}
          <span className="xk-mine-tabs">
            {!MOBILE && (
              <>
                <Choice group="xk-side" active={side === 'prefs'} onClick={() => setSide('prefs')}>
                  志愿
                </Choice>
                <Choice group="xk-side" active={side === 'watch'} onClick={() => setSide('watch')}>
                  订阅
                </Choice>
              </>
            )}
          </span>
          {context && (
            <span className="xk-mine-meta">
              <Joined parts={[TERM[context.xq] ?? '', context.credits && `${fmt(context.credits.total)} 学分`]} />
            </span>
          )}
        </div>
        <XkTimetable chosen={mine} preview={hover} previewGroup={hoverGroup} focus={focus} onPick={reveal} />
        <div className="pane-scroll xk-groups">
          {side === 'watch' && !MOBILE ? (
            <WatchList watches={watches} onUnwatch={unwatch} onAuto={(w, auto) => watch(w.course, w.section, auto)} />
          ) : !chosen ? (
            <Quiet loading error={null} empty="无" />
          ) : 'error' in chosen ? (
            <Quiet loading={false} error={chosen.error} empty="无" />
          ) : groups.length === 0 ? (
            <p className="quiet">无</p>
          ) : (
            groups.map((g) => (
              <PrefBlock
                key={g.key}
                group={g}
                chosen={mine}
                max={max}
                busy={busy}
                onFocus={setFocus}
                onReveal={reveal}
                onAddMore={() => revealGroup(g)}
                onMove={(i, step) => void move(g.items, i, step)}
                onRemove={(s) => void remove(s)}
              />
            ))
          )}
        </div>
      </Reveal>

      <TeacherSheet teacher={teacher} onClose={() => setTeacher(null)} />
    </div>
  )
}

function Chevron() {
  return (
    <svg className="xk-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/** 课程行尾：已选上 / 已在志愿中 */
function CourseState({ chosen, code }: { chosen: XkSection[]; code: string }) {
  const list = chosen.filter((s) => s.courseCode === code)
  if (list.some((s) => s.state === 'selected')) return <span className="xk-tag" data-tone="solid">已选上</span>
  if (list.length) return <span className="xk-tag" data-tone="soft">志愿中</span>
  return <span />
}

function PlanList({ plan, onPick }: { plan: Loaded<AuditNode[]> | null; onPick: (n: AuditNode) => void }) {
  if (!plan) return <Quiet loading error={null} empty="无" />
  if ('error' in plan) return <Quiet loading={false} error={plan.error} empty="无" />
  if (plan.data.length === 0) return <p className="quiet">无</p>
  return (
    <ul className="rows">
      {plan.data.map((n) => (
        <li key={n.id}>
          <button className="row xk-plan-row" onClick={() => onPick(n)}>
            <span className="min-w-0">
              <span className="row-title">{n.name}</span>
              <span className="xk-course-sub">
                <Joined parts={[n.credits !== undefined && `${fmt(n.credits)} 学分`, n.code]} />
              </span>
            </span>
            <span className="xk-tag" data-tone={n.status === 'failed' ? 'hot' : undefined}>
              {n.status === 'failed' ? '未通过' : '未修'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function SectionList(props: {
  course: XkCourse
  sections: XkSection[]
  chosen: XkSection[]
  max: number
  general: boolean
  busy: string | null
  watchOf: (id: string) => XkWatch | undefined
  onHover: (s: XkSection | null) => void
  onTeacher: (name: string) => void
  onAdd: (s: XkSection) => void
  onRemove: (s: XkSection) => void
  onWatch: (s: XkSection) => void
}) {
  const { sections, chosen } = props
  if (sections.length === 0) return <p className="quiet xk-drawer-quiet">无</p>
  return (
    <ul className="xk-sections">
      {sections.map((s) => {
        const mine = chosen.find((x) => x.id === s.id)
        const group = mine?.group ?? groupFor(s, chosen, props.general)
        const members = chosen.filter((x) => (x.group ?? x.courseCode) === group)
        return (
          <SectionCard
            key={s.id}
            section={s}
            mine={mine}
            next={members.length + 1}
            full={!mine && members.length >= props.max}
            clashes={clashesOf(s, chosen, group)}
            busy={props.busy === s.id}
            locked={props.busy !== null}
            college={props.course.college}
            watch={props.watchOf(s.id)}
            onHover={props.onHover}
            onTeacher={props.onTeacher}
            onAdd={() => props.onAdd(s)}
            onRemove={() => props.onRemove(mine ?? s)}
            onWatch={() => props.onWatch(s)}
          />
        )
      })}
    </ul>
  )
}

/** 时间：每段一枚小标签，单双周与半学期跟在后面 */
function When({ s }: { s: XkSection }) {
  const half = halfOf(s.semesterPart)
  return (
    <span className="xk-when">
      {s.slots.length
        ? s.slots.map((t, i) => (
            <span key={i} className="xk-slot">
              {slotLabel(t)}
              <small>节</small>
              {parityLabel(t) && <em>{parityLabel(t)}</em>}
            </span>
          ))
        : s.times.map((t) => (
            <span key={t} className="xk-slot">
              {t}
            </span>
          ))}
      {half && <span className="xk-slot xk-half">{half}</span>}
    </span>
  )
}

function SectionCard(props: {
  section: XkSection
  mine: XkSection | undefined
  next: number
  full: boolean
  clashes: Clash[]
  busy: boolean
  locked: boolean
  college: string
  watch: XkWatch | undefined
  onHover: (s: XkSection | null) => void
  onTeacher: (name: string) => void
  onAdd: () => void
  onRemove: () => void
  onWatch: () => void
}) {
  const { section: s, mine, clashes } = props
  const hot = s.remaining !== null && s.pending !== null && s.pending > s.remaining
  const used = s.capacity ? Math.min(1, (s.capacity - (s.remaining ?? 0)) / s.capacity) : null
  const worst = clashes[0]?.level
  return (
    <li
      className="xk-sec"
      data-mine={mine ? true : undefined}
      data-clash={worst && worst !== 'backup' ? true : undefined}
      onPointerEnter={(e) => e.pointerType === 'mouse' && props.onHover(s)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && props.onHover(null)}
    >
      <div className="xk-sec-main">
        <div className="xk-sec-who">
          {s.teachers.length ? s.teachers.map((t) => <TeacherName key={t} name={t} college={props.college} onOpen={() => props.onTeacher(t)} />) : <span className="xk-teacher">—</span>}
          {mine && (
            <span className="xk-tag" data-tone="solid">
              {mine.state === 'selected' ? '已选上' : `第 ${mine.order ?? 1} 志愿`}
            </span>
          )}
        </div>
        <When s={s} />
        <div className="xk-sec-where">
          <Joined parts={[s.places.join(' '), s.exam && `考试 ${examLabel(s.exam)}`]} />
        </div>
        {clashes.length > 0 && (
          <div className="xk-clashes">
            {clashes.map((c) => (
              <span key={c.section.courseCode} className="xk-clash" data-level={c.level}>
                {c.level === 'backup' ? `与 ${c.section.courseName} 的备选冲突` : `与 ${c.section.courseName} 冲突`}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="xk-cap" data-full={s.remaining === 0 || undefined}>
        <span className="xk-cap-figure">
          {s.remaining ?? '—'}
          {s.capacity !== null && <small>/ {s.capacity}</small>}
        </span>
        {used !== null && (
          <span className="xk-cap-bar">
            <span style={{ width: `${used * 100}%` }} />
          </span>
        )}
        {s.pending !== null && <span className="xk-cap-pending" data-hot={hot || undefined}>待定 {s.pending}</span>}
      </div>
      <div className="xk-sec-acts">
        {mine ? (
          mine.state === 'selected' ? (
            <ArmedButton className="btn" label="退选" confirm="确认退选" onRun={props.onRemove} disabled={props.locked} />
          ) : (
            <button className="btn" disabled={props.locked} onClick={props.onRemove}>
              移出
            </button>
          )
        ) : (
          <button className="btn btn-solid" disabled={props.locked || props.full} onClick={props.onAdd}>
            {props.full ? '志愿已满' : props.busy ? '提交中' : props.next === 1 ? '加入志愿' : `加为第 ${props.next} 志愿`}
          </button>
        )}
        {!MOBILE && (s.remaining === 0 || props.watch) && !mine && (
          <button className="act" data-on={props.watch ? true : undefined} onClick={props.onWatch}>
            {props.watch ? (props.watch.auto ? '自动选中' : '订阅中') : '订阅余量'}
          </button>
        )}
      </div>
    </li>
  )
}

/** 教师名 + 查老师评分（≥ 8.5 主题色）；点开看详情与评论。查不到只显示名字 */
function TeacherName({ name, college, onOpen }: { name: string; college: string; onOpen: () => void }) {
  const t = useTeacher(name, college)
  return (
    <button className="xk-teacher" onClick={onOpen}>
      {name}
      {t?.rating !== undefined && t?.rating !== null && <em data-high={t.rating >= 8.5 || undefined}>{t.rating.toFixed(1)}</em>}
    </button>
  )
}

/** 一个志愿组：标题（课名或通识时间）、各志愿（次序、调序、移出）、剩下的空位（点了去找课） */
function PrefBlock(props: {
  group: PrefGroup
  chosen: XkSection[]
  max: number
  busy: string | null
  onFocus: (key: string | null) => void
  onReveal: (s: XkSection) => void
  onAddMore: () => void
  onMove: (index: number, step: -1 | 1) => void
  onRemove: (s: XkSection) => void
}) {
  const { group: g } = props
  const free = g.selected ? 0 : Math.max(0, props.max - g.items.length)
  return (
    <section className="xk-group" data-selected={g.selected || undefined} onPointerEnter={() => props.onFocus(g.key)} onPointerLeave={() => props.onFocus(null)}>
      <h3 className="xk-group-head">
        <span className="xk-group-title">{g.byTime ? groupTitle(g) : g.items[0].courseName}</span>
        {g.selected && (
          <span className="xk-tag" data-tone="solid">
            已选上
          </span>
        )}
      </h3>
      <ol className="xk-prefs">
        {g.items.map((s, i) => {
          const clashes = clashesOf(s, props.chosen, g.key).filter((c) => c.level !== 'backup' && isLead(s))
          return (
            <li key={s.id} className="xk-pref" data-state={s.state} data-lead={isLead(s) || undefined}>
              <span className="xk-pref-no">{s.order ?? i + 1}</span>
              <button className="xk-pref-body" onClick={() => props.onReveal(s)}>
                <span className="xk-pref-title">
                  {g.byTime && <b>{s.courseName}</b>}
                  {s.teachers.join(' ') || '—'}
                  {clashes.length > 0 && (
                    <span className="xk-clash" data-level={clashes[0].level}>
                      与 {clashes.map((c) => c.section.courseName).join('、')} 冲突
                    </span>
                  )}
                </span>
                <span className="xk-pref-sub">
                  <Joined
                    parts={[
                      s.slots.map((t) => `${slotLabel(t)}${parityLabel(t) ? ` ${parityLabel(t)}` : ''}`).join('  '),
                      halfOf(s.semesterPart),
                      s.state !== 'selected' && s.remaining !== null && `余 ${s.remaining}`,
                      s.state !== 'selected' && s.pending !== null && `待定 ${s.pending}`
                    ]}
                  />
                </span>
              </button>
              <span className="xk-pref-acts">
                {!g.selected && (
                  <>
                    <IconButton label="上移" disabled={i === 0 || props.busy !== null} onClick={() => props.onMove(i, -1)}>
                      <path d="M6 15l6-6 6 6" />
                    </IconButton>
                    <IconButton label="下移" disabled={i === g.items.length - 1 || props.busy !== null} onClick={() => props.onMove(i, 1)}>
                      <path d="M6 9l6 6 6-6" />
                    </IconButton>
                  </>
                )}
                {s.state === 'selected' ? (
                  <ArmedButton className="act" label="退选" confirm="确认退选" onRun={() => props.onRemove(s)} disabled={props.busy !== null} />
                ) : (
                  <IconButton label="移出" disabled={props.busy !== null} onClick={() => props.onRemove(s)}>
                    <path d="M7 7l10 10M17 7L7 17" />
                  </IconButton>
                )}
              </span>
            </li>
          )
        })}
        {Array.from({ length: free }, (_, i) => (
          <li key={`free${i}`} className="xk-pref xk-free">
            <button className="xk-free-btn" onClick={props.onAddMore} aria-label="找课">
              <span className="xk-pref-no">{g.items.length + i + 1}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M12 6v12M6 12h12" />
              </svg>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

function WatchList({ watches, onUnwatch, onAuto }: { watches: XkWatch[]; onUnwatch: (id: string) => void; onAuto: (w: XkWatch, auto: boolean) => void }) {
  if (watches.length === 0) return <p className="quiet">无</p>
  return (
    <ul className="xk-watches">
      {watches.map((w) => (
        <li key={w.section.id} className="xk-watch" data-done={w.done ? true : undefined}>
          <span className="min-w-0">
            <span className="xk-pref-title">
              <b>{w.section.courseName || w.course.name}</b>
              {w.section.teachers.join(' ')}
            </span>
            <span className="xk-pref-sub">
              {/* 早期版本存下的订阅没有 slots */}
              <Joined parts={[(w.section.slots ?? []).map(slotLabel).join('  ') || w.section.times.join(' '), halfOf(w.section.semesterPart ?? '')]} />
            </span>
          </span>
          <span className="xk-tag" data-tone={w.remaining ? 'hot' : undefined}>
            {w.done ?? (w.remaining === null ? '…' : `余 ${w.remaining}`)}
          </span>
          <span className="xk-pref-acts">
            {!w.done &&
              (w.auto ? (
                <button className="act" data-on onClick={() => onAuto(w, false)}>
                  自动选
                </button>
              ) : (
                <ArmedButton label="自动选" confirm="确认授权" onRun={() => onAuto(w, true)} />
              ))}
            <IconButton label="取消订阅" onClick={() => onUnwatch(w.section.id)}>
              <path d="M7 7l10 10M17 7L7 17" />
            </IconButton>
          </span>
        </li>
      ))}
    </ul>
  )
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className="xk-icon" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}

/** 写操作按钮：第一次点击变成「确认…」，3 秒内再点才执行 */
function ArmedButton({ label, confirm, onRun, disabled, className = 'act' }: { className?: string; label: ReactNode; confirm: ReactNode; onRun: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <button
      className={className}
      data-on={armed || undefined}
      data-armed={armed || undefined}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        if (!armed) return setArmed(true)
        setArmed(false)
        onRun()
      }}
    >
      {armed ? confirm : label}
    </button>
  )
}
