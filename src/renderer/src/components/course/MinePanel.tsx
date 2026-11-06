import type { XkSection, XkWatch } from '@shared/xk'
import { Joined } from '@renderer/components/Type'
import { ArmedButton, CrossPath, IconButton } from './bits'
import { clashInfo } from './SectionCard'
import { chanceOf, percent } from './xkData'
import { groupTitle, halfOf, isLead, parityLabel, slotLabel, type PrefGroup } from './xkLogic'

/** 一个志愿组：标题（课名或通识时间）、各志愿（次序、调序、移出）、剩下的空位（点了去找课） */
export function PrefBlock(props: {
  group: PrefGroup
  chosen: XkSection[]
  max: number
  busy: string | null
  picked: boolean
  onFocus: (key: string | null) => void
  onOpen: (s: XkSection) => void
  onAddMore: () => void
  onMove: (index: number, step: -1 | 1) => void
  onRemove: (s: XkSection) => void
}) {
  const { group: g } = props
  const free = g.selected ? 0 : Math.max(0, props.max - g.items.length)
  return (
    <section
      className="xk-group"
      data-selected={g.selected || undefined}
      data-picked={props.picked || undefined}
      onPointerEnter={(e) => e.pointerType === 'mouse' && props.onFocus(g.key)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && props.onFocus(null)}
    >
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
          const clash = isLead(s) ? clashInfo(s, props.chosen, g.byTime) : null
          const chance = s.state === 'selected' ? null : chanceOf(s)
          return (
            <li key={s.id} className="xk-pref" data-state={s.state} data-lead={isLead(s) || undefined}>
              <span className="xk-pref-no">{s.order ?? i + 1}</span>
              <button className="xk-pref-body" onClick={() => props.onOpen(s)}>
                <span className="xk-pref-title">
                  {g.byTime && <b>{s.courseName}</b>}
                  {s.teachers.join(' ') || '—'}
                </span>
                <span className="xk-pref-sub">
                  <Joined
                    parts={[
                      ...s.slots.map((t, j) => (
                        <span key={j} data-clash={clash?.slot(t) ?? undefined}>
                          {slotLabel(t)}
                          {parityLabel(t) ? ` ${parityLabel(t)}` : ''}
                        </span>
                      )),
                      halfOf(s.semesterPart),
                      s.state !== 'selected' && s.remaining !== null && `余量 ${s.remaining}`,
                      s.state !== 'selected' && s.pending !== null && `待定 ${s.pending}`,
                      chance !== null && <span data-hot={chance < 1 || undefined}>概率 {percent(chance)}</span>
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
                    <CrossPath />
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

export function WatchList({
  watches,
  onOpen,
  onUnwatch,
  onAuto
}: {
  watches: XkWatch[]
  onOpen: (w: XkWatch) => void
  onUnwatch: (id: string) => void
  onAuto: (w: XkWatch, auto: boolean) => void
}) {
  if (watches.length === 0) return <p className="quiet">无</p>
  return (
    <ul className="xk-watches">
      {watches.map((w) => (
        <li key={w.section.id} className="xk-watch" data-done={w.done ? true : undefined}>
          <button className="xk-pref-body" onClick={() => onOpen(w)}>
            <span className="xk-pref-title">
              <b>{w.section.courseName || w.course.name}</b>
              {w.section.teachers.join(' ')}
            </span>
            <span className="xk-pref-sub">
              {/* 早期版本存下的订阅没有 slots */}
              <Joined parts={[(w.section.slots ?? []).map(slotLabel).join('  ') || w.section.times.join(' '), halfOf(w.section.semesterPart ?? '')]} />
            </span>
          </button>
          <span className="xk-note" data-hot={w.remaining ? true : undefined}>
            {w.done ?? (w.remaining === null ? '…' : `余量 ${w.remaining}`)}
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
              <CrossPath />
            </IconButton>
          </span>
        </li>
      ))}
    </ul>
  )
}
