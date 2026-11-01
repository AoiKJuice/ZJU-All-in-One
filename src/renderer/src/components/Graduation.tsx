import { useState, type ReactNode } from 'react'
import type { AuditNode, AuditStatus, ClassroomCredit, EducationCredit } from '@shared/types'
import { useZju } from '@renderer/hooks/useZju'
import { Choice, Joined, Quiet, Reveal, SectionHead } from '@renderer/components/Type'
import './graduation.css'

const STATUS: Record<AuditStatus, string> = { passed: '通过', failed: '未通过', replaced: '已替代', studying: '在修', none: '未修' }
const unfinished = (n: AuditNode): boolean => n.status === 'failed' || n.status === 'studying' || n.status === 'none'

/** 1.50 → 1.5，6 → 6 */
const fmt = (n: number): string => String(Number(n.toFixed(2)))
/** 「150+8」这类复合学分只取主项算进度 */
const lead = (value?: string): number => parseFloat(value ?? '') || 0

interface Tree {
  children: Map<string | null, AuditNode[]>
  required: (n: AuditNode) => boolean
}

function buildTree(nodes: AuditNode[]): Tree {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<string | null, AuditNode[]>()
  for (const n of nodes) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n])
  // 本身或任一上级模块标为必修（选必修字段或名称）即算必修
  const required = (n: AuditNode): boolean => {
    for (let cur: AuditNode | undefined = n; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (cur.kind?.includes('必修') || (!cur.code && cur.name.includes('必修'))) return true
    }
    return false
  }
  return { children, required }
}

/** 工具页「毕业自审」：二三四课堂与美育劳育在上，必修课程完成情况与各模块学分在下 */
export function Graduation() {
  const { data, loading, error } = useZju('data:graduation')
  const [all, setAll] = useState(false)
  const tree = data?.nodes ? buildTree(data.nodes) : null
  const courses = data?.nodes?.filter((n) => n.code && tree!.required(n)) ?? []
  const missing = courses.filter(unfinished)
  const studying = missing.filter((n) => n.status === 'studying').length

  const quiet = (part: string | undefined) => <Quiet loading={loading} error={error ?? part ?? null} empty="无" />

  return (
    <>
      <Reveal>
        <h1 className="page-title">毕业自审</h1>
      </Reveal>
      {data?.nodes && (
        <Reveal i={1}>
          <p className="page-lede">
            <Joined
              parts={[
                missing.length ? (
                  <>
                    必修还差 <em>{missing.length}</em> 门
                  </>
                ) : (
                  '必修已全部完成'
                ),
                studying > 0 && `在修 ${studying} 门`
              ]}
            />
          </p>
        </Reveal>
      )}

      <div className="grad-top">
        <Reveal i={2} flat className="panel">
          <SectionHead title="课堂" />
          {data?.classrooms ? (
            <div className="grad-tiles grad-tiles-3">
              <ClassroomTile name="第二课堂" c={data.classrooms.second} />
              <ClassroomTile name="第三课堂" c={data.classrooms.third} />
              <ClassroomTile name="第四课堂" c={data.classrooms.fourth} />
            </div>
          ) : (
            quiet(data?.practiceError)
          )}
        </Reveal>
        <Reveal i={3} flat className="panel">
          <SectionHead title="美育 劳育" />
          {data ? (
            <div className="grad-tiles grad-tiles-2">
              <EducationTile name="美育" e={data.aesthetic} />
              <EducationTile name="劳育" e={data.labor} />
            </div>
          ) : (
            quiet(undefined)
          )}
        </Reveal>
      </div>

      <div className="grad-bottom">
        <Reveal i={4} flat className="panel">
          <SectionHead
            title="必修"
            note={
              tree && (
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
          {tree ? <Required tree={tree} all={all} /> : quiet(data?.nodesError)}
        </Reveal>
        <Reveal i={5} flat className="panel">
          <SectionHead title="模块" />
          {tree ? <Modules tree={tree} /> : quiet(data?.nodesError)}
        </Reveal>
      </div>
    </>
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

function ClassroomTile({ name, c }: { name: string; c: ClassroomCredit }) {
  return (
    <div className="grad-tile">
      <span className="grad-tile-head">
        {name}
        <Chip ok={c.passed} />
      </span>
      <span className="grad-figure">
        {fmt(c.points)}
        <small>记点</small>
      </span>
      <span className="grad-tile-sub">
        <Joined parts={[c.credits !== null && `${fmt(c.credits)} 学分`, c.grade]} />
      </span>
    </div>
  )
}

function EducationTile({ name, e }: { name: string; e: EducationCredit }) {
  return (
    <div className="grad-tile">
      <span className="grad-tile-head">
        {name}
        <Chip ok={e.passed} />
      </span>
      <span className="grad-figure">
        {e.points === null ? '—' : fmt(e.points)}
        <small>记点</small>
      </span>
      <span className="grad-tile-sub">
        {e.requiredCredits !== undefined && `学分 ${e.earnedCredits ?? 0} / ${e.requiredCredits}`}
      </span>
    </div>
  )
}

/** 必修课程按所属模块分组；「未完成」只列未通过、在修、未修的课，整组完成的模块不出现 */
function Required({ tree, all }: { tree: Tree; all: boolean }) {
  const groups = [...tree.children.entries()]
    .map(([parentId, list]) => ({ parentId, courses: list.filter((n) => n.code && tree.required(n)) }))
    .filter((g) => g.courses.length > 0)
    .map((g) => ({ ...g, shown: all ? g.courses : g.courses.filter(unfinished) }))
    .filter((g) => g.shown.length > 0)
  const modules = new Map([...tree.children.values()].flat().map((n) => [n.id, n]))

  if (groups.length === 0) return <p className="quiet">无</p>
  return (
    <div className="grad-groups">
      {groups.map((g) => {
        const m = g.parentId ? modules.get(g.parentId) : undefined
        return (
          <section key={g.parentId ?? 'root'} className="grad-group">
            {m && (
              <h3 className="group-title grad-group-title">
                <span>{m.name}</span>
                <span className="grad-group-meta">
                  <Joined
                    parts={[
                      m.requiredCredits && `${m.earnedCredits ?? 0} / ${m.requiredCredits} 学分`,
                      m.requiredCourses && `${m.completedCourses ?? 0} / ${m.requiredCourses} 门`
                    ]}
                  />
                </span>
              </h3>
            )}
            <ul className="rows">
              {g.shown.map((n) => (
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
          </section>
        )
      })}
    </div>
  )
}

/** 全部模块的学分进度（名称下一条通栏的圆角进度条），子模块缩进 */
function Modules({ tree }: { tree: Tree }) {
  const rows: { node: AuditNode; depth: number }[] = []
  const walk = (parentId: string | null, depth: number): void => {
    for (const n of tree.children.get(parentId) ?? []) {
      if (n.code) continue
      rows.push({ node: n, depth })
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)

  if (rows.length === 0) return <p className="quiet">无</p>
  return (
    <ul className="rows">
      {rows.map(({ node: m, depth }) => {
        const required = lead(m.requiredCredits)
        const ratio = required > 0 ? Math.min(lead(m.earnedCredits) / required, 1) : null
        return (
          <li key={m.id} className="row grad-module" style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
            <span className="row-title">{m.name}</span>
            <span className="row-end">{m.requiredCredits && `${m.earnedCredits ?? 0} / ${m.requiredCredits}`}</span>
            {ratio !== null && (
              <span className="grad-meter" data-full={ratio >= 1 || undefined}>
                <span style={{ width: `${ratio * 100}%` }} />
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
