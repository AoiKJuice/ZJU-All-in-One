import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { AuditNode } from '@shared/types'
import type { XkCourse, XkSection } from '@shared/xk'
import { Joined } from '@renderer/components/Type'
import { dur } from '@renderer/lib/motion'
import { Chevron, Dropdown, IconButton, Option, Toggle, XkStatus, fmt } from './bits'
import { SectionCard, useXkEnv } from './SectionCard'
import { courseKey, percent, ratingKey, requestSections, useXkData, type Loaded } from './xkData'
import {
  DAY_PART_NAMES,
  RATINGS,
  SORTS,
  courseMatches,
  inPlan,
  needsSections,
  sectionFilters,
  sortViews,
  viewCourse,
  type CourseView,
  type Filters,
  type Scope
} from './xkFilter'
import { halfOf, type CategoryGroup } from './xkLogic'

const EASE = [0.22, 1, 0.36, 1] as const
const WEEK = '一二三四五六日'
const STEP = 120

/** 范围对应的课程列表键：类别页签按 key，大类取其全部小类，搜索按关键词 */
export function scopeKeys(scope: Scope | null, groups: CategoryGroup[], search: string): string[] {
  if (!scope) return []
  if (scope.kind === 'cat') return [scope.key]
  if (scope.kind === 'group') return groups.find((g) => g.id === scope.id)?.items.map((x) => x.category.key) ?? []
  if (scope.kind === 'search') return search ? [`search|${search}`] : []
  return []
}

export function scopeLabel(scope: Scope | null, groups: CategoryGroup[]): string {
  if (!scope) return '…'
  if (scope.kind === 'search') return '搜索'
  if (scope.kind === 'plan') return '培养方案'
  if (scope.kind === 'group') {
    const g = groups.find((x) => x.id === scope.id)
    return g ? `${g.title}全部` : '…'
  }
  for (const g of groups) {
    const item = g.items.find((x) => x.category.key === scope.key)
    if (item) return g.id === 'all' ? item.category.name : g.items.length > 1 ? `${g.title} · ${item.label}` : item.label
  }
  return '…'
}

interface Props {
  filters: Filters
  /** reveal：改完条件后要展开的课名 */
  setFilters: (patch: Partial<Filters>, reveal?: string) => void
  groups: CategoryGroup[]
  /** 课程列表（键见 scopeKeys） */
  lists: Record<string, Loaded<XkCourse[]>>
  loadList: (key: string) => void
  /** 服务端搜索用的关键词（输入停顿后才更新） */
  search: string
  plan: { todo: AuditNode[]; done: Set<string>; todoSet: Set<string> } | null
  planError: string | null
  contextError: string | null
  onRetry: () => void
  /** 变化时把焦点放进搜索框（志愿为空时的「去找课」） */
  focusToken: number
  /** 要展开的课（从志愿、培养方案跳过来时），按名称认 */
  reveal: string | null
  onRevealed: () => void
  onDetail: (c: XkCourse) => void
}

/** 左栏找课：搜索框与一排筛选控件，下面是课程列表；课程就地展开成教学班卡片 */
export function FindPanel(props: Props) {
  const { filters: f, setFilters, groups, lists } = props
  const env = useXkEnv()
  const sections = useXkData((d) => d.sections)
  const ratings = useXkData((d) => d.ratings)
  const queued = useXkData((d) => d.queued)
  const [open, setOpen] = useState<string | null>(null)
  const [limit, setLimit] = useState(STEP)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (props.focusToken) input.current?.focus()
  }, [props.focusToken])

  const keys = useMemo(() => scopeKeys(f.scope, groups, props.search), [f.scope, groups, props.search])
  useEffect(() => {
    for (const k of keys) if (!lists[k]) props.loadList(k)
    // loadList 稳定；只在范围变化时取
  }, [keys, lists])

  const loaded = keys.map((k) => lists[k])
  const listError = loaded.find((x): x is { error: string } => !!x && 'error' in x)?.error ?? null
  const listLoading = loaded.some((x) => !x)
  const courses = useMemo(() => {
    const seen = new Set<string>()
    const out: XkCourse[] = []
    for (const l of loaded) {
      if (!l || !('data' in l)) continue
      for (const c of l.data) {
        const k = courseKey(c)
        if (!seen.has(k)) {
          seen.add(k)
          out.push(c)
        }
      }
    }
    return out
    // loaded 每次渲染都是新数组，按其元素比较
  }, [keys, ...loaded])

  const views = useMemo(() => {
    const out: CourseView[] = []
    for (const c of courses) {
      const e = sections[courseKey(c)]
      const v = viewCourse(c, e && 'data' in e.value ? e.value.data : undefined, f, {
        chosen: env.chosen,
        general: env.isGeneral(c),
        college: c.college,
        ratings
      })
      if (v) out.push(v)
    }
    return sortViews(out, f.sort)
  }, [courses, sections, ratings, f, env.chosen, env.isGeneral])

  // 开了按教学班筛选 / 排序：取整份列表的教学班；否则只取看得见的（下面的 IntersectionObserver）
  const full = needsSections(f)
  useEffect(() => {
    if (full && courses.length) requestSections(courses)
  }, [full, courses])

  // 关键词没对上课名时可能对得上教师名：取教学班来判断（只在列表不大时）
  useEffect(() => {
    if (!f.keyword.trim() || full || courses.length > 400) return
    requestSections(courses.filter((c) => !courseMatches(c, f.keyword)))
  }, [f.keyword, full, courses])

  const byKey = useRef(new Map<string, XkCourse>())
  byKey.current = new Map(courses.map((c) => [courseKey(c), c]))
  const observer = useMemo(
    () =>
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              const seen = entries.filter((e) => e.isIntersecting).flatMap((e) => byKey.current.get((e.target as HTMLElement).dataset.key ?? '') ?? [])
              if (seen.length) requestSections(seen, { front: true })
            },
            { rootMargin: '200px 0px' }
          ),
    []
  )
  useEffect(() => () => observer?.disconnect(), [observer])

  // 换了范围或条件：回到顶部，重新分批渲染
  useEffect(() => {
    setLimit(STEP)
    scroller.current?.scrollTo({ top: 0 })
  }, [keys, f.sort])

  // 从志愿 / 培养方案跳过来：列表里出现同名的课就展开并滚过去
  useEffect(() => {
    if (!props.reveal) return
    const hit = views.find((v) => v.course.name === props.reveal)
    if (!hit && listLoading) return
    props.onRevealed()
    if (!hit) return
    const k = courseKey(hit.course)
    setOpen(k)
    requestSections([hit.course], { front: true })
    requestAnimationFrame(() => scroller.current?.querySelector(`[data-key="${CSS.escape(k)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }, [props.reveal, views, listLoading])

  const toggle = (c: XkCourse): void => {
    const k = courseKey(c)
    setOpen(open === k ? null : k)
    if (open !== k) requestSections([c], { front: true })
  }

  const ratingLabel = f.minRating ? `${f.minRating} 分以上` : '不限'
  const sortLabel = SORTS.find((s) => s.id === f.sort)?.label ?? '默认'
  const pickScope = (scope: Scope, close: () => void): void => {
    setFilters({ scope })
    close()
    if (scope.kind === 'search') requestAnimationFrame(() => input.current?.focus())
  }
  const sameScope = (a: Scope | null, b: Scope): boolean => JSON.stringify(a) === JSON.stringify(b)

  const searching = f.scope?.kind === 'search'
  const planList = props.plan?.todo.filter((n) => !f.keyword.trim() || n.name.includes(f.keyword.trim()) || n.code?.includes(f.keyword.trim())) ?? []

  return (
    <>
      <div className="xk-filter">
        <label className="xk-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" />
          </svg>
          <input
            ref={input}
            className="xk-search-input"
            placeholder={searching ? '搜索全部课程' : '课程、教师、代码'}
            value={f.keyword}
            onChange={(e) => setFilters({ keyword: e.target.value })}
            enterKeyHint="search"
          />
          {f.keyword && (
            <button className="xk-search-clear" aria-label="清空" onClick={() => setFilters({ keyword: '' })}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M8 8l8 8M16 8l-8 8" />
              </svg>
            </button>
          )}
        </label>
        <div className="xk-ctls">
          <Dropdown label="类别" value={scopeLabel(f.scope, groups)} wide>
            {(close) => (
              <div className="xk-cats">
                <div className="xk-cat-row">
                  <span className="xk-cat-title" />
                  <span className="xk-cat-items">
                    <Option active={sameScope(f.scope, { kind: 'search' })} onClick={() => pickScope({ kind: 'search' }, close)}>
                      搜索
                    </Option>
                    <Option active={sameScope(f.scope, { kind: 'plan' })} onClick={() => pickScope({ kind: 'plan' }, close)}>
                      培养方案
                    </Option>
                  </span>
                </div>
                {groups.map((g) => (
                  <div key={g.id} className="xk-cat-row">
                    <span className="xk-cat-title">{g.title}</span>
                    <span className="xk-cat-items">
                      {g.items.length > 1 && (
                        <Option active={sameScope(f.scope, { kind: 'group', id: g.id })} onClick={() => pickScope({ kind: 'group', id: g.id }, close)}>
                          全部
                        </Option>
                      )}
                      {g.items.map((x) => (
                        <Option key={x.category.key} active={sameScope(f.scope, { kind: 'cat', key: x.category.key })} onClick={() => pickScope({ kind: 'cat', key: x.category.key }, close)}>
                          {g.id === 'all' ? x.category.name : x.label}
                        </Option>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Dropdown>
          <Dropdown label="评分" value={ratingLabel} active={f.minRating > 0}>
            {(close) => (
              <div className="xk-opts">
                {RATINGS.map((r) => (
                  <Option
                    key={r}
                    active={f.minRating === r}
                    onClick={() => {
                      setFilters({ minRating: r })
                      close()
                    }}
                  >
                    {r ? `${r} 分以上` : '不限'}
                  </Option>
                ))}
              </div>
            )}
          </Dropdown>
          <Dropdown label="排序" value={sortLabel} active={f.sort !== 'default'}>
            {(close) => (
              <div className="xk-opts">
                {SORTS.map((s) => (
                  <Option
                    key={s.id}
                    active={f.sort === s.id}
                    onClick={() => {
                      setFilters({ sort: s.id })
                      close()
                    }}
                  >
                    {s.label}
                  </Option>
                ))}
              </div>
            )}
          </Dropdown>
          <Toggle on={f.available} onClick={() => setFilters({ available: !f.available })}>
            有余量
          </Toggle>
          <Toggle on={f.noEarly} onClick={() => setFilters({ noEarly: !f.noEarly })}>
            无早八
          </Toggle>
          <Toggle on={f.noClash} onClick={() => setFilters({ noClash: !f.noClash })}>
            不冲突
          </Toggle>
          {f.when && (
            <button className="xk-ctl" data-on onClick={() => setFilters({ when: null })}>
              <span className="xk-ctl-value">
                周{WEEK[f.when.weekday - 1]}
                {DAY_PART_NAMES[f.when.part]}
              </span>
              <svg className="xk-ctl-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M8 8l8 8M16 8l-8 8" />
              </svg>
            </button>
          )}
        </div>
        <span className="xk-progress" data-on={(full && queued > 0) || undefined} />
      </div>

      <div ref={scroller} className="pane-scroll xk-list">
        {props.contextError ? (
          <XkStatus error={props.contextError} onRetry={props.onRetry} />
        ) : f.scope?.kind === 'plan' ? (
          !props.plan ? (
            props.planError ? <XkStatus error={props.planError} onRetry={props.onRetry} /> : <p className="quiet">…</p>
          ) : planList.length === 0 ? (
            <p className="quiet">无</p>
          ) : (
            <ul className="rows">
              {planList.map((n) => (
                <li key={n.id}>
                  <button className="row xk-plan-row" onClick={() => setFilters({ scope: { kind: 'search' }, keyword: n.name }, n.name)}>
                    <span className="min-w-0">
                      <span className="row-title">{n.name}</span>
                      <span className="xk-course-sub">
                        <Joined parts={[n.code, n.credits !== undefined && `${fmt(n.credits)} 学分`, n.kind]} />
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
        ) : !f.scope || (listLoading && views.length === 0) ? (
          <p className="quiet">{searching && !f.keyword.trim() ? '无' : '…'}</p>
        ) : listError && views.length === 0 ? (
          <XkStatus error={listError} onRetry={props.onRetry} />
        ) : views.length === 0 ? (
          full && queued > 0 ? (
            <p className="quiet">…</p>
          ) : (
            <div className="xk-empty">
              <p className="quiet">无</p>
              {sectionFilters(f) && (
                <button className="btn" onClick={() => setFilters({ available: false, noEarly: false, noClash: false, minRating: 0, when: null })}>
                  清除筛选
                </button>
              )}
              {!searching && f.keyword.trim() && (
                <button className="btn" onClick={() => setFilters({ scope: { kind: 'search' } })}>
                  搜索全部课程
                </button>
              )}
            </div>
          )
        ) : (
          <ul className="xk-courses">
            {views.slice(0, limit).map((v) => (
              <CourseRow
                key={courseKey(v.course)}
                view={v}
                open={open === courseKey(v.course)}
                plan={props.plan}
                observe={observer}
                showChance={f.sort === 'chance'}
                onToggle={() => toggle(v.course)}
                onDetail={() => props.onDetail(v.course)}
              />
            ))}
            {views.length > limit && <Sentinel onSeen={() => setLimit((n) => n + STEP)} />}
          </ul>
        )}
      </div>
    </>
  )
}

function Sentinel({ onSeen }: { onSeen: () => void }) {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && onSeen(), { rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [onSeen])
  return <li ref={ref} className="xk-sentinel" />
}

/** 课程行：课名与代码、志愿 / 培养方案状态；学分、性质、类别、学院；教学班到了以后列出老师与评分，右边余量与选中概率 */
function CourseRow({
  view: v,
  open,
  plan,
  observe,
  showChance,
  onToggle,
  onDetail
}: {
  view: CourseView
  open: boolean
  plan: Props['plan']
  observe: IntersectionObserver | null
  /** 按选中概率排序时，写出这门课各教学班里最高的概率 */
  showChance: boolean
  onToggle: () => void
  onDetail: () => void
}) {
  const env = useXkEnv()
  const c = v.course
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !observe) return
    observe.observe(el)
    return () => observe.unobserve(el)
  }, [observe])

  const mine = env.chosen.filter((s) => s.courseCode === c.code)
  const selected = mine.some((s) => s.state === 'selected')
  const orders = mine.map((s) => s.order ?? 1).sort((a, b) => a - b)
  const done = plan ? inPlan(c, plan.done) : false
  const todo = plan ? inPlan(c, plan.todoSet) : false
  const half = halfOf(c.semesterPart ?? '')

  // 性质与类别常写成同一个词（「专业基础课程」两遍），相同时只写一次；课程代码、老师在展开后与详情里看
  const kinds = [...new Set([c.nature, c.category].filter(Boolean))]

  return (
    <li ref={ref} className="xk-card" data-key={courseKey(c)} data-open={open || undefined}>
      <button className="xk-course-main" onClick={onToggle} aria-expanded={open}>
        <span className="xk-course-head">
          <span className="row-title">{c.name}</span>
          {selected ? (
            <span className="xk-tag" data-tone="solid">
              已选上
            </span>
          ) : (
            orders.length > 0 && (
              <span className="xk-tag" data-tone="soft">
                第 {orders.join('、')} 志愿
              </span>
            )
          )}
        </span>
        <span className="xk-course-stats">
          {showChance && v.chance !== null ? (
            <span data-hot={v.chance < 1 || undefined}>
              <small>概率</small>
              {percent(v.chance)}
            </span>
          ) : (
            v.sections && (
              <span data-zero={v.remaining === 0 || undefined}>
                <small>余量</small>
                {v.remaining ?? '—'}
              </span>
            )
          )}
        </span>
        <span className="xk-course-sub">
          <Joined
            parts={[
              c.credit !== null && `${fmt(c.credit)} 学分`,
              ...kinds,
              c.college,
              half,
              todo && (
                <span className="xk-note" data-hot>
                  培养方案
                </span>
              ),
              done && <span className="xk-note">已修</span>
            ]}
          />
        </span>
        <Chevron />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="sections"
            className="xk-drawer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: dur(0.4), ease: EASE }}
          >
            <Drawer view={v} />
            <div className="xk-drawer-foot">
              <button className="btn xk-detail-btn" onClick={onDetail}>
                课程详情
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

function Drawer({ view: v }: { view: CourseView }) {
  const entry = useXkData((d) => d.sections[courseKey(v.course)])
  if (!entry) return <p className="quiet xk-drawer-quiet">…</p>
  if ('error' in entry.value) return <p className="quiet xk-drawer-quiet">{entry.value.error}</p>
  const all = entry.value.data
  if (all.length === 0) return <p className="quiet xk-drawer-quiet">无</p>
  const rest = all.filter((s) => !v.matching.includes(s))
  const first = v.sections ? v.matching : all
  return (
    <ul className="xk-sections">
      {first.map((s) => (
        <SectionCard key={s.id} course={v.course} section={s} />
      ))}
      {v.sections &&
        rest.map((s) => (
          <SectionCard key={s.id} course={v.course} section={s} dim />
        ))}
    </ul>
  )
}
