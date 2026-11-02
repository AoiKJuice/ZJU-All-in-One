import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { AuditNode, AuditStatus, ClassroomCredit, EducationCredit, GraduationAudit, PracticeRecord } from '@shared/types'
import { useZju } from '@renderer/hooks/useZju'
import { Choice, Joined, Quiet, Reveal, SectionHead } from '@renderer/components/Type'
import { dotDate } from '@renderer/lib/format'
import { dur } from '@renderer/lib/motion'
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

type Open = { kind: 'module'; id: string } | { kind: 'room'; room: Room } | { kind: 'edu'; edu: Edu }

/** 一个模块的完成情况：学分差额、门数差额、其中没完成的必修课 */
interface Progress {
  node: AuditNode
  required: number
  earned: number
  creditGap: number
  courseGap: number
  /** 完成指标是门数（有要求门数时按门数算进度，不用学分） */
  byCourses: boolean
  /** 必修模块里没完成的课（选修模块只看学分） */
  open: AuditNode[]
  done: boolean
}

interface Plan {
  children: (id: string | null) => AuditNode[]
  progress: Map<string, Progress>
  /** 「毕业总学分」这类没有下级的顶层汇总 */
  total?: Progress
  /** 顶层培养方案模块 */
  modules: Progress[]
  /** 待完成：最深一层没达标的模块（上级也没达标时只列下级，不重复） */
  todo: Progress[]
}

function analyze(nodes: AuditNode[]): Plan {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const kids = new Map<string | null, AuditNode[]>()
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n])
  const children = (id: string | null): AuditNode[] => kids.get(id) ?? []
  const subModules = (id: string): AuditNode[] => children(id).filter((n) => !n.code)
  // 本身或任一上级标为必修（选必修字段或名称）
  const required = (n: AuditNode): boolean => {
    for (let cur: AuditNode | undefined = n; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (cur.kind?.includes('必修') || (!cur.code && cur.name.includes('必修'))) return true
    }
    return false
  }
  const courses = (id: string): AuditNode[] => children(id).flatMap((n) => (n.code ? [n] : courses(n.id)))

  const progress = new Map<string, Progress>()
  for (const n of nodes) {
    if (n.code) continue
    const req = lead(n.requiredCredits)
    const got = lead(n.earnedCredits)
    const creditGap = req > 0 ? Math.max(0, req - got) : 0
    const courseGap = n.requiredCourses ? Math.max(0, lead(n.requiredCourses) - lead(n.completedCourses)) : 0
    const open = courses(n.id).filter((c) => required(c) && unfinished(c))
    const byCourses = lead(n.requiredCourses) > 0
    progress.set(n.id, { node: n, required: req, earned: got, creditGap, courseGap, byCourses, open, done: creditGap === 0 && courseGap === 0 && open.length === 0 })
  }

  const top = children(null).filter((n) => !n.code)
  const total = top.find((n) => children(n.id).length === 0 && n.requiredCredits)
  const modules = top.filter((n) => n !== total).map((n) => progress.get(n.id)!)
  const todo: Progress[] = []
  const walk = (list: AuditNode[]): void => {
    for (const n of list) {
      const p = progress.get(n.id)!
      const deeper = subModules(n.id).some((m) => !progress.get(m.id)!.done)
      if (!p.done && !deeper) todo.push(p)
      walk(subModules(n.id))
    }
  }
  walk(modules.map((p) => p.node))
  return { children, progress, total: total && progress.get(total.id), modules, todo }
}

/** 还差什么，只写一项：按门数算的写差几门，按学分算的写差几学分，指标够了但还有必修课没完成的写几门未完成 */
function gap(p: Progress): string | false {
  if (p.byCourses && p.courseGap > 0) return `差 ${p.courseGap} 门`
  if (!p.byCourses && p.creditGap > 0) return `差 ${fmt(p.creditGap)} 学分`
  if (p.open.length > 0) return `${p.open.length} 门未完成`
  if (p.creditGap > 0) return `差 ${fmt(p.creditGap)} 学分`
  return false
}

/** 卡片底部：已有进度条，不再写差几学分，只写在修、未修各几门 */
function courseParts(p: Progress): ReactNode[] {
  const studying = p.open.filter((c) => c.status === 'studying').length
  const rest = p.open.length - studying
  return [studying > 0 && `${studying} 门在修`, rest > 0 && `${rest} 门未修`]
}

// 培养方案的模块归成几个大类：认定类（美育、劳育、心理健康等达标认定）、通识、专业、实践，其余为其他。按名称判断
const GROUPS: { id: string; title: string; test: RegExp }[] = [
  { id: 'credential', title: '认定类', test: /美育|劳育|劳动|心理|健康|安全教育|国防|第二课堂|素质|创新创业/ },
  { id: 'practice', title: '实践类', test: /实践|实习|实训|毕业设计|毕业论文/ },
  { id: 'major', title: '专业类', test: /专业|学科|主修|大类/ },
  { id: 'general', title: '通识类', test: /通识|思政|政治|军体|军事|体育|外语|英语|计算机|自然科学|人文|社会|写作|数学/ }
]
function groupOf(p: Progress): string {
  return GROUPS.find((g) => g.test.test(p.node.name))?.id ?? 'other'
}
// 判断按上面的先后（认定类的名字最具体），显示按下面的顺序
const GROUP_ORDER = ['general', 'major', 'practice', 'credential', 'other']
const GROUP_TITLE: Record<string, string> = { ...Object.fromEntries(GROUPS.map((g) => [g.id, g.title])), other: '其他' }

/** 工具「毕业自审」：总学分与待完成清单在上，课堂与美育劳育一排数字块，培养方案模块为卡片；点开模块或课堂在侧页看明细 */
export function Graduation() {
  const { data, loading, error } = useZju('data:graduation')
  const [open, setOpen] = useState<Open | null>(null)
  const plan = data?.nodes ? analyze(data.nodes) : null
  const quiet = (part?: string) => <Quiet loading={loading} error={error ?? part ?? null} empty="无" />

  const rooms = (['second', 'third', 'fourth'] as Room[]).filter((r) => data?.classrooms?.[r].passed === false)
  const edus = (['aesthetic', 'labor'] as Edu[]).filter((e) => data?.[e].passed === false)
  const todoCount = (plan?.todo.length ?? 0) + rooms.length + edus.length

  return (
    <>
      {data && (
        <Reveal i={1}>
          <p className="page-lede">{todoCount > 0 ? <>还有 <em>{todoCount}</em> 项未完成</> : '各项均已完成'}</p>
        </Reveal>
      )}

      <div className="grad-top">
        <Reveal i={2} flat className="panel grad-overview">
          <SectionHead title="总览" />
          {plan?.total && (
            <div className="grad-total">
              <span className="grad-figure">
                {plan.total.node.earnedCredits ?? 0}
                <small>/ {plan.total.node.requiredCredits} 学分</small>
              </span>
              <Meter value={plan.total.earned} max={plan.total.required} />
            </div>
          )}
          {data ? (
            <div className="grad-tiles">
              {(['second', 'third', 'fourth'] as Room[]).map((r) =>
                data.classrooms ? <RoomTile key={r} name={ROOM[r]} c={data.classrooms[r]} onOpen={() => setOpen({ kind: 'room', room: r })} /> : null
              )}
              {(['aesthetic', 'labor'] as Edu[]).map((e) => (
                <EduTile key={e} name={EDU[e]} e={data[e]} onOpen={() => setOpen({ kind: 'edu', edu: e })} />
              ))}
            </div>
          ) : (
            quiet()
          )}
          {data && !data.classrooms && <p className="quiet grad-note">{data.practiceError ?? '第二课堂无数据'}</p>}
        </Reveal>

        <Reveal i={3} flat className="panel grad-todo">
          <SectionHead title="待完成" />
          {!data ? (
            quiet()
          ) : todoCount === 0 ? (
            <p className="quiet">无</p>
          ) : (
            <ul className="rows pane-scroll">
              {plan?.todo.map((p) => (
                <li key={p.node.id}>
                  <button className="row grad-todo-row" onClick={() => setOpen({ kind: 'module', id: p.node.id })}>
                    <span className="row-title">{p.node.name}</span>
                    <span className="grad-gap">{gap(p)}</span>
                  </button>
                </li>
              ))}
              {rooms.map((r) => (
                <li key={r}>
                  <button className="row grad-todo-row" onClick={() => setOpen({ kind: 'room', room: r })}>
                    <span className="row-title">{ROOM[r]}</span>
                    <span className="grad-gap">未达标</span>
                  </button>
                </li>
              ))}
              {edus.map((e) => (
                <li key={e}>
                  <button className="row grad-todo-row" onClick={() => setOpen({ kind: 'edu', edu: e })}>
                    <span className="row-title">{EDU[e]}</span>
                    <span className="grad-gap">未达标</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Reveal>
      </div>

      <Reveal i={4} flat className="grad-plan">
        <SectionHead title="培养方案" />
        {plan ? (
          GROUP_ORDER.map((id) => {
            const list = plan.modules.filter((p) => groupOf(p) === id)
            if (list.length === 0) return null
            return (
              <section key={id} className="grad-group-block">
                <h3 className="group-title">{GROUP_TITLE[id]}</h3>
                <div className="grad-modules">
                  {list.map((p) => (
                    <ModuleCard key={p.node.id} p={p} onOpen={() => setOpen({ kind: 'module', id: p.node.id })} />
                  ))}
                </div>
              </section>
            )
          })
        ) : (
          quiet(data?.nodesError)
        )}
      </Reveal>

      <Sheet open={open !== null} onClose={() => setOpen(null)}>
        {open?.kind === 'module' && plan?.progress.get(open.id) && <ModuleDetail plan={plan} p={plan.progress.get(open.id)!} />}
        {open?.kind === 'room' && data && <RecordsDetail title={ROOM[open.room]} data={data} pick={(r) => r.classroom === open.room} credit={data.classrooms?.[open.room]} />}
        {open?.kind === 'edu' && data && <RecordsDetail title={EDU[open.edu]} data={data} pick={(r) => r[open.edu]} edu={data[open.edu]} />}
      </Sheet>
    </>
  )
}

function Meter({ value, max }: { value: number; max: number }) {
  if (max <= 0) return null
  const ratio = Math.min(value / max, 1)
  return (
    <span className="grad-meter" data-full={ratio >= 1 || undefined}>
      <span style={{ width: `${ratio * 100}%` }} />
    </span>
  )
}

function Chip({ ok, children }: { ok: boolean | null; children?: ReactNode }) {
  if (ok === null) return null
  return (
    <span className="grad-chip" data-s={ok ? 'ok' : 'short'}>
      {children ?? (ok ? '达标' : '未达标')}
    </span>
  )
}

function RoomTile({ name, c, onOpen }: { name: string; c: ClassroomCredit; onOpen: () => void }) {
  return (
    <button className="grad-tile" onClick={onOpen}>
      <span className="grad-tile-head">
        {name}
        <Chip ok={c.passed} />
      </span>
      <span className="grad-tile-figure">
        {fmt(c.points)}
        <small>记点</small>
      </span>
      <span className="grad-tile-sub">
        <Joined parts={[c.credits !== null && `${fmt(c.credits)} 学分`, c.grade]} />
      </span>
    </button>
  )
}

function EduTile({ name, e, onOpen }: { name: string; e: EducationCredit; onOpen: () => void }) {
  return (
    <button className="grad-tile grad-tile-wide" onClick={onOpen}>
      <span className="grad-tile-head">
        {name}
        <Chip ok={e.passed} />
      </span>
      <span className="grad-tile-figure">
        {e.points === null ? '—' : fmt(e.points)}
        <small>记点</small>
      </span>
      <span className="grad-tile-sub">{e.requiredCredits !== undefined && `${e.earnedCredits ?? 0} / ${e.requiredCredits} 学分`}</span>
    </button>
  )
}

/** 培养方案模块卡片：高度固定，只给数字、进度（按门数或学分）与在修 / 未修；同名模块靠选必修标签区分。明细在侧页 */
function ModuleCard({ p, onOpen }: { p: Progress; onOpen: () => void }) {
  const n = p.node
  return (
    <button className="grad-module" data-done={p.done || undefined} onClick={onOpen}>
      <span className="grad-module-head">
        <span className="grad-module-name">{n.name}</span>
        {n.kind && !n.name.includes(n.kind.replace(/课程$/, '')) && <span className="grad-module-kind">{n.kind.replace(/课程$/, '')}</span>}
      </span>
      <span className="grad-module-figure">
        {p.byCourses ? (
          <>
            {n.completedCourses ?? 0}
            <small>/ {n.requiredCourses} 门</small>
          </>
        ) : p.required > 0 ? (
          <>
            {n.earnedCredits ?? 0}
            <small>/ {n.requiredCredits} 学分</small>
          </>
        ) : null}
      </span>
      {p.byCourses ? <Meter value={lead(n.completedCourses)} max={lead(n.requiredCourses)} /> : <Meter value={p.earned} max={p.required} />}
      <span className="grad-module-foot">{p.done ? <span className="grad-chip" data-s="ok">已完成</span> : <Joined parts={courseParts(p)} />}</span>
    </button>
  )
}

/** 侧页：模块明细。本模块的课在前，各下级模块分组在后；默认只看没完成的 */
function ModuleDetail({ plan, p }: { plan: Plan; p: Progress }) {
  const [all, setAll] = useState(p.open.length === 0)
  const groups: { module: AuditNode; depth: number }[] = []
  const walk = (id: string, depth: number): void => {
    groups.push({ module: plan.progress.get(id)!.node, depth })
    for (const m of plan.children(id)) if (!m.code) walk(m.id, depth + 1)
  }
  walk(p.node.id, 0)

  return (
    <>
      <h2 className="sheet-title">{p.node.name}</h2>
      <p className="sheet-meta">
        <Joined
          parts={[
            p.node.kind,
            p.node.requiredCredits && `${p.node.earnedCredits ?? 0} / ${p.node.requiredCredits} 学分`,
            p.node.requiredCourses && `${p.node.completedCourses ?? 0} / ${p.node.requiredCourses} 门`,
            p.done ? '已完成' : gap(p)
          ]}
        />
      </p>
      <div className="grad-sheet-tools">
        <Choice group="grad-module-filter" className="small" active={!all} onClick={() => setAll(false)}>
          未完成
        </Choice>
        <Choice group="grad-module-filter" className="small" active={all} onClick={() => setAll(true)}>
          全部
        </Choice>
      </div>
      <div className="sheet-body">
        {groups.map(({ module, depth }) => {
          const list = plan.children(module.id).filter((n) => n.code && (all || unfinished(n)))
          const sub = plan.progress.get(module.id)!
          if (depth > 0 && !all && sub.done) return null
          if (depth === 0 && list.length === 0) return null
          return (
            <section key={module.id} className="grad-group">
              {depth > 0 && (
                <h3 className="group-title grad-group-title">
                  <span>{module.name}</span>
                  <span className="grad-group-meta">{module.requiredCredits && `${module.earnedCredits ?? 0} / ${module.requiredCredits} 学分`}</span>
                </h3>
              )}
              {list.length > 0 ? (
                <ul className="rows">
                  {list.map((n) => (
                    <li key={n.id} className="row grad-course" data-past={!unfinished(n) || undefined}>
                      <span>
                        <span className="row-title">{n.name}</span>
                        <span className="row-sub">
                          <Joined parts={[n.code, n.credits !== undefined && `${fmt(n.credits)} 学分`, n.note]} />
                        </span>
                      </span>
                      <span className="row-end">{n.grade}</span>
                      <span className="grad-chip" data-s={n.status}>
                        {STATUS[n.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                depth > 0 && <p className="quiet grad-sub-quiet">{sub.done ? '已完成' : gap(sub) || '无'}</p>
              )}
            </section>
          )
        })}
        {!all && p.open.length === 0 && groups.every((g) => g.depth === 0 || plan.progress.get(g.module.id)!.done) && <p className="quiet">无</p>}
      </div>
    </>
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

  return (
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
    </AnimatePresence>
  )
}
