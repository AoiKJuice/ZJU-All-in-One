import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  areasIn,
  type LibArea,
  type LibBooking,
  type LibBuilding,
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

const sameScope = (a: LibScope, b: LibScope): boolean => a.kind === b.kind && a.id === b.id
const sameScopes = (a: LibScope[], b: LibScope[]): boolean => a.length === b.length && a.every((s) => b.some((x) => sameScope(s, x)))

/** 若干范围的简称：一处写全名，多处写「第一处 等 N 处」 */
const scopeTitle = (scopes: LibScope[]): string => (scopes.length > 1 ? `${scopes[0].label} 等 ${scopes.length} 处` : (scopes[0]?.label ?? ''))

/**
 * 勾选 / 取消一项范围。勾上一馆（层）即包含其下全部；在已勾的上级里取消一个下级时，
 * 上级拆成其余的兄弟项，免得要先取消整馆再一个个勾回来
 */
function toggleScope(buildings: LibBuilding[], picked: LibScope[], kind: LibScope['kind'], id: string): LibScope[] {
  for (const b of buildings) {
    const bScope: LibScope = { kind: 'building', id: b.id, label: b.name }
    const bPicked = picked.some((s) => sameScope(s, bScope))
    const floorScope = (f: LibBuilding['floors'][number]): LibScope => ({ kind: 'floor', id: f.id, label: `${b.name} ${f.name}` })
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

/**
 * 工具「图书馆预约」：左边找座（日期、馆、各层区域的余座，区域展开后选时段与空座预约）。
 * 桌面端在行首勾选馆 / 层 / 区域（可多选），左栏底部的操作条一键订阅、自动预约或存为套餐；
 * 右边是我的预约与订阅（套餐一键订阅、各订阅的余座与自动预约）。预约与取消、授权自动预约都要二次点击确认
 */
export function LibraryTool() {
  const notify = useApp((s) => s.notify)
  const epoch = useApp((s) => s.epoch)
  const [overview, setOverview] = useState<Loaded<LibOverview> | null>(null)
  const [date, setDate] = useState<string | undefined>(undefined)
  const [building, setBuilding] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [bookings, setBookings] = useState<Loaded<LibBooking[]> | null>(null)
  const [watches, setWatches] = useState<LibWatch[]>([])
  const [presets, setPresets] = useState<LibPreset[]>([])
  const [picked, setPicked] = useState<LibScope[]>([])
  const [side, setSide] = useState<'bookings' | 'watch'>('bookings')
  const [view, setView] = useState<'find' | 'mine'>('find')

  const data = overview && 'data' in overview ? overview.data : null
  const current = data?.buildings.find((b) => b.id === building) ?? data?.buildings[0]

  const loadOverview = useCallback(
    (day?: string) =>
      window.zju['lib:overview'](day).then(
        (d) => setOverview({ data: d }),
        (e) => setOverview((old) => (old && 'data' in old ? old : { error: errorText(e) }))
      ),
    []
  )
  const loadBookings = useCallback(
    () =>
      window.zju['lib:bookings']().then(
        (d) => setBookings({ data: d }),
        (e) => setBookings({ error: errorText(e) })
      ),
    []
  )

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

  // 已在订阅里的区域：名称旁带「订阅中」
  const watched = useMemo(() => {
    if (!data) return new Map<string, boolean>()
    const map = new Map<string, boolean>()
    for (const w of watches.filter((x) => !x.done)) for (const a of areasIn(data, w.scopes)) map.set(a.area.id, map.get(a.area.id) || w.auto)
    return map
  }, [data, watches])

  const pick = (kind: LibScope['kind'], id: string): void => {
    if (data) setPicked((list) => toggleScope(data.buildings, list, kind, id))
  }
  const state = (kind: LibScope['kind'], id: string, parents: LibScope[]): 'on' | 'implied' | undefined =>
    picked.some((s) => s.kind === kind && s.id === id) ? 'on' : parents.some((p) => picked.some((s) => sameScope(s, p))) ? 'implied' : undefined

  const reserve = async (area: LibArea, seat: LibSeat, segment: LibSegment): Promise<void> => {
    try {
      const r = await window.zju['lib:reserve'](area.id, seat.id, segment)
      notify(r.status === 'saved' ? `已预约 ${seat.name} 号` : r.message || '结果未知')
    } catch (e) {
      notify(errorText(e))
    }
    setSide('bookings')
    if (MOBILE) setView('mine')
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

  const subscribe = async (scopes: LibScope[], from: string, to: string, auto: boolean): Promise<void> => {
    // 同样的范围与时段已有订阅时改它，不另起一条
    const same = watches.find((w) => sameScopes(w.scopes, scopes) && w.from === from && w.to === to)
    setWatches(await window.zju['lib:watch']({ id: same?.id, scopes, from, to, auto }))
    setSide('watch')
    notify(auto ? '已订阅并自动预约' : '已订阅')
  }

  const savePreset = async (name: string, from: string, to: string): Promise<void> => {
    setPresets(await window.zju['lib:savePreset']({ name, scopes: picked, from, to }))
    setSide('watch')
    notify('已存为套餐')
  }

  return (
    <div className="lib" data-view={view}>
      {MOBILE && (
        <div className="lib-switch">
          <Choice group="lib-view" active={view === 'find'} onClick={() => setView('find')}>
            找座
          </Choice>
          <Choice group="lib-view" active={view === 'mine'} onClick={() => setView('mine')}>
            预约
          </Choice>
        </div>
      )}

      <Reveal i={1} flat className="panel lib-find">
        <div className="lib-head">
          <span className="lib-choices">
            {data?.dates.map((d) => (
              <Choice key={d} group="lib-date" active={d === data.date} onClick={() => setDate(d)}>
                {dayLabel(d, data.dates)}
              </Choice>
            ))}
          </span>
        </div>
        <div className="lib-tabs">
          {data?.buildings.map((b) => (
            <Choice key={b.id} group="lib-building" className="small" active={b.id === current?.id} onClick={() => setBuilding(b.id)}>
              {b.name}
              <span className="lib-tab-free">{b.free ?? ''}</span>
            </Choice>
          ))}
          {!MOBILE && current && (
            <button className="act lib-tabs-end" data-on={state('building', current.id, []) ? true : undefined} onClick={() => pick('building', current.id)}>
              整馆
            </button>
          )}
        </div>
        <div className="pane-scroll lib-list">
          {!overview ? (
            <Quiet loading error={null} empty="无" />
          ) : 'error' in overview ? (
            <Quiet loading={false} error={overview.error} empty="无" />
          ) : !current ? (
            <p className="quiet">无</p>
          ) : (
            current.floors.map((f) => {
              const bScope: LibScope = { kind: 'building', id: current.id, label: '' }
              const fScope: LibScope = { kind: 'floor', id: f.id, label: '' }
              return (
                <section key={f.id} className="lib-floor">
                  <h3 className="lib-floor-head">
                    {!MOBILE && <Check state={state('floor', f.id, [bScope])} label={f.name} onClick={() => pick('floor', f.id)} />}
                    <span className="lib-floor-name">{f.name}</span>
                    <Count free={f.free} total={f.total} />
                  </h3>
                  <ul className="lib-areas">
                    {f.areas.map((a) => {
                      const expanded = open === a.id
                      const watching = watched.get(a.id)
                      return (
                        <li key={a.id} data-open={expanded || undefined}>
                          <div className="lib-area">
                            {!MOBILE && <Check state={state('area', a.id, [bScope, fScope])} label={a.name} onClick={() => pick('area', a.id)} />}
                            <button className="lib-area-main" onClick={() => setOpen(expanded ? null : a.id)} aria-expanded={expanded}>
                              <span className="lib-area-name">
                                {a.name}
                                {watching !== undefined && <span className="lib-tag" data-tone="soft">{watching ? '自动预约' : '订阅中'}</span>}
                              </span>
                              <Meter free={a.free} total={a.total} />
                            </button>
                          </div>
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
              )
            })
          )}
        </div>
        <AnimatePresence initial={false}>
          {!MOBILE && picked.length > 0 && (
            <motion.div
              key="bar"
              className="lib-bar-wrap"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: dur(0.4), ease: EASE }}
            >
              <SelectBar
                scopes={picked}
                onRemove={(s) => setPicked((list) => list.filter((x) => !sameScope(x, s)))}
                onClear={() => setPicked([])}
                onSubscribe={async (from, to, auto) => {
                  await subscribe(picked, from, to, auto)
                  setPicked([])
                }}
                onSavePreset={async (name, from, to) => {
                  await savePreset(name, from, to)
                  setPicked([])
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </Reveal>

      <Reveal i={2} flat className="panel lib-mine">
        {!MOBILE && (
          <div className="lib-head">
            <span className="lib-choices">
              <Choice group="lib-side" active={side === 'bookings'} onClick={() => setSide('bookings')}>
                预约
              </Choice>
              <Choice group="lib-side" active={side === 'watch'} onClick={() => setSide('watch')}>
                订阅
              </Choice>
            </span>
          </div>
        )}
        <div className="pane-scroll lib-side">
          {side === 'watch' && !MOBILE ? (
            presets.length === 0 && watches.length === 0 ? (
              <p className="quiet">无</p>
            ) : (
              <>
                {presets.length > 0 && (
                  <PresetList
                    presets={presets}
                    watches={watches}
                    onSubscribe={(p, auto) => subscribe(p.scopes, p.from, p.to, auto)}
                    onRemove={async (id) => setPresets(await window.zju['lib:removePreset'](id))}
                  />
                )}
                {watches.length > 0 && (
                  <WatchList
                    watches={watches}
                    onRemove={async (id) => setWatches(await window.zju['lib:unwatch'](id))}
                    onAuto={async (w, auto) => setWatches(await window.zju['lib:watch']({ id: w.id, scopes: w.scopes, from: w.from, to: w.to, auto }))}
                  />
                )}
              </>
            )
          ) : (
            <Bookings bookings={bookings} onCancel={cancel} />
          )}
        </div>
      </Reveal>
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

/** 行首勾选：on 勾上，implied 由上级（整层 / 整馆）带上 */
function Check({ state, label, onClick }: { state: 'on' | 'implied' | undefined; label: string; onClick: () => void }) {
  return (
    <button className="lib-check" data-state={state} aria-label={`选择${label}`} aria-pressed={state !== undefined} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle className="lib-check-ring" cx="12" cy="12" r="8.25" />
        <path className="lib-check-tick" d="M8.2 12.3l2.6 2.5 5-5.2" />
      </svg>
    </button>
  )
}

/** 勾选后左栏底部的操作条：已选范围、每天的检查时段，一键订阅 / 自动预约，或存为套餐 */
function SelectBar(props: {
  scopes: LibScope[]
  onRemove: (s: LibScope) => void
  onClear: () => void
  onSubscribe: (from: string, to: string, auto: boolean) => Promise<void>
  onSavePreset: (name: string, from: string, to: string) => Promise<void>
}) {
  const [from, setFrom] = useState('08:00')
  const [to, setTo] = useState('22:30')
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const valid = Boolean(from && to && from !== to)

  const save = (e: FormEvent): void => {
    e.preventDefault()
    if (!valid) return
    void props.onSavePreset(name.trim() || scopeTitle(props.scopes), from, to)
  }

  return (
    <div className="lib-bar">
      <ul className="lib-scopes">
        {props.scopes.map((s) => (
          <li key={`${s.kind}${s.id}`} className="lib-scope">
            {s.label}
            <button aria-label="移出" title="移出" onClick={() => props.onRemove(s)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M8 8l8 8M16 8l-8 8" />
              </svg>
            </button>
          </li>
        ))}
        <li>
          <IconButton label="清空" onClick={props.onClear}>
            <path d="M7 7l10 10M17 7L7 17" />
          </IconButton>
        </li>
      </ul>
      <div className="lib-bar-row">
        <span className="lib-window">
          <input className="field lib-time" type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="每天开始" />
          <span className="lib-dash">–</span>
          <input className="field lib-time" type="time" value={to} onChange={(e) => setTo(e.target.value)} aria-label="每天结束" />
        </span>
        {naming ? (
          <form className="lib-name" onSubmit={save}>
            <input className="field lib-name-field" autoFocus placeholder={scopeTitle(props.scopes)} value={name} onChange={(e) => setName(e.target.value)} aria-label="套餐名" />
            <button type="submit" className="act" disabled={!valid}>
              保存
            </button>
          </form>
        ) : (
          <button className="act" onClick={() => setNaming(true)}>
            存为套餐
          </button>
        )}
        <button className="btn" disabled={!valid} onClick={() => void props.onSubscribe(from, to, false)}>
          订阅
        </button>
        <ArmedButton className="btn btn-solid" label="自动预约" confirm="确认授权" disabled={!valid} onRun={() => void props.onSubscribe(from, to, true)} />
      </div>
    </div>
  )
}

/** 套餐：一键订阅 / 自动预约；已在订阅里的显示状态 */
function PresetList(props: { presets: LibPreset[]; watches: LibWatch[]; onSubscribe: (p: LibPreset, auto: boolean) => void; onRemove: (id: string) => void }) {
  return (
    <section className="lib-group">
      <h3 className="lib-group-head">套餐</h3>
      <ul className="lib-presets">
        {props.presets.map((p) => {
          const live = props.watches.find((w) => !w.done && sameScopes(w.scopes, p.scopes) && w.from === p.from && w.to === p.to)
          return (
            <li key={p.id} className="lib-preset">
              <span className="min-w-0">
                <span className="lib-item-title">{p.name}</span>
                <span className="lib-sub">
                  <Joined parts={[`${p.from}–${p.to}`, ...p.scopes.map((s) => s.label)]} />
                </span>
              </span>
              <span className="lib-acts">
                {live ? (
                  <span className="lib-tag" data-tone="soft">
                    {live.auto ? '自动预约中' : '订阅中'}
                  </span>
                ) : (
                  <>
                    <button className="act" onClick={() => props.onSubscribe(p, false)}>
                      订阅
                    </button>
                    <ArmedButton label="自动预约" confirm="确认授权" onRun={() => props.onSubscribe(p, true)} />
                  </>
                )}
                <IconButton label="删除套餐" onClick={() => props.onRemove(p.id)}>
                  <path d="M7 7l10 10M17 7L7 17" />
                </IconButton>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function WatchList(props: { watches: LibWatch[]; onRemove: (id: string) => void; onAuto: (w: LibWatch, auto: boolean) => void }) {
  return (
    <section className="lib-group">
      <h3 className="lib-group-head">订阅</h3>
      <ul className="lib-watches">
        {props.watches.map((w) => (
          <li key={w.id} className="lib-watch" data-done={w.done ? true : undefined}>
            <span className="min-w-0" title={w.scopes.map((s) => s.label).join('\n')}>
              <span className="lib-item-title">{scopeTitle(w.scopes)}</span>
              <span className="lib-sub">
                <Joined parts={[`${w.from}–${w.to}`]} />
              </span>
            </span>
            <span className="lib-free" data-on={w.free ? true : undefined}>
              {w.done ?? (w.free === null ? '…' : `余 ${w.free}`)}
            </span>
            <span className="lib-acts">
              {!w.done &&
                (w.auto ? (
                  <button className="act" data-on onClick={() => props.onAuto(w, false)}>
                    自动预约
                  </button>
                ) : (
                  <ArmedButton label="自动预约" confirm="确认授权" onRun={() => props.onAuto(w, true)} />
                ))}
              <IconButton label="取消订阅" onClick={() => props.onRemove(w.id)}>
                <path d="M7 7l10 10M17 7L7 17" />
              </IconButton>
            </span>
          </li>
        ))}
      </ul>
    </section>
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
            label={busy ? '预约中' : '预约'}
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

function Bookings({ bookings, onCancel }: { bookings: Loaded<LibBooking[]> | null; onCancel: (b: LibBooking) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  if (!bookings) return <Quiet loading error={null} empty="无" />
  if ('error' in bookings) return <Quiet loading={false} error={bookings.error} empty="无" />
  if (bookings.data.length === 0) return <p className="quiet">无</p>
  return (
    <ul className="lib-bookings">
      {bookings.data.map((b) => (
        <li key={b.id} className="lib-booking" data-done={!b.canCancel || undefined}>
          <span className="min-w-0">
            <span className="lib-item-title">{b.place}</span>
            <span className="lib-sub">
              <Joined parts={[monthDay(b.begin), `${b.begin.slice(11)}–${b.end.slice(11)}`]} />
            </span>
          </span>
          <span className="lib-tag" data-tone={b.canCancel ? 'soft' : undefined}>
            {b.status}
          </span>
          {b.canCancel ? (
            <ArmedButton
              label={busy === b.id ? '取消中' : '取消'}
              confirm="确认取消"
              disabled={busy !== null}
              onRun={() => {
                setBusy(b.id)
                void onCancel(b).finally(() => setBusy(null))
              }}
            />
          ) : (
            <span />
          )}
        </li>
      ))}
    </ul>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className="lib-icon" aria-label={label} title={label} onClick={onClick}>
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
