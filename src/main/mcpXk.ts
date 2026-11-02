import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ConfirmRequest, McpToolGroup } from '@shared/types'
import type { XkCourse, XkSection } from '@shared/xk'
import { call } from './ipc'

// 选课与查老师的 MCP 工具（由 mcp.ts 的 buildServer 调用）：查询组只读；订阅归界面组；
// 加入志愿 / 退选 / 调序 / 授权自动选课归提交组，一律先经 askUser 让用户在应用内确认

const json = (value: unknown): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }]
})

const read = { readOnlyHint: true, openWorldHint: true }
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }

// 课程原样传回 search_courses / list_category_courses 的返回项（至少 code、pool、tab、keyword）
const course = z
  .object({
    code: z.string(),
    pool: z.string(),
    tab: z.string().optional().describe('课程所属页签，缺省为搜索页签 xk_9'),
    keyword: z.string().optional().describe('搜索得到的课程须原样带上'),
    name: z.string().optional()
  })
  .describe('search_courses / list_category_courses 返回的一项')

const toCourse = (c: z.infer<typeof course>): XkCourse => ({
  code: c.code,
  pool: c.pool,
  tab: c.tab ?? 'xk_9',
  keyword: c.keyword ?? '',
  name: c.name ?? '',
  credit: null,
  category: '',
  college: ''
})

async function findSection(c: z.infer<typeof course>, sectionId: string): Promise<{ course: XkCourse; section: XkSection }> {
  const full = toCourse(c)
  const section = (await call('xk:sections', full)).find((s) => s.id === sectionId)
  if (!section) throw new Error('未找到该教学班')
  return { course: full, section }
}

const describe = (s: XkSection): string => [s.teachers.join(' '), s.times.join(' '), s.semesterPart].filter(Boolean).join('　')

export function registerXkTools(
  mcp: McpServer,
  tools: Record<McpToolGroup, boolean>,
  askUser: (request: Omit<ConfirmRequest, 'id'>) => Promise<boolean>
): void {
  const cancelled = json({ status: 'cancelled', message: '用户取消' })

  if (tools.query) {
    mcp.registerTool('get_course_selection_context', {
      description:
        '选课：当前选课学年学期、每门课（通识为每个上课时间组）可填志愿数 maxChoices、已选学分（credits.total ≤ 22 才能参加低学分定点选课）、课程类别页签 categories。选课未开放时报错。培养方案里还没修的课见 get_graduation_audit',
      annotations: read
    }, async () => json(await call('xk:context')))

    mcp.registerTool('search_courses', {
      description: '选课：按课程名搜索本学期开设的课程；返回项原样传给 get_course_sections',
      inputSchema: { keyword: z.string().describe('课程名关键词'), only_available: z.boolean().optional().describe('只看有余量的') },
      annotations: read
    }, async ({ keyword, only_available }) => json(await call('xk:search', keyword, only_available)))

    mcp.registerTool('list_category_courses', {
      description: '选课：某个类别页签（get_course_selection_context 的 categories[].id，如本专业课程、通识选修、体育）下的全部课程',
      inputSchema: { category_id: z.string() },
      annotations: read
    }, async ({ category_id }) => json(await call('xk:courses', category_id)))

    mcp.registerTool('get_course_sections', {
      description:
        '选课：某门课的教学班：教师、上课时间 times 与解析后的 slots（weekday 1–7、节次、parity 单双周）、学期段 semesterPart（秋冬 / 秋 / 冬…，不同学期段不冲突）、地点、考试时间、余量 remaining / 容量 capacity、待定人数 pending（常规轮次统一筛选，待定多于余量意味着要竞争）',
      inputSchema: { course },
      annotations: read
    }, async (args) => json(await call('xk:sections', toCourse(args.course))))

    mcp.registerTool('get_selected_courses', {
      description:
        '选课：本人已填的志愿：state 为 selected（已选上）或 pending（待筛选），order 为组内志愿次序，group 为志愿组（普通课同一门课的几个教学班为一组；通识按上课时间分组，同一时间的不同课程互为备选）',
      annotations: read
    }, async () => json(await call('xk:selected')))

    mcp.registerTool('get_teacher_rating', {
      description: '查老师（chalaoshi.de，学生评教站）：教师评分、评分人数、点名比例、所教课程的平均绩点。需本机能访问该站（国内一般要代理）；找不到返回 null',
      inputSchema: { name: z.string().describe('教师姓名'), college: z.string().optional().describe('学院，同名时用来区分') },
      annotations: read
    }, async ({ name, college }) => json(await call('cls:teacher', name, college)))

    mcp.registerTool('get_teacher_comments', {
      description: '查老师上某位教师的学生评论（get_teacher_rating 返回的 id）',
      inputSchema: { id: z.number(), sort: z.enum(['rate', 'time']).optional().describe('rate 按点赞（默认），time 按时间') },
      annotations: read
    }, async ({ id, sort }) => json(await call('cls:comments', id, sort ?? 'rate')))
  }

  if (tools.app) {
    mcp.registerTool('watch_course_section', {
      description: '选课订阅：定时查某个教学班的余量，有余量时弹 Windows 通知（低定期间 18:00–24:00 每 20–40 秒，其余每 5 分钟）。只提醒不提交；要自动提交用 auto_select_section',
      inputSchema: { course, section_id: z.string().describe('get_course_sections 返回的 id') },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true }
    }, async (args) => {
      const { course: c, section } = await findSection(args.course, args.section_id)
      return json(await call('xk:watch', c, section, false))
    })

    mcp.registerTool('unwatch_course_section', {
      description: '取消某个教学班的选课订阅',
      inputSchema: { section_id: z.string() },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false }
    }, async ({ section_id }) => json(await call('xk:unwatch', section_id)))

    mcp.registerTool('list_course_watches', {
      description: '当前的选课订阅、是否授权自动选课与最近查到的余量',
      annotations: { readOnlyHint: true, openWorldHint: false }
    }, async () => json(await call('xk:watches')))
  }

  if (tools.submit) {
    mcp.registerTool('select_course_section', {
      description: '选课：把一个教学班加入志愿（排在该组最后；常规轮次截止后统一筛选，低定期间有余量即可选上）。应用内会请用户确认；结果不明时不要重试，先 get_selected_courses',
      inputSchema: { course, section_id: z.string() },
      annotations: write
    }, async (args) => {
      const { section } = await findSection(args.course, args.section_id)
      if (!(await askUser({ action: 'select', courseName: section.courseName, title: describe(section), files: [], comment: '' }))) return cancelled
      return json(await call('xk:select', section))
    })

    mcp.registerTool('reorder_course_preferences', {
      description: '选课：调整一个志愿组的顺序（get_selected_courses 中同一 group 的全部 id，按新顺序）。调整已选上的课会重新参与筛选。应用内会请用户确认',
      inputSchema: { section_ids: z.array(z.string()).min(1) },
      annotations: write
    }, async ({ section_ids }) => {
      const chosen = await call('xk:selected')
      const first = chosen.find((s) => s.id === section_ids[0])
      if (!first) throw new Error('该教学班不在志愿中')
      const title = section_ids
        .map((id, i) => {
          const s = chosen.find((x) => x.id === id)
          return `${i + 1}. ${s ? `${s.courseName} ${describe(s)}` : id}`
        })
        .join('　')
      if (!(await askUser({ action: 'reorder', courseName: first.courseName, title, files: [], comment: '' }))) return cancelled
      return json(await call('xk:reorder', section_ids))
    })

    mcp.registerTool('drop_course_section', {
      description: '选课：退选一个已填的志愿（get_selected_courses 的 id）。已选上的课退选后不保证能再选回。应用内会请用户确认',
      inputSchema: { section_id: z.string() },
      annotations: { ...write, destructiveHint: true }
    }, async ({ section_id }) => {
      const section = (await call('xk:selected')).find((s) => s.id === section_id)
      if (!section) throw new Error('该教学班不在志愿中')
      if (!(await askUser({ action: 'drop', courseName: section.courseName, title: describe(section), files: [], comment: '' }))) return cancelled
      return json(await call('xk:drop', section_id))
    })

    mcp.registerTool('auto_select_section', {
      description: '选课订阅并授权自动提交：该教学班有余量时自动加入志愿（选上后停止；总学分超过 22 时全部停止；被拒或结果不明时停止自动提交并通知）。应用内会请用户确认授权',
      inputSchema: { course, section_id: z.string() },
      annotations: write
    }, async (args) => {
      const { course: c, section } = await findSection(args.course, args.section_id)
      if (!(await askUser({ action: 'autoselect', courseName: section.courseName, title: describe(section), files: [], comment: '' }))) return cancelled
      return json(await call('xk:watch', c, section, true))
    })
  }
}
