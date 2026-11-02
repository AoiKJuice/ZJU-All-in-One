import type { CSSProperties } from 'react'
import type { XkSection, XkSlot } from '@shared/xk'
import { COURSE_COLORS, colorVar } from '@renderer/lib/courseColor'
import { halfOf, halvesOverlap, isLead, sectionsOverlap, slotsOverlap } from './xkLogic'

const DAYS = ['一', '二', '三', '四', '五', '六', '日']
const BLOCKS: [number, number][] = [
  [1, 5],
  [6, 10],
  [11, 13]
]

// 上午 / 下午 / 晚上之间空一小行：第 p 节所在的网格行（第 1 行是星期）
const row = (p: number): number => 1 + p + (p > 5 ? 1 : 0) + (p > 10 ? 1 : 0)

// 课名配色：与课表页同一套 --course-0…7；按第一次出现的先后取下一个颜色，之后不再变（志愿增减时别的课不换色）
const palette = new Map<string, number>()
export function xkColors(sections: XkSection[]): Map<string, number> {
  for (const s of sections) if (!palette.has(s.courseName)) palette.set(s.courseName, palette.size % COURSE_COLORS)
  return palette
}

interface Block {
  key: string
  section: XkSection
  slot: XkSlot
  kind: 'lead' | 'backup' | 'preview'
  clash?: boolean
}

/**
 * 志愿课表：每组领头的志愿（已选上或第一志愿）为课名配色的实底块，其后志愿为同色虚线框；
 * 只上半学期的课占半格（秋 / 春在左，冬 / 夏在右）。悬停教学班时以主题色虚框预览，撞上别组领头志愿的那几格为斜纹；
 * 悬停某个志愿组时其余淡下去
 */
export function XkTimetable({
  chosen,
  preview,
  previewGroup,
  focus,
  onPick
}: {
  chosen: XkSection[]
  preview: XkSection | null
  /** 预览的教学班加入后所在的志愿组（同组互为备选，不算冲突） */
  previewGroup: string | null
  focus: string | null
  onPick: (s: XkSection) => void
}) {
  const colors = xkColors(chosen)
  const leads = chosen.filter(isLead)
  const blocks: Block[] = []
  for (const s of chosen) {
    const lead = isLead(s)
    const groupLead = leads.find((l) => l.group === s.group && l !== s)
    for (const [j, slot] of s.slots.entries()) {
      // 通识同一时间组的备选与领头完全重合，不再画
      if (!lead && groupLead?.slots.some((t) => t.weekday === slot.weekday && t.start === slot.start && t.end === slot.end)) continue
      const clash = lead && leads.some((l) => l.group !== s.group && sectionsOverlap(l, s))
      blocks.push({ key: `${s.id}-${j}`, section: s, slot, kind: lead ? 'lead' : 'backup', clash })
    }
  }
  if (preview && !chosen.some((s) => s.id === preview.id)) {
    const others = leads.filter((l) => (l.group ?? l.courseCode) !== previewGroup && halvesOverlap(l.semesterPart, preview.semesterPart))
    preview.slots.forEach((slot, j) =>
      blocks.push({ key: `p-${j}`, section: preview, slot, kind: 'preview', clash: others.some((l) => l.slots.some((t) => slotsOverlap(t, slot))) })
    )
  }

  const weekend = blocks.some((b) => b.slot.weekday >= 6)
  const days = weekend ? 7 : 5

  const place = (slot: XkSlot, part: string): CSSProperties => {
    const half = halfOf(part)
    const col = 2 + (slot.weekday - 1) * 2 + (half === '冬' || half === '夏' ? 1 : 0)
    return { gridRow: `${row(slot.start)} / ${row(slot.end) + 1}`, gridColumn: `${col} / span ${half ? 1 : 2}` }
  }

  return (
    <div className="xk-tt" style={{ gridTemplateColumns: `1.5rem repeat(${days * 2}, minmax(0, 1fr))` }}>
      {DAYS.slice(0, days).map((d, i) => (
        <span key={d} className="xk-tt-day" style={{ gridColumn: `${2 + i * 2} / span 2` }}>
          {d}
        </span>
      ))}
      {Array.from({ length: 13 }, (_, i) => (
        <span key={i} className="xk-tt-no" style={{ gridRow: row(i + 1) }}>
          {i + 1}
        </span>
      ))}
      {DAYS.slice(0, days).flatMap((d, i) =>
        BLOCKS.map(([a, b]) => (
          <span key={`${d}${a}`} className="xk-tt-bg" style={{ gridRow: `${row(a)} / ${row(b) + 1}`, gridColumn: `${2 + i * 2} / span 2` }} />
        ))
      )}
      {blocks
        .filter((b) => b.slot.weekday <= days)
        .map((b) => {
          const tall = b.slot.end > b.slot.start
          return (
            <button
              key={b.key}
              className="xk-tt-block"
              data-kind={b.kind}
              data-clash={b.clash || undefined}
              data-dim={(focus !== null && b.kind !== 'preview' && (b.section.group ?? b.section.courseCode) !== focus) || undefined}
              style={{ ...place(b.slot, b.section.semesterPart), ['--cc' as string]: colorVar(colors.get(b.section.courseName)) }}
              title={[b.section.courseName, b.section.teachers.join(' '), b.section.places.join(' ')].filter(Boolean).join('\n')}
              tabIndex={-1}
              onClick={() => onPick(b.section)}
            >
              {b.kind === 'lead' && tall && <span>{b.section.courseName}</span>}
            </button>
          )
        })}
    </div>
  )
}
