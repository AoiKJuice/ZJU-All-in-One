import type { AuditNode, AuditStatus, DataResult, EducationCredit, GraduationAudit } from '@shared/types'
import { post } from './zdbk'
import { fetchPractice, reset as resetSztz } from './sztz'

// 毕业自审 = 教务「毕业审核 → 毕业资格自审」+ 第二课堂系统，两部分各自可能失败。
// 教务接口照开源的 zju-course-planner（course_assistant/school_http.py、graduation_audit.py，2026-10 以登录态实测）：
// POST bysh/byshck_cxByshzsIndex.html?doType=query&gnmkdm=N6025，表单只带 queryModel.currentPage=1、showCount=5000，
// 返回整棵树的平铺数组（不分页）：JDDM / FJDDM 节点与父节点，JDMC 名称，KCDM 课程代码（模块为空），KCXF 学分，CJ 成绩，
// SFTG 审核状态（通过 / 不通过 / 被替代），KCBZ 备注（在修），TDKC 替代说明，XBX 选必修，YQXF / YXXF 要求 / 已获学分，
// YQMS / YXMS 要求 / 完成门数；JDDM 以 head_ 开头的是表头行。值里可能夹带 HTML。只读，不调用重算审核等写接口。

const AUDIT_PATH = '/bysh/byshck_cxByshzsIndex.html?doType=query&gnmkdm=N6025'

type Value = string | number | null | undefined

interface AuditRow {
  JDDM: string
  FJDDM?: Value
  JDMC: string
  KCDM?: Value
  KCXF?: Value
  CJ?: Value
  SFTG?: Value
  KCBZ?: Value
  TDKC?: Value
  XBX?: Value
  YQXF?: Value
  YXXF?: Value
  YQMS?: Value
  YXMS?: Value
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function text(value: Value): string | undefined {
  if (value === null || value === undefined) return undefined
  const clean = String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name])
    .replace(/\s+/g, ' ')
    .trim()
  return clean || undefined
}

function status(row: AuditRow): AuditStatus {
  const value = text(row.SFTG)
  if (value === '通过') return 'passed'
  if (value === '不通过') return 'failed'
  if (value === '被替代') return 'replaced'
  return text(row.KCBZ)?.includes('在修') ? 'studying' : 'none'
}

export async function fetchAuditTree(): Promise<AuditNode[]> {
  const rows = await post<AuditRow[]>(AUDIT_PATH, { 'queryModel.currentPage': '1', 'queryModel.showCount': '5000' })
  return rows
    .filter((row) => !row.JDDM.startsWith('head_'))
    .map((row): AuditNode => {
      const kcbz = text(row.KCBZ)
      const credits = text(row.KCXF)
      return {
        id: row.JDDM,
        parentId: text(row.FJDDM) ?? null,
        name: text(row.JDMC) ?? '',
        code: text(row.KCDM),
        kind: text(row.XBX),
        credits: credits === undefined ? undefined : Number(credits),
        grade: text(row.CJ),
        status: status(row),
        note: text(row.TDKC) ?? (kcbz === '在修' ? undefined : kcbz),
        requiredCredits: text(row.YQXF),
        earnedCredits: text(row.YXXF),
        requiredCourses: text(row.YQMS),
        completedCourses: text(row.YXMS)
      }
    })
}

/** 自审树里名称匹配的模块（或课程）的学分：美育、劳动教育在各专业培养方案里的叫法不一，推测按名称找 */
function creditsOf(nodes: AuditNode[] | null, pattern: RegExp): Pick<EducationCredit, 'earnedCredits' | 'requiredCredits'> {
  const module = nodes?.find((n) => !n.code && pattern.test(n.name) && n.requiredCredits)
  if (module) return { earnedCredits: module.earnedCredits ?? '0', requiredCredits: module.requiredCredits }
  const courses = nodes?.filter((n) => n.code && pattern.test(n.name)) ?? []
  if (courses.length === 0) return {}
  const sum = (list: AuditNode[]): string => String(list.reduce((s, n) => s + (n.credits ?? 0), 0))
  return { earnedCredits: sum(courses.filter((n) => n.status === 'passed')), requiredCredits: sum(courses) }
}

const message = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

export function reset(): void {
  resetSztz()
}

export async function fetchGraduation(): Promise<DataResult<GraduationAudit>> {
  const [tree, practice] = await Promise.allSettled([fetchAuditTree(), fetchPractice()])
  // 两边都失败（多半未登录）时整体报错，界面显示登录入口
  if (tree.status === 'rejected' && practice.status === 'rejected') throw tree.reason

  const nodes = tree.status === 'fulfilled' ? tree.value : null
  const extra = practice.status === 'fulfilled' ? practice.value : null
  const data: GraduationAudit = {
    nodes,
    nodesError: tree.status === 'rejected' ? message(tree.reason) : undefined,
    classrooms: extra?.classrooms ?? null,
    aesthetic: { passed: null, points: null, ...extra?.aesthetic, ...creditsOf(nodes, /美育/) },
    labor: { passed: null, points: null, ...extra?.labor, ...creditsOf(nodes, /劳动|劳育/) },
    practiceError: practice.status === 'rejected' ? message(practice.reason) : undefined
  }
  return { data, source: 'live', fetchedAt: Date.now() }
}
