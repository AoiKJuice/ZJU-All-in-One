import { useEffect } from 'react'
import type { XkCourse } from '@shared/xk'
import { Joined } from '@renderer/components/Type'
import { fmt } from './bits'
import { SectionCard } from './SectionCard'
import { XkSheet } from './TeacherSheet'
import { courseKey, requestSections, useXkData } from './xkData'

/** 课程详情：课程信息标签与全部教学班（含教学方式、周学时、面向、教材与各位老师在查老师上这门课的均绩），可直接加入志愿 */
export function XkCourseSheet({ course, onClose }: { course: XkCourse | null; onClose: () => void }) {
  const entry = useXkData((d) => (course ? d.sections[courseKey(course)] : undefined))

  useEffect(() => {
    if (course) requestSections([course], { front: true })
  }, [course])

  return (
    <XkSheet open={course !== null} onClose={onClose}>
      {course && (
        <>
          <h2 className="sheet-title">{course.name}</h2>
          <p className="sheet-meta">
            <Joined
              parts={[
                course.displayCode || course.code,
                course.credit !== null && `${fmt(course.credit)} 学分`,
                course.nature,
                course.category,
                course.college,
                course.semesterPart
              ]}
            />
          </p>
          <div className="sheet-body">
            {!entry ? (
              <p className="quiet">…</p>
            ) : 'error' in entry.value ? (
              <p className="quiet">{entry.value.error}</p>
            ) : entry.value.data.length === 0 ? (
              <p className="quiet">无</p>
            ) : (
              <ul className="xk-sections xk-sheet-sections">
                {entry.value.data.map((s) => (
                  <SectionCard key={s.id} course={course} section={s} detailed />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </XkSheet>
  )
}
