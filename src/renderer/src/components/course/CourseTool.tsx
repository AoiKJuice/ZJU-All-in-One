import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { XkContext, XkCourse, XkSection, XkWatch } from '@shared/xk'
import { useApp } from '@renderer/store'
import { useZju } from '@renderer/hooks/useZju'
import { Choice, Joined, Reveal } from '@renderer/components/Type'
import { MOBILE } from '@renderer/lib/platform'
import { fmt } from './bits'
import { FindPanel } from './FindPanel'
import { PrefBlock, WatchList } from './MinePanel'
import { XkEnvContext, type XkEnv } from './SectionCard'
import { Splitter, useSplit } from './Splitter'
import { TeacherSheet, errorText } from './TeacherSheet'
import { XkCourseSheet } from './XkCourseSheet'
import { XkTimetable } from './XkTimetable'
import { refreshSection, resetXkData, type Loaded } from './xkData'
import { loadFilters, partOf, planOf, saveFilters, type Filters, type Scope } from './xkFilter'
import { groupCategories, groupChosen, groupFor, groupTitle } from './xkLogic'
import './course.css'

const TERM: Record<string, string> = { '1': '秋冬', '2': '春夏' }

/**
 * 工具「选课」：三块面板。左边找课（搜索与筛选控件、课程列表，课程就地展开成教学班）；
 * 右上课表（志愿占的格子，悬停教学班时预览；点课程块选中这门课，点空白处按那天的上午 / 下午 / 晚上筛选找课）；
 * 右下我的志愿 / 订阅（选中课表里的课时只留这门）。三块之间可拖动调整大小。
 * 加入志愿一次点击、可撤销；只有退选已选上的课要二次确认
 */
export function CourseTool() {
  const notify = useApp((s) => s.notify)
  const epoch = useApp((s) => s.epoch)
  const [ctx, setCtx] = useState<Loaded<XkContext> | null>(null)
  const [filters, setFiltersState] = useState<Filters>(loadFilters)
  const [search, setSearch] = useState('')
  const [reveal, setReveal] = useState<string | null>(null)
  const [lists, setLists] = useState<Record<string, Loaded<XkCourse[]>>>({})
  const [chosen, setChosen] = useState<Loaded<XkSection[]> | null>(null)
  const [watches, setWatches] = useState<XkWatch[]>([])
  const [side, setSide] = useState<'prefs' | 'watch'>('prefs')
  const [view, setView] = useState<'find' | 'mine'>('find')
  const [hover, setHover] = useState<{ s: XkSection; general: boolean } | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [teacher, setTeacher] = useState<{ name: string; college: string } | null>(null)
  const [detail, setDetail] = useState<XkCourse | null>(null)
  const split = useSplit()
  const right = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)

  const graduation = useZju('data:graduation')
  const plan = useMemo(() => {
    const nodes = graduation.data?.nodes
    if (!nodes) return null
    const p = planOf(nodes)
    return { ...p, todoSet: new Set(p.todo.flatMap((n) => [n.code!, n.name])) }
  }, [graduation.data])
  const planError = graduation.data && !graduation.data.nodes ? (graduation.data.nodesError ?? '无') : graduation.error

  const mine = useMemo(() => (chosen && 'data' in chosen ? chosen.data : []), [chosen])
  const context = ctx && 'data' in ctx ? ctx.data : null
  const max = context?.maxChoices ?? 3
  const groups = useMemo(() => groupChosen(mine), [mine])
  const catGroups = useMemo(() => groupCategories(context?.categories ?? []), [context])

  const setFilters = useCallback((patch: Partial<Filters>, revealName?: string) => {
    setFiltersState((f) => {
      const next = { ...f, ...patch }
      saveFilters(next)
      return next
    })
    if (revealName) setReveal(revealName)
  }, [])

  // 记下的范围在这学期的类别里找不到时（或第一次打开），落到第一个大类
  useEffect(() => {
    if (!context) return
    const s = filters.scope
    const valid =
      s &&
      (s.kind === 'search' ||
        s.kind === 'plan' ||
        (s.kind === 'cat' && context.categories.some((c) => c.key === s.key)) ||
        (s.kind === 'group' && catGroups.some((g) => g.id === s.id)))
    if (valid) return
    const first = catGroups[0]
    if (!first) return
    setFilters({ scope: first.items.length > 1 ? { kind: 'group', id: first.id } : { kind: 'cat', key: first.items[0].category.key } })
  }, [context, catGroups, filters.scope, setFilters])

  // 搜全部课程：输入停顿 0.45 秒再请求
  useEffect(() => {
    if (filters.scope?.kind !== 'search') return
    const timer = setTimeout(() => setSearch(filters.keyword.trim()), 450)
    return () => clearTimeout(timer)
  }, [filters.keyword, filters.scope])

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
        (data) => setCtx({ data }),
        (e) => setCtx({ error: errorText(e) })
      ),
    []
  )

  const listLoading = useRef(new Set<string>())
  const loadList = useCallback((key: string) => {
    if (listLoading.current.has(key)) return
    listLoading.current.add(key)
    const run = key.startsWith('search|') ? window.zju['xk:search'](key.slice(7)) : window.zju['xk:courses'](key)
    run
      .then(
        (data) => setLists((all) => ({ ...all, [key]: { data } })),
        (e) => setLists((all) => ({ ...all, [key]: { error: errorText(e) } }))
      )
      .finally(() => listLoading.current.delete(key))
  }, [])

  useEffect(() => {
    setLists({})
    listLoading.current.clear()
    resetXkData()
    void refreshContext()
    void refreshChosen()
    if (MOBILE) return
    void window.zju['xk:watches']().then(setWatches)
    const timer = setInterval(() => void window.zju['xk:watches']().then(setWatches), 15_000)
    return () => clearInterval(timer)
  }, [epoch, refreshContext, refreshChosen])

  const isGeneral = useCallback(
    (c: XkCourse): boolean => /通识/.test(c.category) || catGroups.some((g) => g.id === 'general' && g.items.some((x) => x.category.id === c.tab)),
    [catGroups]
  )

  // ---- 写操作：加入 / 移出 / 调整顺序 ----
  const add = async (s: XkSection, quiet = false): Promise<void> => {
    setBusy(s.id)
    try {
      const r = await window.zju['xk:select'](s)
      const now = await window.zju['xk:selected']()
      setChosen({ data: now })
      void refreshContext()
      refreshSection(s.id)
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
      refreshSection(s.id)
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

  const watchOf = useCallback((id: string): XkWatch | undefined => watches.find((w) => w.section.id === id && !w.done), [watches])
  const unwatch = (id: string): void => void window.zju['xk:unwatch'](id).then(setWatches)

  const env: XkEnv = {
    chosen: mine,
    max,
    busy,
    watchOf,
    isGeneral,
    add: (_course, s) => void add(s),
    remove: (s) => void remove(s),
    watch: (course, s) => (watchOf(s.id) ? unwatch(s.id) : void window.zju['xk:watch'](course, s, false).then(setWatches)),
    hover: (s, course) => setHover(s && course ? { s, general: isGeneral(course) } : null),
    teacher: (name, college) => setTeacher({ name, college })
  }

  /** 志愿里点一门课：在已取到的列表里找这门课，找不到就按课名搜，打开课程详情 */
  const openCourse = async (code: string, name: string): Promise<void> => {
    for (const l of Object.values(lists)) {
      const hit = 'data' in l ? l.data.find((c) => c.code === code) : undefined
      if (hit) return setDetail(hit)
    }
    try {
      const found = (await window.zju['xk:search'](name)).find((c) => c.code === code)
      if (found) return setDetail(found)
    } catch {
      // 搜不到就在左边按课名搜
    }
    setFilters({ scope: { kind: 'search' }, keyword: name }, name)
    setView('find')
  }

  /** 志愿组的空位：普通课打开课程详情选别的教学班；通识时间组去找同一时间段的通识课 */
  const addMore = (g: (typeof groups)[number]): void => {
    const slot = g.items[0]?.slots[0]
    const general = catGroups.find((x) => x.id === 'general')
    if (g.byTime && general && slot) {
      const scope: Scope = general.items.length > 1 ? { kind: 'group', id: general.id } : { kind: 'cat', key: general.items[0].category.key }
      setFilters({ scope, keyword: '', when: { weekday: slot.weekday, part: partOf(slot.start) } })
      setView('find')
    } else void openCourse(g.items[0].courseCode, g.items[0].courseName)
  }

  const pickedGroup = groups.find((g) => g.key === picked)
  const shownGroups = pickedGroup ? [pickedGroup] : groups
  const pickedCodes = new Set(pickedGroup?.items.map((s) => s.courseCode))
  const shownWatches = pickedGroup ? watches.filter((w) => pickedCodes.has(w.section.courseCode)) : watches
  const hoverGroup = hover ? groupFor(hover.s, mine, hover.general) : null

  return (
    <XkEnvContext.Provider value={env}>
      <div
        ref={root}
        className="xk"
        data-view={view}
        style={{ '--xk-l': `${split.left}fr`, '--xk-r': `${1 - split.left}fr`, '--xk-t': `${split.top}fr`, '--xk-b': `${1 - split.top}fr` } as CSSProperties}
      >
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
          <FindPanel
            filters={filters}
            setFilters={setFilters}
            groups={catGroups}
            lists={lists}
            loadList={loadList}
            search={search}
            plan={plan}
            planError={planError}
            contextError={ctx && 'error' in ctx ? ctx.error : null}
            reveal={reveal}
            onRevealed={() => setReveal(null)}
            onDetail={setDetail}
          />
        </Reveal>

        <Splitter axis="x" container={root} onMove={(x) => split.set({ left: x })} onEnd={split.save} onReset={() => split.reset('left')} />

        <div ref={right} className="xk-right">
          <Reveal i={2} flat className="panel xk-tt-panel">
            <XkTimetable
              chosen={mine}
              preview={hover?.s ?? null}
              previewGroup={hoverGroup}
              focus={focus ?? picked}
              when={filters.when}
              onPick={(s) => {
                const key = s.group ?? s.courseCode
                setPicked(picked === key ? null : key)
                setSide('prefs')
              }}
              onCell={(weekday, part) => {
                const same = filters.when?.weekday === weekday && filters.when.part === part
                setFilters({ when: same ? null : { weekday, part } })
                if (!same) setView('find')
              }}
            />
          </Reveal>

          <Splitter axis="y" container={right} onMove={(y) => split.set({ top: y })} onEnd={split.save} onReset={() => split.reset('top')} />

          <Reveal i={3} flat className="panel xk-mine">
            <div className="xk-mine-head">
              <span className="xk-mine-tabs">
                {/* 订阅只在桌面端 */}
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
                {pickedGroup && (
                  <button className="xk-ctl" data-on onClick={() => setPicked(null)}>
                    <span className="xk-ctl-value">{pickedGroup.byTime ? groupTitle(pickedGroup) : pickedGroup.items[0].courseName}</span>
                    <svg className="xk-ctl-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                      <path d="M8 8l8 8M16 8l-8 8" />
                    </svg>
                  </button>
                )}
              </span>
              {context && (
                <span className="xk-mine-meta">
                  <Joined parts={[TERM[context.xq] ?? '', context.credits && `${fmt(context.credits.total)} 学分`]} />
                </span>
              )}
            </div>
            <div className="pane-scroll xk-groups">
              {side === 'watch' && !MOBILE ? (
                <WatchList watches={shownWatches} onOpen={(w) => setDetail(w.course)} onUnwatch={unwatch} onAuto={(w, auto) => void window.zju['xk:watch'](w.course, w.section, auto).then(setWatches)} />
              ) : !chosen ? (
                <p className="quiet">…</p>
              ) : 'error' in chosen ? (
                <p className="quiet">{chosen.error}</p>
              ) : shownGroups.length === 0 ? (
                <p className="quiet">无</p>
              ) : (
                shownGroups.map((g) => (
                  <PrefBlock
                    key={g.key}
                    group={g}
                    chosen={mine}
                    max={max}
                    busy={busy}
                    picked={g.key === picked}
                    onFocus={setFocus}
                    onOpen={(s) => void openCourse(s.courseCode, s.courseName)}
                    onAddMore={() => addMore(g)}
                    onMove={(i, step) => void move(g.items, i, step)}
                    onRemove={(s) => void remove(s)}
                  />
                ))
              )}
            </div>
          </Reveal>
        </div>

        <XkCourseSheet course={detail} onClose={() => setDetail(null)} />
        <TeacherSheet teacher={teacher} onClose={() => setTeacher(null)} />
      </div>
    </XkEnvContext.Provider>
  )
}
