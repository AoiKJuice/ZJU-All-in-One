import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { AuditNode, AuditStatus, ClassroomCredit, EducationCredit, GraduationAudit, PracticeRecord } from '@shared/types'
import { useZju } from '@renderer/hooks/useZju'
import { Choice, Joined, Quiet, Reveal } from '@renderer/components/Type'
import { dotDate } from '@renderer/lib/format'
import { dur } from '@renderer/lib/motion'
import { swipeToClose } from '@renderer/lib/swipe'
import './graduation.css'
import { CloseButton } from '@renderer/components/IconButton'

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

type Open = { kind: 'room'; room: Room } | { kind: 'edu'; edu: Edu }

/** 一项要求（自审树里的一个模块）算出来的完成情况 */
interface Req {
  node: AuditNode
  /** 名称相同的兄弟模块靠选必修区分（「美育类 · 选修」） */
  label: string
  /** 有要求门数时按门数，否则按学分 */
  byCourses: boolean
  required: number
  earned: number
  /** 还差多少（门或学分）；0 为够了 */
  gap: number
  /** 下级与本级的课都算上、要求本身也够了 */
  done: boolean
  /** 下一级要求（逐级递归） */
  subs: Req[]
  /** 本模块及下级的全部课 */
  courses: AuditNode[]
}

/**
 * 把教务的自审树整理成「一项项要求」：顶层模块一张卡，下级模块是卡里的一条条小要求。
 * 「毕业总学分」这种没有下级的顶层汇总单独拿出来放在最上面
 */
function analyze(nodes: AuditNode[]): { total?: AuditNode; reqs: Req[] } {
  const kids = new Map<string | null, AuditNode[]>()
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n])
  const children = (id: string | null): AuditNode[] => kids.get(id) ?? []
  const isRequired = (id: string): boolean => {
    for (let cur = nodes.find((n) => n.id === id); cur; cur = cur.parentId ? nodes.find((n) => n.id === cur!.parentId) : undefined) {
      if (cur.kind?.includes('必修') || (!cur.code && cur.name.includes('必修'))) return true
    }
    return false
  }
  const allCourses = (id: string): AuditNode[] => children(id).flatMap((n) => (n.code ? [n] : allCourses(n.id)))

  const build = (n: AuditNode, siblings: AuditNode[]): Req => {
    const mods = children(n.id).filter((c) => !c.code)
    const subs = mods.map((m) => build(m, mods))
    const byCourses = lead(n.requiredCourses) > 0
    const required = byCourses ? lead(n.requiredCourses) : lead(n.requiredCredits)
    const earned = byCourses ? lead(n.completedCourses) : lead(n.earnedCredits)
    const courses = allCourses(n.id)
    // 必修模块里还有没修完的课，即使学分够了也不算完成
    const openRequired = courses.some((c) => unfinished(c) && isRequired(c.id))
    const gap = Math.max(0, required - earned)
    const twin = siblings.filter((s) => s.name === n.name).length > 1
    const kind = n.kind?.replace(/课程$/, '')
    return {
      node: n,
      label: twin && kind ? `${n.name} · ${kind}` : n.name,
      byCourses,
      required,
      earned,
      gap,
      done: gap === 0 && !openRequired && subs.every((s) => s.done),
      subs,
      courses
    }
  }
  const top = children(null).filter((n) => !n.code)
  const total = top.find((n) => children(n.id).length === 0 && n.requiredCredits)
  const rest = top.filter((n) => n !== total)
  // 没有要求也没有课的空模块不列
  const reqs = rest.map((n) => build(n, rest)).filter((r) => r.required > 0 || r.courses.length > 0 || r.subs.length > 0)
  return { total, reqs }
}

/** 「差 4.5 学分」「差 1 门」；够了但必修课没修完时写还有几门没修完 */
function gapText(r: Req): string {
  if (r.gap > 0) return r.byCourses ? `差 ${fmt(r.gap)} 门` : `差 ${fmt(r.gap)} 学分`
  const open = r.courses.filter(unfinished).length
  if (!r.done && open) return `${open} 门未修完`
  return r.done ? '已完成' : '下级未完成'
}

const unit = (r: Req): string => (r.byCourses ? '门' : '学分')

/** 工具「毕业自审」：最上面毕业总学分与第二课堂五项；下面「还没完成」每项要求一张卡，写清差多少、下面哪几条没达到、还要修哪些课；完成了的收在最后一张卡里 */
export function Graduation() {
  const { data, loading, error } = useZju('data:graduation')
  const [open, setOpen] = useState<Open | null>(null)
  const plan = data?.nodes ? analyze(data.nodes) : null
  const pending = plan?.reqs.filter((r) => !r.done) ?? []
  const done = plan?.reqs.filter((r) => r.done) ?? []

  if (!data) return <Quiet loading={loading} error={error} empty="无" />

  return (
    <div className="grad">
      <Reveal i={1} flat className="panel grad-hero">
        {plan?.total ? <Total node={plan.total} /> : !plan && <p className="quiet">{data.nodesError ?? '培养方案无数据'}</p>}
        <div className="grad-stats">
          {(['second', 'third', 'fourth'] as Room[]).map((r) => {
            const c = data.classrooms?.[r]
            return <Stat key={r} name={ROOM[r]} value={c ? fmt(c.points) : null} passed={c?.passed ?? null} onOpen={() => setOpen({ kind: 'room', room: r })} />
          })}
          {(['aesthetic', 'labor'] as Edu[]).map((e) => (
            <Stat key={e} name={EDU[e]} value={data[e].points === null ? null : fmt(data[e].points!)} passed={data[e].passed} onOpen={() => setOpen({ kind: 'edu', edu: e })} />
          ))}
        </div>
        {!data.classrooms && <p className="quiet grad-note">{data.practiceError ?? '第二课堂无数据'}</p>}
      </Reveal>

      {plan && (
        <>
          <Reveal i={2} flat>
            <h2 className="grad-heading">
              还没完成<span className="grad-heading-count">{pending.length}</span>
            </h2>
          </Reveal>
          {pending.length === 0 ? (
            <Reveal i={3} flat className="panel grad-clear">
              全部达到
            </Reveal>
          ) : (
            <div className="grad-cards">
              {pending.map((r, i) => (
                <Reveal key={r.node.id} i={3 + Math.min(i, 6)} flat className="panel grad-card">
                  <ReqCard r={r} />
                </Reveal>
              ))}
            </div>
          )}
          {done.length > 0 && (
            <Reveal i={10} flat className="panel grad-done">
              <DoneList reqs={done} />
            </Reveal>
          )}
        </>
      )}

      <Sheet open={open !== null} onClose={() => setOpen(null)}>
        {open?.kind === 'room' && <RecordsDetail title={ROOM[open.room]} data={data} pick={(r) => r.classroom === open.room} credit={data.classrooms?.[open.room]} />}
        {open?.kind === 'edu' && <RecordsDetail title={EDU[open.edu]} data={data} pick={(r) => r[open.edu]} edu={data[open.edu]} />}
      </Sheet>
    </div>
  )
}

/** 毕业总学分：大数字 / 要求，还差多少，一道进度条 */
function Total({ node }: { node: AuditNode }) {
  const earned = lead(node.earnedCredits)
  const required = lead(node.requiredCredits)
  const gap = Math.max(0, required - earned)
  return (
    <div className="grad-total">
      <div className="grad-total-line">
        <span className="grad-label">{node.name}</span>
        <span className="grad-total-gap" data-done={gap === 0 || undefined}>
          {gap > 0 ? `还差 ${fmt(gap)} 学分` : '已达到'}
        </span>
      </div>
      <span className="grad-figure">
        {node.earnedCredits ?? 0}
        <small>/ {node.requiredCredits}</small>
      </span>
      <Meter value={earned} max={required} />
    </div>
  )
}

function Meter({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0
  return (
    <span className="grad-meter" data-full={ratio >= 1 || undefined}>
      <span style={{ width: `${ratio * 100}%` }} />
    </span>
  )
}

/** 第二课堂一项：名称、记点、达标与否；整格是按钮，点开看记录 */
function Stat({ name, value, passed, onOpen }: { name: string; value: string | null; passed: boolean | null; onOpen: () => void }) {
  return (
    <button className="grad-stat" data-short={passed === false || undefined} onClick={onOpen}>
      <span className="grad-stat-name">{name}</span>
      <span className="grad-stat-value">
        {value ?? '—'}
        {value !== null && <small>记点</small>}
      </span>
      <span className="grad-stat-pass">
        {passed !== null && <Mark ok={passed} />}
        {passed === null ? '查看记录' : passed ? '达标' : '未达标'}
      </span>
    </button>
  )
}

/** 勾（达到）与空圈（没达到） */
function Mark({ ok }: { ok: boolean }) {
  return (
    <svg className="grad-mark" data-ok={ok || undefined} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ok ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <circle cx="12" cy="12" r="7.5" />}
    </svg>
  )
}

/** 一项没完成的要求：标题与还差多少，进度，下面一条条小要求（达到的打勾），再往下是这项要求里的课（没修完的在前） */
function ReqCard({ r }: { r: Req }) {
  const [showCourses, setShowCourses] = useState(false)
  const todo = r.courses.filter(unfinished)
  const passed = r.courses.filter((c) => !unfinished(c))
  const courses = [...todo, ...passed]
  return (
    <>
      <div className="grad-card-head">
        <h3 className="grad-card-title">{r.label}</h3>
        <span className="grad-card-gap">{gapText(r)}</span>
      </div>
      {r.required > 0 && (
        <div className="grad-card-progress">
          <Meter value={r.earned} max={r.required} />
          <span className="grad-card-figure">
            已修 {fmt(r.earned)} / {fmt(r.required)} {unit(r)}
          </span>
        </div>
      )}
      {r.subs.length > 0 && (
        <ul className="grad-subs">
          {flatSubs(r.subs).map(({ req, depth }) => (
            <li key={req.node.id} className="grad-sub" data-done={req.done || undefined} style={{ paddingLeft: `${depth * 1.25}rem` }}>
              <Mark ok={req.done} />
              <span className="grad-sub-name">{req.label}</span>
              <span className="grad-sub-gap">{req.done ? `${fmt(req.earned)} / ${fmt(req.required)} ${unit(req)}` : gapText(req)}</span>
            </li>
          ))}
        </ul>
      )}
      {courses.length > 0 && (
        <>
          <button className="grad-courses-toggle" aria-expanded={showCourses} onClick={() => setShowCourses((x) => !x)}>
            课程<span className="grad-courses-count">{courses.length} 门</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 9.5l6 6 6-6" />
            </svg>
          </button>
          <AnimatePresence initial={false}>
            {showCourses && (
              <motion.ul
                key="courses"
                className="grad-courses"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: dur(0.35), ease: EASE }}
              >
                {courses.map((n) => (
                  <CourseLine key={n.id} n={n} />
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </>
      )}
    </>
  )
}

/** 小要求逐级摊平（第二级起缩进） */
function flatSubs(subs: Req[], depth = 0): { req: Req; depth: number }[] {
  return subs.flatMap((s) => [{ req: s, depth }, ...flatSubs(s.subs, depth + 1)])
}

/** 一门课：课名（替代说明）在左，学分与成绩或状态在右；没修完的状态主题色 */
function CourseLine({ n }: { n: AuditNode }) {
  const open = unfinished(n)
  return (
    <li className="grad-course" data-open={open || undefined}>
      <span className="grad-course-name">
        {n.name}
        {n.note && <span className="grad-course-note">{n.note}</span>}
      </span>
      <span className="grad-course-credit">{n.credits !== undefined && `${fmt(n.credits)} 学分`}</span>
      <span className="grad-course-state" data-s={n.status}>
        {n.status === 'passed' && n.grade ? n.grade : STATUS[n.status]}
      </span>
    </li>
  )
}

/** 已完成的要求：一行一项（勾 + 名称 + 学分），点开看课 */
function DoneList({ reqs }: { reqs: Req[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <h3 className="grad-done-title">
        已完成<span className="grad-heading-count">{reqs.length}</span>
      </h3>
      <ul className="grad-done-list">
        {reqs.map((r) => {
          const isOpen = open === r.node.id
          return (
            <li key={r.node.id}>
              <button className="grad-done-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.node.id)} disabled={r.courses.length === 0}>
                <Mark ok />
                <span className="grad-sub-name">{r.label}</span>
                <span className="grad-sub-gap">
                  {r.required > 0 ? `${fmt(r.earned)} / ${fmt(r.required)} ${unit(r)}` : `${r.courses.length} 门`}
                </span>
                {r.courses.length > 0 && (
                  <svg className="grad-done-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 9.5l6 6 6-6" />
                  </svg>
                )}
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.ul
                    key="courses"
                    className="grad-courses"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: dur(0.35), ease: EASE }}
                  >
                    {r.courses.map((n) => (
                      <CourseLine key={n.id} n={n} />
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ul>
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
            <span className="grad-tab-count">{list.filter((r) => r.status === t.id).length}</span>
          </Choice>
        ))}
      </div>
      <div className="sheet-body">
        {data.records === null ? (
          <p className="quiet">{data.practiceError ?? '无'}</p>
        ) : shown.length === 0 ? (
          <p className="quiet">无</p>
        ) : (
          <ul className="grad-records">
            {shown.map((r) => (
              <li key={r.id} className="grad-record">
                <span className="grad-record-main">
                  <span className="grad-record-name">{r.name}</span>
                  <span className="grad-record-sub">
                    <Joined parts={[r.time && dotDate(r.time), r.category, r.type, r.status !== 'done' && r.statusLabel]} />
                  </span>
                </span>
                <span className="grad-record-points">{r.points !== null && `${fmt(r.points)} 记点`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

/** 毕业自审自己的侧页（右侧滑出）；Esc、点遮罩、关闭按钮、手机上往右划都能收起，安卓返回键经 Esc 收起 */
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
            {...swipeToClose(onClose)}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: dur(0.6), ease: EASE }}
          >
            <CloseButton className="grad-sheet-close" onClick={onClose} />
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
