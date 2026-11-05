import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  areasIn,
  type LibArea,
  type LibBooking,
  type LibBuilding,
  type LibFloor,
  type LibOverview,
  type LibPreset,
  type LibScope,
  type LibSeat,
  type LibSegment,
  type LibWatch
} from '@shared/library'
import { useApp } from '@renderer/store'
import { Choice, Joined, Quiet, Reveal } from '@renderer/components/Type'
import { MOBILE } from '@renderer/lib/platform'
import { dur } from '@renderer/lib/motion'
import './library.css'

const EASE = [0.22, 1, 0.36, 1] as const

type Loaded<T> = { data: T } | { error: string }
type Mark = 'on' | 'implied' | 'partial' | undefined

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

/** 2026-11-04 → 今天 / 明天 / 11月6日 */
function dayLabel(day: string, dates: string[]): string {
  const i = dates.indexOf(day)
  if (i === 0) return '今天'
  if (i === 1) return '明天'
  return monthDay(day)
}

/** YYYY-MM-DD… → 11月4日 */
function monthDay(day: string): string {
  const [, m, d] = day.slice(0, 10).split('-').map(Number)
  return `${m}月${d}日`
}

/** 每天检查时段的几个常用档，其余自定义 */
const WINDOWS = [
  { label: '全天', from: '08:00', to: '22:30' },
  { label: '上午', from: '08:00', to: '12:00' },
  { label: '下午', from: '12:00', to: '18:00' },
  { label: '晚上', from: '18:00', to: '22:30' }
]
const windowLabel = (from: string, to: string): string => WINDOWS.find((w) => w.from === from && w.to === to)?.label ?? `${from}–${to}`

const sameScope = (a: LibScope, b: LibScope): boolean => a.kind === b.kind && a.id === b.id
const sameScopes = (a: LibScope[], b: LibScope[]): boolean => a.length === b.length && a.every((s) => b.some((x) => sameScope(s, x)))

/** 若干范围的简称：一处写全名，多处写「第一处 等 N 处」 */
const scopeTitle = (scopes: LibScope[]): string => (scopes.length > 1 ? `${scopes[0].label} 等 ${scopes.length} 处` : (scopes[0]?.label ?? ''))

const minutes = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
/** 现在（北京时间）是否在每天的检查时段里，时段可跨零点 */
function inWindow(from: string, to: string): boolean {
  const now = minutes(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()))
  const a = minutes(from)
  const b = minutes(to)
  return a <= b ? now >= a && now < b : now >= a || now < b
}

const ago = (t: number): string => {
  const m = Math.floor((Date.now() - t) / 60_000)
  return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : `${Math.floor(m / 60)} 小时前`
}

/** 正在生效的预约（可取消的、或状态表明还没结束的） */
const isCurrent = (b: LibBooking): boolean => b.canCancel || /待签到|使用中|已签到|暂离|预约成功/.test(b.status)

/**
 * 勾选 / 取消一项范围。勾上一馆（层）即包含其下全部；在已勾的上级里取消一个下级时，
 * 上级拆成其余的兄弟项，免得要先取消整馆再一个个勾回来
 */
function toggleScope(buildings: LibBuilding[], picked: LibScope[], kind: LibScope['kind'], id: string): LibScope[] {
  for (const b of buildings) {
    const bScope: LibScope = { kind: 'building', id: b.id, label: b.name }
    const bPicked = picked.some((s) => sameScope(s, bScope))
    const floorScope = (f: LibFloor): LibScope => ({ kind: 'floor', id: f.id, label: `${b.name} ${f.name}` })
    if (kind === 'building' && b.id === id) {
      if (bPicked) return picked.filter((s) => !sameScope(s, bScope))
      const inside = new Set(b.floors.flatMap((f) => [`floor${f.id}`, ...f.areas.map((a) => `area${a.id}`)]))
      return [...picked.filter((s) => !inside.has(`${s.kind}${s.id}`)), bScope]
    }
    for (const f of b.floors) {
      const fScope = floorScope(f)
      const fPicked = picked.some((s) => sameScope(s, fScope))
      const areaScope = (a: LibArea): LibScope => ({ kind: 'area', id: a.id, label: `${b.name} ${f.name} ${a.name}` })
      if (kind === 'floor' && f.id === id) {
        if (fPicked) return picked.filter((s) => !sameScope(s, fScope))
        if (bPicked) return [...picked.filter((s) => !sameScope(s, bScope)), ...b.floors.filter((x) => x.id !== id).map(floorScope)]
        return [...picked.filter((s) => !(s.kind === 'area' && f.areas.some((a) => a.id === s.id))), fScope]
      }
      const area = kind === 'area' ? f.areas.find((a) => a.id === id) : undefined
      if (!area) continue
      const aScope = areaScope(area)
      if (picked.some((s) => sameScope(s, aScope))) return picked.filter((s) => !sameScope(s, aScope))
      const siblings = f.areas.filter((a) => a.id !== id).map(areaScope)
      if (fPicked) return [...picked.filter((s) => !sameScope(s, fScope)), ...siblings]
      if (bPicked) return [...picked.filter((s) => !sameScope(s, bScope)), ...b.floors.filter((x) => x.id !== f.id).map(floorScope), ...siblings]
      return [...picked, aScope]
    }
  }
  return picked
}

/** 订阅表单的初值：新订阅为空，编辑套餐时带上套餐 */
interface Seed {
  key: number
  preset?: LibPreset
}

/**
 * 工具「图书馆预约」。上方「当前预约」只放正在生效的预约；左边按馆 → 层 → 区域看余座，
 * 点区域行即勾选（行尾「选座」才展开空座），右边是订阅：没勾选时列出进行中的订阅与套餐（一键复用），
 * 一勾选就变成三步的新订阅表单（区域、时段、方式），可顺带存为套餐。手机端只有当前预约与选座
 */
export function LibraryTool() {
  const notify = useApp((s) => s.notify)
  const epoch = useApp((s) => s.epoch)
  const [overview, setOverview] = useState<Loaded<LibOverview> | null>(null)
  const [date, setDate] = useState<string | undefined>(undefined)
  const [building, setBuilding] = useState<string | null>(null)
  const [floor, setFloor] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [bookings, setBookings] = useState<LibBooking[]>([])
  const [watches, setWatches] = useState<LibWatch[]>([])
  const [presets, setPresets] = useState<LibPreset[]>([])
  const [picked, setPicked] = useState<LibScope[]>([])
  const [seed, setSeed] = useState<Seed>({ key: 0 })
  const [fresh, setFresh] = useState<string | null>(null)

  const data = overview && 'data' in overview ? overview.data : null
  const current = data?.buildings.find((b) => b.id === building) ?? data?.buildings[0]
  const floorNow = current?.floors.find((f) => f.id === floor) ?? current?.floors[0]

  const loadOverview = useCallback(
    (day?: string) =>
      window.zju['lib:overview'](day).then(
        (d) => setOverview({ data: d }),
        (e) => setOverview((old) => (old && 'data' in old ? old : { error: errorText(e) }))
      ),
    []
  )
  const loadBookings = useCallback(() => window.zju['lib:bookings']().then(setBookings, () => setBookings([])), [])

  // 开着时每分钟静默刷新余座；订阅（桌面端）每 15 秒取一次，看后台查到的余座
  useEffect(() => {
    void loadOverview(date)
    const timer = setInterval(() => void loadOverview(date), 60_000)
    return () => clearInterval(timer)
  }, [epoch, date, loadOverview])

  useEffect(() => {
    void loadBookings()
    if (MOBILE) return
    void window.zju['lib:presets']().then(setPresets)
    void window.zju['lib:watches']().then(setWatches)
    const timer = setInterval(() => void window.zju['lib:watches']().then(setWatches), 15_000)
    return () => clearInterval(timer)
  }, [epoch, loadBookings])

  // 已在订阅里的区域：名称旁带小标签
  const watched = useMemo(() => {
    const map = new Map<string, boolean>()
    if (!data) return map
    for (const w of watches.filter((x) => !x.done && !x.paused)) for (const a of areasIn(data, w.scopes)) map.set(a.area.id, map.get(a.area.id) || w.auto)
    return map
  }, [data, watches])

  const pick = (kind: LibScope['kind'], id: string): void => {
    if (data) setPicked((list) => toggleScope(data.buildings, list, kind, id))
  }
  const has = (kind: LibScope['kind'], id: string): boolean => picked.some((s) => s.kind === kind && s.id === id)

  const buildingMark = (b: LibBuilding): Mark =>
    has('building', b.id) ? 'on' : b.floors.some((f) => has('floor', f.id) || f.areas.some((a) => has('area', a.id))) ? 'partial' : undefined
  const floorMark = (b: LibBuilding, f: LibFloor): Mark =>
    has('floor', f.id) ? 'on' : has('building', b.id) ? 'implied' : f.areas.some((a) => has('area', a.id)) ? 'partial' : undefined
  const areaMark = (b: LibBuilding, f: LibFloor, a: LibArea): Mark => (has('area', a.id) ? 'on' : has('floor', f.id) || has('building', b.id) ? 'implied' : undefined)

  const reserve = async (area: LibArea, seat: LibSeat, segment: LibSegment): Promise<void> => {
    try {
      const r = await window.zju['lib:reserve'](area.id, seat.id, segment)
      notify(r.status === 'saved' ? `已预约 ${seat.name} 号` : r.message || '结果未知')
      if (r.status === 'saved') setOpen(null)
    } catch (e) {
      notify(errorText(e))
    }
    void loadBookings()
    void loadOverview(date)
  }

  const cancel = async (b: LibBooking): Promise<void> => {
    try {
      const r = await window.zju['lib:cancel'](b.id)
      notify(r.status === 'saved' ? '已取消预约' : r.message || '结果未知')
    } catch (e) {
      notify(errorText(e))
    }
    void loadBookings()
    void loadOverview(date)
  }

  /** 订阅：同样的范围与时段已有一条时改它，不另起一条 */
  const subscribe = async (input: { scopes: LibScope[]; from: string; to: string; auto: boolean; name?: string }): Promise<void> => {
    const same = watches.find((w) => sameScopes(w.scopes, input.scopes) && w.from === input.from && w.to === input.to)
    const list = await window.zju['lib:watch']({ ...input, id: same?.id })
    setWatches(list)
    setFresh(same?.id ?? list.at(-1)?.id ?? null)
    notify(input.auto ? '已开始自动预约' : '已开始订阅')
  }

  const savePreset = async (preset: Omit<LibPreset, 'id'> & { id?: string }): Promise<void> => {
    setPresets(await window.zju['lib:savePreset'](preset))
  }

  const finish = (): void => {
    setPicked([])
    setSeed((s) => ({ key: s.key + 1 }))
  }

  const editPreset = (p: LibPreset): void => {
    setPicked(p.scopes)
    setSeed((s) => ({ key: s.key + 1, preset: p }))
  }

  const live = bookings.filter(isCurrent)
  const composing = picked.length > 0 || seed.preset !== undefined

  return (
    <div className="lib">
      <AnimatePresence initial={false}>
        {live.length > 0 && (
          <motion.section
            key="now"
            className="lib-now"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: dur(0.4), ease: EASE }}
          >
            <div className="lib-now-inner">
              {live.map((b) => (
                <CurrentBooking key={b.id} booking={b} onCancel={cancel} />
              ))}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <div className="lib-main">
        <Reveal i={1} flat className="panel lib-find">
          <div className="lib-head">
            <span className="lib-choices">
              {data?.dates.map((d) => (
                <Choice key={d} group="lib-date" active={d === data.date} onClick={() => setDate(d)}>
                  {dayLabel(d, data.dates)}
                </Choice>
              ))}
            </span>
            {!MOBILE && current && (
              <button className="lib-all" data-mark={buildingMark(current)} onClick={() => pick('building', current.id)}>
                <Box mark={buildingMark(current)} />
                全选本馆
              </button>
            )}
          </div>
          <div className="lib-tabs">
            {data?.buildings.map((b) => (
              <Choice key={b.id} group="lib-building" className="small" active={b.id === current?.id} onClick={() => {
                  setBuilding(b.id)
                  setFloor(null)
                  setOpen(null)
                }}>
                {b.name}
                <span className="lib-tab-free">{b.free ?? ''}</span>
                {!MOBILE && buildingMark(b) && <span className="lib-tab-dot" aria-hidden />}
              </Choice>
            ))}
          </div>
          <div className="lib-list">
            {!overview ? (
              <Quiet loading error={null} empty="无" />
            ) : 'error' in overview ? (
              <Quiet loading={false} error={overview.error} empty="无" />
            ) : !current || !floorNow ? (
              <p className="quiet">无</p>
            ) : (
              <div className="lib-browse">
                {/* 楼层：左侧一列只管切换，勾选在右边卡片里 */}
                <nav className="lib-rail" aria-label="楼层">
                  {current.floors.map((f) => (
                    <button
                      key={f.id}
                      className="lib-rail-item"
                      data-active={f.id === floorNow.id || undefined}
                      onClick={() => {
                        setFloor(f.id)
                        setOpen(null)
                      }}
                    >
                      <span className="lib-rail-name">
                        {f.name}
                        {!MOBILE && floorMark(current, f) && <span className="lib-tab-dot" aria-hidden />}
                      </span>
                      <Meter free={f.free} total={f.total} />
                    </button>
                  ))}
                </nav>

                <section className="lib-floor">
                  <header className="lib-floor-head">
                    <h3 className="lib-floor-name">{floorNow.name}</h3>
                    {!MOBILE && (
                      <button className="lib-all" data-mark={floorMark(current, floorNow)} onClick={() => pick('floor', floorNow.id)}>
                        <Box mark={floorMark(current, floorNow)} />
                        全选本层
                      </button>
                    )}
                  </header>
                  <ul className="pane-scroll lib-areas">
                    {floorNow.areas.map((a) => {
                      const expanded = open === a.id
                      const mark = areaMark(current, floorNow, a)
                      const watching = watched.get(a.id)
                      const body = (
                        <>
                          <span className="lib-area-name">
                            {a.name}
                            {watching !== undefined && <span className="lib-tag" data-tone="soft">{watching ? '自动预约' : '订阅中'}</span>}
                          </span>
                          <Meter free={a.free} total={a.total} />
                        </>
                      )
                      return (
                        <li key={a.id} className="lib-area" data-open={expanded || undefined} data-mark={mark}>
                          {MOBILE ? (
                            <button className="lib-area-hit" onClick={() => setOpen(expanded ? null : a.id)} aria-expanded={expanded}>
                              {body}
                              <Chevron />
                            </button>
                          ) : (
                            <div className="lib-area-row">
                              <button className="lib-area-hit" aria-pressed={mark !== undefined} onClick={() => pick('area', a.id)}>
                                <Box mark={mark} />
                                {body}
                              </button>
                              <button className="lib-seat-btn" data-on={expanded || undefined} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : a.id)}>
                                选座
                                <Chevron />
                              </button>
                            </div>
                          )}
                          <AnimatePresence initial={false}>
                            {expanded && (
                              <motion.div
                                key="seats"
                                className="lib-drawer"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: dur(0.4), ease: EASE }}
                              >
                                <SeatPicker area={a} day={overview.data.date} onReserve={reserve} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              </div>
            )}
          </div>
        </Reveal>

        {!MOBILE && (
          <Reveal i={2} flat className="panel lib-side">
            <AnimatePresence mode="wait" initial={false}>
              {composing ? (
                <motion.div key={`compose${seed.key}`} className="lib-side-body" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: dur(0.3), ease: EASE }}>
                  <Composer
                    scopes={picked}
                    overview={data}
                    preset={seed.preset}
                    onRemove={(s) => setPicked((list) => list.filter((x) => !sameScope(x, s)))}
                    onClose={finish}
                    onSubscribe={async (input) => {
                      await subscribe(input)
                      finish()
                    }}
                    onSavePreset={async (preset) => {
                      await savePreset(preset)
                      notify(preset.id ? '已更新套餐' : '已存为套餐')
                      finish()
                    }}
                  />
                </motion.div>
              ) : (
                <motion.div key="idle" className="lib-side-body" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: dur(0.3), ease: EASE }}>
                  <h2 className="lib-side-title">订阅</h2>
                  {watches.length === 0 && presets.length === 0 ? (
                    <Steps active={0} />
                  ) : (
                    <div className="pane-scroll lib-side-scroll">
                      {watches.length > 0 && (
                        <section className="lib-group">
                          <h3 className="lib-group-head">我的订阅</h3>
                          <ul className="lib-cards">
                            {watches.map((w) => (
                              <WatchCard
                                key={w.id}
                                watch={w}
                                fresh={w.id === fresh}
                                saved={presets.some((p) => sameScopes(p.scopes, w.scopes) && p.from === w.from && p.to === w.to)}
                                onAuto={async (auto) => setWatches(await window.zju['lib:watch']({ id: w.id, name: w.name, scopes: w.scopes, from: w.from, to: w.to, auto }))}
                                onPause={async (paused) => setWatches(await window.zju['lib:watch']({ id: w.id, name: w.name, scopes: w.scopes, from: w.from, to: w.to, auto: w.auto, paused }))}
                                onRemove={async () => setWatches(await window.zju['lib:unwatch'](w.id))}
                                onSave={async () => {
                                  await savePreset({ name: w.name ?? scopeTitle(w.scopes), scopes: w.scopes, from: w.from, to: w.to })
                                  notify('已存为套餐')
                                }}
                              />
                            ))}
                          </ul>
                        </section>
                      )}
                      {presets.length > 0 && (
                        <section className="lib-group">
                          <h3 className="lib-group-head">套餐</h3>
                          <ul className="lib-cards">
                            {presets.map((p) => (
                              <PresetCard
                                key={p.id}
                                preset={p}
                                live={watches.find((w) => !w.done && !w.paused && sameScopes(w.scopes, p.scopes) && w.from === p.from && w.to === p.to)}
                                onSubscribe={(auto) => void subscribe({ name: p.name, scopes: p.scopes, from: p.from, to: p.to, auto })}
                                onEdit={() => editPreset(p)}
                                onRemove={async () => setPresets(await window.zju['lib:removePreset'](p.id))}
                              />
                            ))}
                          </ul>
                        </section>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </Reveal>
        )}
      </div>
    </div>
  )
}

/** 订阅三步：空状态里只亮第一步，表单里各节用同样的编号 */
function Steps({ active }: { active: number }) {
  return (
    <ol className="lib-steps">
      {['勾选区域', '设定时段', '开始订阅'].map((t, i) => (
        <li key={t} data-on={i === active || undefined}>
          <span className="lib-step-no">{i + 1}</span>
          {t}
        </li>
      ))}
    </ol>
  )
}

/** 新订阅 / 编辑套餐：① 区域（左边勾选）② 每天检查的时段 ③ 有空座时通知我还是自动预约；填了套餐名就顺带存为套餐 */
function Composer(props: {
  scopes: LibScope[]
  overview: LibOverview | null
  preset?: LibPreset
  onRemove: (s: LibScope) => void
  onClose: () => void
  onSubscribe: (input: { scopes: LibScope[]; from: string; to: string; auto: boolean; name?: string }) => Promise<void>
  onSavePreset: (preset: Omit<LibPreset, 'id'> & { id?: string }) => Promise<void>
}) {
  const { scopes, preset } = props
  const [from, setFrom] = useState(preset?.from ?? WINDOWS[0].from)
  const [to, setTo] = useState(preset?.to ?? WINDOWS[0].to)
  const [custom, setCustom] = useState(preset ? !WINDOWS.some((w) => w.from === preset.from && w.to === preset.to) : false)
  const [auto, setAuto] = useState(false)
  const [name, setName] = useState(preset?.name ?? '')
  const [busy, setBusy] = useState(false)

  const areas = props.overview ? areasIn(props.overview, scopes) : []
  const free = areas.reduce((n, a) => n + (a.area.free ?? 0), 0)
  const total = areas.reduce((n, a) => n + (a.area.total ?? 0), 0)
  const ready = scopes.length > 0 && Boolean(from && to && from !== to)

  const run = async (job: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await job()
    } finally {
      setBusy(false)
    }
  }
  const presetInput = (): Omit<LibPreset, 'id'> & { id?: string } => ({ ...(preset ? { id: preset.id } : {}), name: name.trim() || scopeTitle(scopes), scopes, from, to })
  const start = (): Promise<void> =>
    run(async () => {
      if (name.trim()) await props.onSavePreset(presetInput())
      await props.onSubscribe({ scopes, from, to, auto, ...(name.trim() ? { name: name.trim() } : {}) })
    })

  return (
    <div className="lib-compose">
      <div className="lib-compose-head">
        <h2 className="lib-side-title">{preset ? '编辑套餐' : '新订阅'}</h2>
        <IconButton label="关闭" onClick={props.onClose}>
          <path d="M7 7l10 10M17 7L7 17" />
        </IconButton>
      </div>
      <div className="pane-scroll lib-side-scroll">
        <section className="lib-step">
          <h3 className="lib-step-head">
            <span className="lib-step-no" data-done={scopes.length > 0 || undefined}>
              1
            </span>
            区域
            {areas.length > 0 && (
              <span className="lib-step-meta">
                <Joined parts={[`${areas.length} 个区域`, `余 ${free} / ${total}`]} />
              </span>
            )}
          </h3>
          {scopes.length === 0 ? (
            <p className="lib-step-empty">勾选左侧区域</p>
          ) : (
            <ul className="lib-scopes">
              {scopes.map((s) => (
                <li key={`${s.kind}${s.id}`} className="lib-scope">
                  {s.label}
                  <button aria-label="移出" title="移出" onClick={() => props.onRemove(s)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                      <path d="M8 8l8 8M16 8l-8 8" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="lib-step">
          <h3 className="lib-step-head">
            <span className="lib-step-no" data-done>
              2
            </span>
            每天检查的时段
          </h3>
          <div className="lib-options">
            {WINDOWS.map((w) => (
              <Choice
                key={w.label}
                group="lib-window"
                className="small"
                active={!custom && from === w.from && to === w.to}
                onClick={() => {
                  setCustom(false)
                  setFrom(w.from)
                  setTo(w.to)
                }}
              >
                {w.label}
                <span className="lib-option-sub">
                  {w.from}–{w.to}
                </span>
              </Choice>
            ))}
            <Choice group="lib-window" className="small" active={custom} onClick={() => setCustom(true)}>
              自定义
            </Choice>
          </div>
          {custom && (
            <span className="lib-window">
              <input className="field lib-time" type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="每天开始" />
              <span className="lib-dash">–</span>
              <input className="field lib-time" type="time" value={to} onChange={(e) => setTo(e.target.value)} aria-label="每天结束" />
            </span>
          )}
        </section>

        <section className="lib-step">
          <h3 className="lib-step-head">
            <span className="lib-step-no" data-done>
              3
            </span>
            有空座时
          </h3>
          <div className="lib-modes">
            <ModeCard on={!auto} title="通知我" icon={<BellGlyph />} onClick={() => setAuto(false)} />
            <ModeCard on={auto} title="自动预约" icon={<BoltGlyph />} onClick={() => setAuto(true)} />
          </div>
        </section>

        <section className="lib-step">
          <h3 className="lib-step-head lib-step-head-quiet">套餐名</h3>
          <input className="field lib-name-field" placeholder={scopes.length ? scopeTitle(scopes) : '套餐名'} value={name} onChange={(e) => setName(e.target.value)} aria-label="套餐名" />
        </section>
      </div>

      <div className="lib-compose-acts">
        <button className="btn" disabled={!ready || busy} onClick={() => void run(() => props.onSavePreset(presetInput()))}>
          {preset ? '保存套餐' : '只存为套餐'}
        </button>
        {auto ? (
          <ArmedButton className="btn btn-solid" label="开始自动预约" confirm="确认授权" disabled={!ready || busy} onRun={() => void start()} />
        ) : (
          <button className="btn btn-solid" disabled={!ready || busy} onClick={() => void start()}>
            开始订阅
          </button>
        )}
      </div>
    </div>
  )
}

function ModeCard({ on, title, icon, onClick }: { on: boolean; title: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button className="lib-mode" data-on={on || undefined} aria-pressed={on} onClick={onClick}>
      <span className="lib-mode-icon">{icon}</span>
      <span className="lib-mode-title">{title}</span>
      <span className="lib-radio" aria-hidden />
    </button>
  )
}

/** 我的订阅：名称与范围、每天的检查时段、现在的余座；自动预约勾选，停止 / 继续、存为套餐、删除为图标 */
function WatchCard(props: {
  watch: LibWatch
  fresh: boolean
  saved: boolean
  onAuto: (auto: boolean) => void
  onPause: (paused: boolean) => void
  onRemove: () => void
  onSave: () => void
}) {
  const { watch: w } = props
  const active = inWindow(w.from, w.to)
  const stopped = Boolean(w.paused || w.done)
  const status = w.paused ? '已停止' : w.done ? w.done : !active ? `${w.from} 开始` : w.free === null ? '未查过' : w.free ? `余 ${w.free}` : '满座'
  return (
    <li className="lib-card" data-done={stopped || undefined} data-fresh={props.fresh || undefined}>
      <div className="lib-card-top">
        <span className="min-w-0">
          <span className="lib-card-title">{w.name ?? scopeTitle(w.scopes)}</span>
          <ScopeLine scopes={w.scopes} />
        </span>
        <span className="lib-card-status" data-tone={w.done && !w.paused ? 'done' : !stopped && active && w.free ? 'free' : undefined}>
          {status}
        </span>
      </div>
      <div className="lib-card-bottom">
        <span className="lib-sub">
          <Joined parts={[`每天 ${windowLabel(w.from, w.to)}`, !stopped && w.checkedAt && `${ago(w.checkedAt)}查过`]} />
        </span>
        <span className="lib-acts">
          {!stopped && <AutoCheck on={w.auto} onChange={props.onAuto} />}
          {stopped ? (
            <IconButton label={w.done && !w.paused ? '重新开始' : '继续'} onClick={() => props.onPause(false)}>
              <path d="M8.5 6.5v11l9-5.5Z" />
            </IconButton>
          ) : (
            <IconButton label="停止" onClick={() => props.onPause(true)}>
              <path d="M9 6.5v11M15 6.5v11" />
            </IconButton>
          )}
          {!props.saved && (
            <IconButton label="存为套餐" onClick={props.onSave}>
              <path d="M7 4.5h10v15l-5-3.5-5 3.5Z" />
            </IconButton>
          )}
          <ArmedIcon label="删除" confirm="确认删除" onRun={props.onRemove}>
            <TrashPath />
          </ArmedIcon>
        </span>
      </div>
    </li>
  )
}

/** 套餐：一键开始订阅 / 自动预约；编辑载回左边的勾选与订阅表单 */
function PresetCard(props: { preset: LibPreset; live: LibWatch | undefined; onSubscribe: (auto: boolean) => void; onEdit: () => void; onRemove: () => void }) {
  const { preset: p, live } = props
  return (
    <li className="lib-card lib-preset">
      <div className="lib-card-top">
        <span className="min-w-0">
          <span className="lib-card-title">{p.name}</span>
          <ScopeLine scopes={p.scopes} />
        </span>
        {live && (
          <span className="lib-tag" data-tone="soft">
            {live.auto ? '自动预约中' : '订阅中'}
          </span>
        )}
      </div>
      <div className="lib-card-bottom">
        <span className="lib-sub">
          <Joined parts={[`每天 ${windowLabel(p.from, p.to)}`]} />
        </span>
        <span className="lib-acts">
          {!live && (
            <>
              <button className="btn lib-btn-sm" onClick={() => props.onSubscribe(false)}>
                开始订阅
              </button>
              <ArmedButton className="btn btn-solid lib-btn-sm" label="自动预约" confirm="确认授权" onRun={() => props.onSubscribe(true)} />
            </>
          )}
          <IconButton label="编辑" onClick={props.onEdit}>
            <path d="M5 19l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L9 17.5Z" />
            <path d="M13.5 7l3 3" />
          </IconButton>
          <ArmedIcon label="删除" confirm="确认删除" onRun={props.onRemove}>
            <TrashPath />
          </ArmedIcon>
        </span>
      </div>
    </li>
  )
}

/** 范围小标签：最多三个，其余写 +N */
function ScopeLine({ scopes }: { scopes: LibScope[] }) {
  return (
    <span className="lib-scope-line">
      {scopes.slice(0, 3).map((s) => (
        <span key={`${s.kind}${s.id}`} className="lib-mini">
          {s.label}
        </span>
      ))}
      {scopes.length > 3 && <span className="lib-mini">+{scopes.length - 3}</span>}
    </span>
  )
}

/** 「自动预约」勾选：勾上要再点一次确认授权，取消直接生效 */
function AutoCheck({ on, onChange }: { on: boolean; onChange: (auto: boolean) => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <button
      className="lib-auto"
      data-on={on || undefined}
      data-armed={armed || undefined}
      aria-pressed={on}
      onClick={() => {
        if (on) return onChange(false)
        if (!armed) return setArmed(true)
        setArmed(false)
        onChange(true)
      }}
    >
      <Box mark={on ? 'on' : undefined} />
      {armed ? '确认自动预约' : '自动预约'}
    </button>
  )
}

function TrashPath() {
  return (
    <>
      <path d="M5 7h14M10 4.5h4M7 7l.8 11.2a1.5 1.5 0 0 0 1.5 1.3h5.4a1.5 1.5 0 0 0 1.5-1.3L17 7" />
      <path d="M10.5 10.5v5.5M13.5 10.5v5.5" />
    </>
  )
}

/** 图标式的写操作：第一次点击展开成「确认…」，3 秒内再点才执行 */
function ArmedIcon({ label, confirm, onRun, children }: { label: string; confirm: string; onRun: () => void; children: ReactNode }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <button
      className="lib-icon"
      data-armed={armed || undefined}
      aria-label={armed ? confirm : label}
      title={armed ? confirm : label}
      onClick={() => {
        if (!armed) return setArmed(true)
        setArmed(false)
        onRun()
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
      {armed && <span className="lib-icon-confirm">{confirm}</span>}
    </button>
  )
}

function CurrentBooking({ booking: b, onCancel }: { booking: LibBooking; onCancel: (b: LibBooking) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="lib-booking">
      <span className="lib-booking-mark" aria-hidden>
        <SeatGlyph />
      </span>
      <span className="min-w-0">
        <span className="lib-card-title">{b.place}</span>
        <span className="lib-sub">
          <Joined parts={[monthDay(b.begin), `${b.begin.slice(11)}–${b.end.slice(11)}`]} />
        </span>
      </span>
      <span className="lib-tag" data-tone="soft">
        {b.status}
      </span>
      {b.canCancel && (
        <ArmedButton
          className="btn lib-btn-sm"
          label={busy ? '取消中' : '取消预约'}
          confirm="确认取消"
          disabled={busy}
          onRun={() => {
            setBusy(true)
            void onCancel(b).finally(() => setBusy(false))
          }}
        />
      )}
    </div>
  )
}

function Count({ free, total }: { free: number | null; total: number | null }) {
  return (
    <span className="lib-count" data-full={free === 0 || undefined}>
      {free ?? '—'}
      {total !== null && <small>/ {total}</small>}
    </span>
  )
}

/** 余座大数字 + 余量条：左绿为剩余，右红为已占 */
function Meter({ free, total }: { free: number | null; total: number | null }) {
  const left = total ? Math.max(0, Math.min(1, (free ?? 0) / total)) : null
  return (
    <span className="lib-meter" data-full={free === 0 || undefined}>
      <Count free={free} total={total} />
      {left !== null && (
        <span className="lib-gauge">
          <span style={{ width: `${left * 100}%` }} />
        </span>
      )}
    </span>
  )
}

/** 勾选框：on 勾上，implied 由整层 / 整馆带上，partial 下面有一部分勾上 */
function Box({ mark }: { mark: Mark }) {
  return (
    <span className="lib-box" data-mark={mark} aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {mark === 'partial' ? <path d="M4.5 8h7" /> : <path d="M4 8.3l2.6 2.5L12 5.4" />}
      </svg>
    </span>
  )
}

function Chevron() {
  return (
    <svg className="lib-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function BellGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5h-14Z" />
      <path d="M10.2 20.2a2 2 0 0 0 3.6 0" />
    </svg>
  )
}

function BoltGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 3.5 5.5 13.5H12l-1 7 7.5-10H12Z" />
    </svg>
  )
}

function SeatGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 11V6.5A2.5 2.5 0 0 1 9.5 4h5A2.5 2.5 0 0 1 17 6.5V11" />
      <path d="M5 11h14v4H5Z" />
      <path d="M7 15v5M17 15v5" />
    </svg>
  )
}

/** 展开的区域：选时段，再从空座里点一个，二次点击预约 */
function SeatPicker({ area, day, onReserve }: { area: LibArea; day: string; onReserve: (a: LibArea, s: LibSeat, seg: LibSegment) => Promise<void> }) {
  const [segments, setSegments] = useState<Loaded<LibSegment[]> | null>(null)
  const [segment, setSegment] = useState<LibSegment | null>(null)
  const [seats, setSeats] = useState<Loaded<LibSeat[]> | null>(null)
  const [seat, setSeat] = useState<LibSeat | null>(null)
  const [busy, setBusy] = useState(false)
  // 预约后重取座位
  const [round, setRound] = useState(0)

  useEffect(() => {
    let alive = true
    setSegments(null)
    window.zju['lib:segments'](area.id).then(
      (all) => {
        if (!alive) return
        const list = all.filter((s) => s.day === day)
        setSegments({ data: list })
        setSegment(list[0] ?? null)
      },
      (e) => alive && setSegments({ error: errorText(e) })
    )
    return () => {
      alive = false
    }
  }, [area.id, day])

  useEffect(() => {
    if (!segment) return
    let alive = true
    setSeats(null)
    setSeat(null)
    window.zju['lib:seats'](area.id, segment).then(
      (data) => alive && setSeats({ data }),
      (e) => alive && setSeats({ error: errorText(e) })
    )
    return () => {
      alive = false
    }
  }, [area.id, segment, round])

  if (!segments) return <p className="quiet lib-drawer-quiet">…</p>
  if ('error' in segments) return <p className="quiet lib-drawer-quiet">{segments.error}</p>
  if (segments.data.length === 0) return <p className="quiet lib-drawer-quiet">无</p>
  const free = seats && 'data' in seats ? seats.data.filter((s) => s.state === 'free') : []

  return (
    <div className="lib-picker">
      {segments.data.length > 1 && (
        <div className="lib-segs">
          {segments.data.map((s) => (
            <Choice key={s.id} group={`lib-seg-${area.id}`} className="small" active={s.id === segment?.id} onClick={() => setSegment(s)}>
              {s.start}–{s.end}
            </Choice>
          ))}
        </div>
      )}
      {!seats ? (
        <p className="quiet lib-drawer-quiet">…</p>
      ) : 'error' in seats ? (
        <p className="quiet lib-drawer-quiet">{seats.error}</p>
      ) : free.length === 0 ? (
        <p className="quiet lib-drawer-quiet">无</p>
      ) : (
        <ul className="lib-seats">
          {free.map((s) => (
            <li key={s.id}>
              <button className="lib-seat" data-on={s.id === seat?.id || undefined} onClick={() => setSeat(s.id === seat?.id ? null : s)}>
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {segment && free.length > 0 && (
        <div className="lib-picker-acts">
          <span className="lib-chips">
            <Joined parts={[segments.data.length === 1 && `${segment.start}–${segment.end}`, seat && `${seat.name} 号`]} />
          </span>
          <ArmedButton
            className="btn btn-solid"
            label={busy ? '预约中' : seat ? `预约 ${seat.name} 号` : '选一个座位'}
            confirm="确认预约"
            disabled={!seat || busy}
            onRun={() => {
              if (!seat) return
              setBusy(true)
              void onReserve(area, seat, segment).finally(() => {
                setBusy(false)
                setRound((n) => n + 1)
              })
            }}
          />
        </div>
      )}
    </div>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className="lib-icon" aria-label={label} title={label} data-tip={label} onClick={onClick}>
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
