import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { AuditNode, AuditStatus, ClassroomCredit, EducationCredit, GraduationAudit, PracticeRecord } from '@shared/types'
import { useZju } from '@renderer/hooks/useZju'
import { Choice, Joined, Quiet, Reveal, SectionHead } from '@renderer/components/Type'
import { dotDate } from '@renderer/lib/format'
import { dur } from '@renderer/lib/motion'
import { MOBILE } from '@renderer/lib/platform'
import './graduation.css'

const EASE = [0.22, 1, 0.36, 1] as const
const STATUS: Record<AuditStatus, string> = { passed: '通过', failed: '未通过', replaced: '已替代', studying: '在修', none: '未修' }
const unfinished = (n: AuditNode): boolean => n.status === 'failed' || n.status === 'studying' || n.status === 'none'

/** 1.50 → 1.5，6 → 6 */
const fmt = (n: number): string => String(Number(n.toFixed(2)))
/** 「150+8」这类复合学分只取主项算进度 */
const lead = (value?: string): number => parseFloat(value ?? '') || 0

type Room = 'second' | 'third' | 'fourth'
type Edu = 'aesthetic' | 'labor'
const ROOM: Record<Room, string> = { second: '第二课堂', third: '第三课堂', fourth: '第四课堂' }
const EDU: Record<Edu, string> = { aesthetic: '美育', labor: '劳育' }
const ROOM_SHORT: Record<Room, string> = { second: '二课', third: '三课', fourth: '四课' }

type Open = { kind: 'room'; room: Room } | { kind: 'edu'; edu: Edu }

/** 一个模块的完成情况：学分差额、门数差额、其下（含下级）没完成的必修课 */
interface Progress {
  node: AuditNode
  depth: number
  required: number
  earned: number
  creditGap: number
  courseGap: number
  /** 有要求门数时按门数算进度，否则按学分 */
  byCourses: boolean
  open: AuditNode[]
  /** 本模块直接挂的课 */
  courses: AuditNode[]
  done: boolean
}

interface Plan {
  /** 「毕业总学分」这类没有下级的顶层汇总 */
  total?: Progress
  /** 按自审树原有顺序与层级平铺的模块 */
  rows: Progress[]
  /** 模块或其任一下级没完成 */
  pending: (p: Progress) => boolean
}

function analyze(nodes: AuditNode[]): Plan {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const kids = new Map<string | null, AuditNode[]>()
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n])
  const children = (id: string | null): AuditNode[] => kids.get(id) ?? []
  // 本身或任一上级标为必修（选必修字段或名称）
  const required = (n: AuditNode): boolean => {
    for (let cur: AuditNode | undefined = n; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (cur.kind?.includes('必修') || (!cur.code && cur.name.includes('必修'))) return true
    }
    return false
  }
  const allCourses = (id: string): AuditNode[] => children(id).flatMap((n) => (n.code ? [n] : allCourses(n.id)))

  const measure = (n: AuditNode, depth: number): Progress => {
    const req = lead(n.requiredCredits)
    const got = lead(n.earnedCredits)
    const creditGap = req > 0 ? Math.max(0, req - got) : 0
    const courseGap = n.requiredCourses ? Math.max(0, lead(n.requiredCourses) - lead(n.completedCourses)) : 0
    const open = allCourses(n.id).filter((c) => required(c) && unfinished(c))
    return {
      node: n,
      depth,
      required: req,
      earned: got,
      creditGap,
      courseGap,
      byCourses: lead(n.requiredCourses) > 0,
      open,
      courses: children(n.id).filter((c) => c.code),
      done: creditGap === 0 && courseGap === 0 && open.length === 0
    }
  }

  const top = children(null).filter((n) => !n.code)
  const totalNode = top.find((n) => children(n.id).length === 0 && n.requiredCredits)
  const rows: Progress[] = []
  const sub = new Map<string, Progress[]>()
  const walk = (list: AuditNode[], depth: number): Progress[] =>
    list.map((n) => {
      const p = measure(n, depth)
      rows.push(p)
      sub.set(n.id, walk(children(n.id).filter((c) => !c.code), depth + 1))
      return p
    })
  walk(top.filter((n) => n !== totalNode), 0)
  const pending = (p: Progress): boolean => !p.done || (sub.get(p.node.id) ?? []).some(pending)
  return { total: totalNode && measure(totalNode, 0), rows, pending }
}

/** 还差什么，只写一项：按门数算的写差几门，按学分算的写差几学分，指标够了但还有必修课没完成的写几门未完成 */
function gap(p: Progress): string | false {
  if (p.byCourses && p.courseGap > 0) return `差 ${p.courseGap} 门`
  if (!p.byCourses && p.creditGap > 0) return `差 ${fmt(p.creditGap)} 学分`
  if (p.open.length > 0) return `${p.open.length} 门未完成`
  if (p.creditGap > 0) return `差 ${fmt(p.creditGap)} 学分`
  return false
}

/** 选必修小标签：名称里已经写了（如「通识必修课程」）就不再标 */
function kindTag(n: AuditNode): string | null {
  const kind = n.kind?.replace(/课程$/, '')
  return kind && !n.name.includes(kind) ? kind : null
}

/** 工具「毕业自审」：上面一条总览（总学分 + 二三四课堂、美育、劳育），下面培养方案按自审树逐行列出，点模块就地展开课程 */
export function Graduation() {
  const { data, loading, error } = useZju('data:graduation')
  const [open, setOpen] = useState<Open | null>(null)
  const [all, setAll] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const plan = data?.nodes ? analyze(data.nodes) : null
  const quiet = (part?: string) => <Quiet loading={loading} error={error ?? part ?? null} empty="无" />
  const rows = plan ? plan.rows.filter((p) => all || plan.pending(p)) : []
  const toggle = (id: string): void =>
    setExpanded((s) => {
      const next = new Set(s)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <>
      <Reveal i={1} flat className="panel grad-summary">
        {plan?.total && (
          <div className="grad-total">
            <span className="grad-label">{plan.total.node.name}</span>
            <span className="grad-figure">
              {plan.total.node.earnedCredits ?? 0}
              <small>/ {plan.total.node.requiredCredits}</small>
            </span>
            <Meter value={plan.total.earned} max={plan.total.required} />
          </div>
        )}
        {data ? (
          <div className="grad-stats">
            {(['second', 'third', 'fourth'] as Room[]).map((r) => {
              const c = data.classrooms?.[r]
              return (
                <Stat
                  key={r}
                  name={MOBILE ? ROOM_SHORT[r] : ROOM[r]}
                  value={c ? fmt(c.points) : '—'}
                  passed={c?.passed ?? null}
                  sub={c && <Joined parts={[c.credits !== null && `${fmt(c.credits)} 学分`, c.grade]} />}
                  onOpen={() => setOpen({ kind: 'room', room: r })}
                />
              )
            })}
            {(['aesthetic', 'labor'] as Edu[]).map((e) => {
              const points = data[e].points
              return <Stat key={e} name={EDU[e]} value={points === null ? '—' : fmt(points)} passed={data[e].passed} onOpen={() => setOpen({ kind: 'edu', edu: e })} />
            })}
          </div>
        ) : (
          quiet()
        )}
        {data && !data.classrooms && <p className="quiet grad-note">{data.practiceError ?? '第二课堂无数据'}</p>}
      </Reveal>

      <Reveal i={2} flat className="panel grad-plan">
        <SectionHead
          title="培养方案"
          note={
            plan && (
              <span className="grad-filter">
                <Choice group="grad-filter" className="small" active={!all} onClick={() => setAll(false)}>
                  未完成
                </Choice>
                <Choice group="grad-filter" className="small" active={all} onClick={() => setAll(true)}>
                  全部
                </Choice>
              </span>
            )
          }
        />
        {!plan ? (
          quiet(data?.nodesError)
        ) : rows.length === 0 ? (
          <p className="quiet">无</p>
        ) : (
          <ul className="rows grad-rows">
            {rows.map((p) => {
              const shown = all ? p.courses : p.courses.filter(unfinished)
              const isOpen = shown.length > 0 && expanded.has(p.node.id)
              return (
                <li key={p.node.id}>
                  <ModuleRow p={p} canOpen={shown.length > 0} isOpen={isOpen} onToggle={() => toggle(p.node.id)} />
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.ul
                        key="courses"
                        className="grad-courses"
                        style={{ marginLeft: `${p.depth * 1.125}rem` }}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: dur(0.35), ease: EASE }}
                      >
                        {shown.map((n) => (
                          <li key={n.id} className="grad-course" data-past={!unfinished(n) || undefined}>
                            <span className="grad-course-name">
                              {n.name}
                              {n.note && <span className="grad-course-note">{n.note}</span>}
                            </span>
                            <span className="grad-num">{n.credits !== undefined && `${fmt(n.credits)} 学分`}</span>
                            <span className="grad-num grad-grade">{n.grade}</span>
                            <span className="grad-chip" data-s={n.status}>
                              {STATUS[n.status]}
                            </span>
                          </li>
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </li>
              )
            })}
          </ul>
        )}
      </Reveal>

      <Sheet open={open !== null} onClose={() => setOpen(null)}>
        {open?.kind === 'room' && data && <RecordsDetail title={ROOM[open.room]} data={data} pick={(r) => r.classroom === open.room} credit={data.classrooms?.[open.room]} />}
        {open?.kind === 'edu' && data && <RecordsDetail title={EDU[open.edu]} data={data} pick={(r) => r[open.edu]} edu={data[open.edu]} />}
      </Sheet>
    </>
  )
}

function Meter({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0
  return (
    <span className="grad-meter" data-empty={max <= 0 || undefined} data-full={ratio >= 1 || undefined}>
      <span style={{ width: `${ratio * 100}%` }} />
    </span>
  )
}

/** 总览里的一格：名称、记点、达标与否（桌面端另写学分与等级）；点开看第二课堂记录 */
function Stat({ name, value, passed, sub, onOpen }: { name: string; value: string; passed: boolean | null; sub?: ReactNode; onOpen: () => void }) {
  return (
    <button className="grad-stat" data-short={passed === false || undefined} onClick={onOpen}>
      <span className="grad-stat-name">{name}</span>
      <span className="grad-stat-value">
        {value}
        <small>记点</small>
      </span>
      <span className="grad-stat-sub">
        {passed !== null && <span className="grad-stat-pass">{passed ? '达标' : '未达标'}</span>}
        {!MOBILE && sub}
      </span>
    </button>
  )
}

/** 培养方案的一行：名称（同名模块靠选必修小标签区分）、进度条、学分、门数、还差什么；有课可看的能展开 */
function ModuleRow({ p, canOpen, isOpen, onToggle }: { p: Progress; canOpen: boolean; isOpen: boolean; onToggle: () => void }) {
  const n = p.node
  const kind = kindTag(n)
  const missing = gap(p)
  const body = (
    <>
      <span className="grad-row-name" style={{ paddingLeft: `${p.depth * 1.125}rem` }}>
        <span className="row-title">{n.name}</span>
        {kind && <span className="grad-kind">{kind}</span>}
      </span>
      {p.byCourses ? <Meter value={lead(n.completedCourses)} max={lead(n.requiredCourses)} /> : <Meter value={p.earned} max={p.required} />}
      <span className="grad-num grad-credits">{n.requiredCredits && `${n.earnedCredits ?? 0} / ${n.requiredCredits}`}</span>
      <span className="grad-num grad-count">{n.requiredCourses && `${n.completedCourses ?? 0} / ${n.requiredCourses} 门`}</span>
      <span className="grad-gap" data-done={!missing || undefined}>
        {missing || '完成'}
      </span>
      <span className="grad-chevron" aria-hidden>
        {canOpen && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9.5l6 6 6-6" />
          </svg>
        )}
      </span>
    </>
  )
  return canOpen ? (
    <button className="row grad-row" data-depth={p.depth} data-done={p.done || undefined} data-open={isOpen || undefined} aria-expanded={isOpen} onClick={onToggle}>
      {body}
    </button>
  ) : (
    <div className="row grad-row" data-depth={p.depth} data-done={p.done || undefined}>
      {body}
    </div>
  )
}

const RECORD_TABS: { id: PracticeRecord['status']; label: string }[] = [
  { id: 'done', label: '已完成' },
  { id: 'pending', label: '审核中' },
  { id: 'rejected', label: '未通过' }
]

/** 侧页：第二课堂记录，按 已完成 / 审核中 / 未通过 分开看 */
function RecordsDetail({ title, data, pick, credit, edu }: { title: string; data: GraduationAudit; pick: (r: PracticeRecord) => boolean; credit?: ClassroomCredit; edu?: EducationCredit }) {
  const [tab, setTab] = useState<PracticeRecord['status']>('done')
  const list = (data.records ?? []).filter(pick)
  const shown = list.filter((r) => r.status === tab).sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))
  const passed = credit?.passed ?? edu?.passed ?? null

  return (
    <>
      <h2 className="sheet-title">{title}</h2>
      <p className="sheet-meta">
        <Joined
          parts={[
            passed !== null && (passed ? '达标' : '未达标'),
            credit && `${fmt(credit.points)} 记点`,
            credit?.credits !== null && credit?.credits !== undefined && `${fmt(credit.credits)} 学分`,
            credit?.grade,
            edu?.points !== null && edu?.points !== undefined && `${fmt(edu.points)} 记点`,
            edu?.requiredCredits !== undefined && `${edu?.earnedCredits ?? 0} / ${edu?.requiredCredits} 学分`
          ]}
        />
      </p>
      <div className="grad-sheet-tools">
        {RECORD_TABS.map((t) => (
          <Choice key={t.id} group="grad-record-tab" className="small" active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </Choice>
        ))}
      </div>
      <div className="sheet-body">
        {data.records === null ? (
          <p className="quiet">{data.practiceError ?? '无'}</p>
        ) : shown.length === 0 ? (
          <p className="quiet">无</p>
        ) : (
          <ul className="rows">
            {shown.map((r) => (
              <li key={r.id} className="row grad-record">
                <span className="row-time">{r.time ? dotDate(r.time) : ''}</span>
                <span>
                  <span className="row-title">{r.name}</span>
                  <span className="row-sub">
                    <Joined parts={[r.category, r.type, r.status !== 'done' && r.statusLabel]} />
                  </span>
                </span>
                <span className="row-end">{r.points !== null && `${fmt(r.points)} 记点`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

/** 毕业自审自己的侧页（右侧滑出）；Esc、点遮罩、「关闭」都能收起，安卓返回键经 Esc 收起 */
function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // 挂到 body：留在页面滚动区里会被它的层叠上下文压在刊头下面
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="veil" className="sheet-veil" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside
            key="sheet"
            className="sheet local-sheet"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: dur(0.6), ease: EASE }}
          >
            <button className="act grad-sheet-close" onClick={onClose}>
              关闭
            </button>
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
