import { createContext, useContext } from 'react'
import type { XkCourse, XkSection, XkSlot, XkWatch } from '@shared/xk'
import { Joined } from '@renderer/components/Type'
import { MOBILE } from '@renderer/lib/platform'
import { ArmedButton, When, examKey, examLabel } from './bits'
import { useTeacher } from './TeacherSheet'
import { chanceOf, percent, ratingKey, useXkData } from './xkData'
import { groupFor, halvesOverlap, isLead, slotsOverlap } from './xkLogic'

/** 找课与课程详情共用的状态与操作 */
export interface XkEnv {
  chosen: XkSection[]
  max: number
  busy: string | null
  watchOf: (id: string) => XkWatch | undefined
  isGeneral: (c: XkCourse) => boolean
  add: (course: XkCourse, s: XkSection) => void
  remove: (s: XkSection) => void
  watch: (course: XkCourse, s: XkSection) => void
  hover: (s: XkSection | null, course?: XkCourse) => void
  teacher: (name: string, college: string) => void
}

export const XkEnvContext = createContext<XkEnv | null>(null)
export const useXkEnv = (): XkEnv => useContext(XkEnvContext)!

/** 一个教学班与志愿里别组领头志愿（真正占时间的那个）的冲突：每段时间、考试 */
export function clashInfo(s: XkSection, chosen: XkSection[], general: boolean) {
  const group = chosen.find((x) => x.id === s.id)?.group ?? groupFor(s, chosen, general)
  const others = chosen.filter((x) => x.id !== s.id && (x.group ?? x.courseCode) !== group && x.courseCode !== s.courseCode && isLead(x))
  const timed = others.filter((x) => halvesOverlap(x.semesterPart, s.semesterPart))
  const exam = examKey(s.exam)
  return {
    slot: (slot: XkSlot): 'hard' | 'lead' | null => {
      const hit = timed.filter((x) => x.slots.some((t) => slotsOverlap(t, slot)))
      return hit.length ? (hit.some((x) => x.state === 'selected') ? 'hard' : 'lead') : null
    },
    exam: !!exam && others.some((x) => examKey(x.exam) === exam)
  }
}

/** 教学班卡片：教师与评分（可点，看查老师）、时间（撞课的那段主题色）、地点与考试；右边余量、待定人数、选中概率；最右操作 */
export function SectionCard({ course, section: s, dim, detailed }: { course: XkCourse; section: XkSection; dim?: boolean; detailed?: boolean }) {
  const env = useXkEnv()
  const mine = env.chosen.find((x) => x.id === s.id)
  const general = env.isGeneral(course)
  const group = mine?.group ?? groupFor(s, env.chosen, general)
  const members = env.chosen.filter((x) => (x.group ?? x.courseCode) === group)
  const clash = clashInfo(s, env.chosen, general)
  const chance = mine?.state === 'selected' ? null : chanceOf(s)
  const watch = env.watchOf(s.id)
  const full = !mine && members.length >= env.max
  const locked = env.busy !== null
  const next = members.length + 1

  return (
    <li
      className="xk-sec"
      data-mine={mine ? true : undefined}
      data-dim={dim || undefined}
      onPointerEnter={(e) => e.pointerType === 'mouse' && env.hover(s, course)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && env.hover(null)}
    >
      <div className="xk-sec-main">
        <div className="xk-sec-who">
          {s.teachers.length ? (
            s.teachers.map((t) => <TeacherName key={t} name={t} college={course.college} courseName={detailed ? course.name : undefined} onOpen={() => env.teacher(t, course.college)} />)
          ) : (
            <span className="xk-teacher">—</span>
          )}
          {mine && (
            <span className="xk-tag" data-tone="solid">
              {mine.state === 'selected' ? '已选上' : `第 ${mine.order ?? 1} 志愿`}
            </span>
          )}
        </div>
        <div className="xk-sec-line">
          <When s={s} clash={clash.slot} />
          <Joined parts={[s.places.join(' '), s.exam && <span data-clash={clash.exam || undefined}>考试 {examLabel(s.exam)}</span>]} />
        </div>
        {detailed && (
          <div className="xk-sec-line">
            <Joined parts={[s.mode, s.weeklyHours && `周学时 ${s.weeklyHours}`, s.audience, s.textbook && `教材 ${s.textbook}`]} />
          </div>
        )}
      </div>
      {/* 余量 / 容量与选中概率一行，待定人数一行（选上的人数 = 容量 − 余量，不另写） */}
      <div className="xk-cap" data-full={s.remaining === 0 || undefined}>
        <span className="xk-cap-top">
          <span className="xk-cap-figure">
            {s.remaining ?? '—'}
            {s.capacity !== null && <small>/{s.capacity}</small>}
          </span>
          {chance !== null && (
            <em data-hot={chance < 1 || undefined}>
              <small>概率</small>
              {percent(chance)}
            </em>
          )}
        </span>
        <span className="xk-cap-line">
          {s.pending !== null && `待定 ${s.pending}`}
        </span>
      </div>
      <div className="xk-sec-acts">
        {mine ? (
          mine.state === 'selected' ? (
            <ArmedButton className="btn xk-sec-btn" label="退选" confirm="确认退选" onRun={() => env.remove(mine)} disabled={locked} />
          ) : (
            <button className="btn xk-sec-btn" disabled={locked} onClick={() => env.remove(mine)}>
              移出
            </button>
          )
        ) : (
          <button className="btn btn-solid xk-sec-btn" disabled={locked || full} onClick={() => env.add(course, s)}>
            {full ? '志愿已满' : env.busy === s.id ? '提交中' : next === 1 ? '加入志愿' : `加为第 ${next} 志愿`}
          </button>
        )}
        {!MOBILE && !mine && (s.remaining === 0 || watch) && (
          <button className="act" data-on={watch ? true : undefined} onClick={() => env.watch(course, s)}>
            {watch ? (watch.auto ? '自动选中' : '订阅中') : '订阅余量'}
          </button>
        )}
      </div>
    </li>
  )
}

/** 教师名 + 查老师评分（≥ 8.5 主题色）；课程详情里再带这门课在查老师上的均绩。点开看详情与评论 */
function TeacherName({ name, college, courseName, onOpen }: { name: string; college: string; courseName?: string; onOpen: () => void }) {
  const rating = useXkData((d) => d.ratings[ratingKey(name, college)])
  return (
    <button className="xk-teacher" onClick={onOpen} title="查老师">
      {name}
      {typeof rating === 'number' && <em data-high={rating >= 8.5 || undefined}>{rating.toFixed(1)}</em>}
      {courseName && <CourseGpa name={name} college={college} course={courseName} />}
      <svg className="xk-teacher-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  )
}

function CourseGpa({ name, college, course }: { name: string; college: string; course: string }) {
  const t = useTeacher(name, college)
  const hit = t?.courses.find((c) => c.name === course) ?? t?.courses.find((c) => c.name.includes(course) || course.includes(c.name))
  return hit ? <small className="xk-teacher-gpa">均绩 {hit.gpa.toFixed(2)}</small> : null
}
