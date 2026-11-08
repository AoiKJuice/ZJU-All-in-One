import type { Assignment, AuditNode, GraduationAudit, CourseSession, DataResult, Exam, LectureReplay, Slide, TranscriptSegment, AssignmentDetail, PickedFile, PtaState } from '@shared/types'
import { beijingDay, summarizeHomework, summarizeLibrary, type HomeworkUsage, type LibraryUsage, type UsageBooking, type UsageSubmission } from '@shared/usage'

// 演示数据：ZJU_DEMO=1 时替代全部数据通道，便于不登录调前端

export function mock<T>(data: T): DataResult<T> {
  return { data, source: 'mock', fetchedAt: Date.now() }
}

const day = (offset: number, hour: number, minute = 0): string => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

export const mockSchedule: CourseSession[] = [
  { id: 'c1', name: '数学分析（甲）Ⅰ', teacher: '张老师', location: '东1A-201', weekday: 1, startPeriod: 1, endPeriod: 2, semesterPart: '秋冬', weekRange: [1, 8], weekParity: 'all' },
  { id: 'c2', name: '线性代数（甲）', teacher: '李老师', location: '东2-302', weekday: 2, startPeriod: 3, endPeriod: 5, semesterPart: '秋冬', weekRange: [1, 8], weekParity: 'all' },
  { id: 'c3', name: '程序设计基础', teacher: '王老师', location: '曹西-501', weekday: 3, startPeriod: 6, endPeriod: 8, semesterPart: '秋', weekRange: [1, 8], weekParity: 'all' },
  { id: 'c4', name: '大学物理（甲）Ⅰ', teacher: '赵老师', location: '东3-104', weekday: 4, startPeriod: 1, endPeriod: 2, semesterPart: '秋冬', weekRange: [1, 8], weekParity: 'all' },
  // 教务把连上的课拆成两条的情况：6、7 节应合成一节；8、9 节隔着大课间不合并
  { id: 'c6a', name: '中国近现代史纲要', teacher: '周老师', location: '西2-105', weekday: 1, startPeriod: 6, endPeriod: 6, semesterPart: '秋冬', weekRange: [1, 16], weekParity: 'all' },
  { id: 'c6b', name: '中国近现代史纲要', teacher: '周老师', location: '西2-105', weekday: 1, startPeriod: 7, endPeriod: 7, semesterPart: '秋冬', weekRange: [1, 16], weekParity: 'all' },
  { id: 'c7a', name: '体育（篮球）', teacher: '吴老师', location: '风雨操场', weekday: 4, startPeriod: 8, endPeriod: 8, semesterPart: '秋冬', weekRange: [1, 16], weekParity: 'all' },
  { id: 'c7b', name: '体育（篮球）', teacher: '吴老师', location: '风雨操场', weekday: 4, startPeriod: 9, endPeriod: 9, semesterPart: '秋冬', weekRange: [1, 16], weekParity: 'all' },
  { id: 'c5', name: '思想道德与法治', teacher: '陈老师', location: '西1-210', weekday: 5, startPeriod: 11, endPeriod: 13, semesterPart: '秋冬', weekRange: [1, 8], weekParity: 'all' }
]

export const mockExams: Exam[] = [
  { id: 'e1', courseName: '程序设计基础', startTime: day(9, 14), endTime: day(9, 16), location: '东1A-101', seat: '23' },
  { id: 'e2', courseName: '线性代数（甲）', startTime: day(21, 10, 30), endTime: day(21, 12, 30), location: '东2-202' }
]

export const mockAssignments: Assignment[] = [
  { id: 'a1', courseId: 'demo', type: 'homework', courseName: '程序设计基础', title: '实验 3：链表', deadline: day(1, 23, 59), submitted: false },
  { id: 'a4', courseId: 'demo', type: 'homework', courseName: '线性代数（甲）', title: '第 8 周作业', deadline: new Date(Date.now() + 2 * 3600_000).toISOString(), submitted: false },
  { id: 'a2', courseId: 'demo', type: 'homework', courseName: '大学物理（甲）Ⅰ', title: '第五章习题', deadline: day(3, 22), submitted: false },
  { id: 'a3', courseId: 'demo', type: 'homework', courseName: '数学分析（甲）Ⅰ', title: '作业 7', deadline: day(-1, 23, 59), submitted: true },
  { id: 'pta-demo', courseId: 'pta', type: 'pta', courseName: 'PTA', title: '第 6 周编程题：链表', deadline: day(2, 22), submitted: false, url: 'https://pintia.cn/problem-sets/dashboard', progress: { done: 3, total: 5 } }
]

// 数据统计演示（全部虚构）：确定性的伪随机，学期中多、期末更多、寒暑假少；走与真实数据相同的汇总

const seeded = (seed: number) => (): number => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
}

/** 这一天的活跃程度：寒暑假 / 期中 / 期末周前后 */
const activity = (date: string, term: number, finals: number, holiday: number): number => {
  const month = Number(date.slice(5, 7))
  if ([2, 7, 8].includes(month)) return holiday
  return [1, 6, 11].includes(month) ? finals : term
}

export function mockLibraryUsage(): LibraryUsage {
  const random = seeded(20261108)
  const now = Date.now()
  const bookings: UsageBooking[] = []
  for (let back = 371; back >= 0; back--) {
    const date = beijingDay(now - back * 864e5)
    if (random() > activity(date, 0.38, 0.7, 0.06)) continue
    const start = 8 + Math.floor(random() * 6)
    const hours = 1 + Math.floor(random() * 10)
    const end = Math.min(start + hours, 22)
    const fate = random()
    bookings.push({
      begin: `${date} ${String(start).padStart(2, '0')}:30`,
      end: `${date} ${String(end).padStart(2, '0')}:30`,
      status: fate < 0.1 ? '已取消' : fate < 0.15 ? '已违约' : '已使用'
    })
  }
  return summarizeLibrary(bookings, now)
}

const DEMO_HOMEWORK = ['第 4 章课后习题', '实验二报告', '期中小论文', '编程作业 3', '阅读札记']

export function mockHomeworkUsage(): HomeworkUsage {
  const random = seeded(61108)
  const now = Date.now()
  const submissions: UsageSubmission[] = []
  for (let back = 371; back >= 0; back--) {
    const date = beijingDay(now - back * 864e5)
    if (random() > activity(date, 0.3, 0.42, 0.02)) continue
    for (let n = 1 + Math.floor(random() ** 2 * 4); n > 0; n--) {
      const at = Math.min(now, Date.parse(`${date}T${String(12 + Math.floor(random() * 11)).padStart(2, '0')}:00:00+08:00`))
      const span = (5 + Math.floor(random() * 10)) * 864e5
      // 大多数人临近截止才交；少数逾期
      const position = random() < 0.07 ? 1.02 + random() * 0.3 : 1 - random() ** 1.8
      const open = at - position * span
      submissions.push({ activityId: `demo-${submissions.length}`, title: DEMO_HOMEWORK[submissions.length % DEMO_HOMEWORK.length], at, open, end: open + span })
    }
  }
  return summarizeHomework(submissions, now)
}

/** 课程作业演示：待办里这门课的，加两项已交、一项已截止未交 */
export function demoCourseHomework(courseName: string): Assignment[] {
  return [
    ...mockAssignments.filter((a) => a.courseName === courseName),
    { id: `${courseName}-h1`, courseId: 'demo', type: 'homework', courseName, title: '第 1 周作业', deadline: day(-40, 23, 59), submitted: true },
    { id: `${courseName}-h2`, courseId: 'demo', type: 'homework', courseName, title: '第 3 周作业', deadline: day(-26, 23, 59), submitted: true },
    { id: `${courseName}-h3`, courseId: 'demo', type: 'homework', courseName, title: '第 5 周作业', deadline: day(-12, 23, 59), submitted: false }
  ]
}

export const mockReplays: LectureReplay[] = [
  { id: 'r1', courseId: 'demo', courseName: '线性代数（甲）', title: '第 8 讲 特征值与特征向量', teacher: '李老师', recordedAt: day(-1, 9, 50), durationMinutes: 135, status: 'replay', date: day(-1, 0).slice(0, 10) },
  { id: 'r2', courseId: 'demo', courseName: '数学分析（甲）Ⅰ', title: '第 9 讲 一致连续', teacher: '张老师', recordedAt: day(-2, 8), durationMinutes: 90, status: 'replay', date: day(-1, 0).slice(0, 10) }
]

// 回放页演示：SVG 课件页（data URL）、几段文字稿
export const mockSlides: Slide[] = Array.from({ length: 12 }, (_, i) => ({
  time: i * 300,
  imageUrl:
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#fbfaf7"/><text x="80" y="160" font-size="64" font-family="serif" fill="#26221d">第 ${i + 1} 页</text><rect x="80" y="220" width="${400 + i * 40}" height="12" fill="#c9c2b6"/><rect x="80" y="260" width="620" height="12" fill="#c9c2b6"/></svg>`
    )
}))

export const mockPlatformTranscript: TranscriptSegment[] = Array.from({ length: 30 }, (_, i) => ({
  start: i * 26,
  end: i * 26 + 24,
  text: `智云自带文字稿第 ${i + 1} 句。`
}))

export const mockTranscript: TranscriptSegment[] = Array.from({ length: 40 }, (_, i) => ({
  start: i * 20,
  end: i * 20 + 18,
  text: `演示文字稿第 ${i + 1} 段，用来查看侧栏的排版与滚动。`
}))

// 演示作业的提交记录：a3 已交一次且可撤回；撤回后变草稿，再交覆盖草稿
type DemoSubmission = AssignmentDetail['submissions'][number]
const demoSubmissions = new Map<string, DemoSubmission[]>([
  ['a3', [{ id: 's1', submittedAt: day(-2, 21), comment: '', files: [{ name: '作业7.pdf', url: '' }], canRetract: true }]]
])
const demoDrafts = new Map<string, AssignmentDetail['draft']>()

export function demoDetail(activityId: string): AssignmentDetail {
  const a = mockAssignments.find((x) => x.id === activityId) ?? mockAssignments[0]
  return {
    ...a,
    descriptionHtml: '<p>演示作业</p>',
    attachments: [],
    submissions: demoSubmissions.get(a.id) ?? [],
    draft: demoDrafts.get(a.id) ?? null,
    url: ''
  }
}

export function demoSubmit(activityId: string, comment: string, files: PickedFile[]): void {
  demoDrafts.delete(activityId)
  const list = demoSubmissions.get(activityId) ?? []
  list.unshift({ id: `s${Date.now()}`, submittedAt: new Date().toISOString(), comment, files: files.map((f) => ({ name: f.name, url: '' })), canRetract: true })
  demoSubmissions.set(activityId, list)
}

export function demoRetract(submissionId: string): void {
  for (const [activityId, list] of demoSubmissions) {
    const i = list.findIndex((s) => s.id === submissionId)
    if (i < 0) continue
    const [s] = list.splice(i, 1)
    demoDrafts.set(activityId, { id: s.id, comment: s.comment, files: s.files })
    return
  }
  throw new Error('未找到该提交')
}

export const demoPta: PtaState = { enabled: true, loggedIn: true, user: '演示用户' }

// 毕业自审演示：几个必修 / 选修模块与课程，覆盖通过、在修、被替代、不通过、未修各种状态
const course = (id: string, parentId: string, name: string, code: string, credits: number, status: AuditNode['status'], grade?: string, note?: string): AuditNode =>
  ({ id, parentId, name, code, credits, status, grade, note })

export const mockGraduation: GraduationAudit = {
  nodes: [
    { id: 'm0', parentId: null, name: '毕业总学分', status: 'none', requiredCredits: '160+8', earnedCredits: '118.5+4' },
    { id: 'm1', parentId: null, name: '通识必修课程', kind: '必修课程', status: 'none', requiredCredits: '33', earnedCredits: '25', requiredCourses: '10', completedCourses: '7' },
    course('c11', 'm1', '思想道德与法治', '551E0010', 3, 'passed', '91'),
    course('c12', 'm1', '中国近现代史纲要', '551E0020', 3, 'studying'),
    course('c13', 'm1', '马克思主义基本原理', '551E0030', 3, 'none'),
    course('c14', 'm1', '毛泽东思想和中国特色社会主义理论体系概论', '551E0040', 5, 'none'),
    course('c15', 'm1', '形势与政策Ⅰ', '551E0050', 1, 'passed', '合格'),
    course('c16', 'm1', '军事理论', '031E0010', 2, 'passed', '85'),
    course('c17', 'm1', '大学英语Ⅲ', '051F0020', 3, 'passed', '88'),
    course('c18', 'm1', '大学英语Ⅳ', '051F0030', 3, 'replaced', undefined, '个人替换：英语水平测试'),
    course('c19', 'm1', '体育Ⅰ', '401E0010', 1, 'passed', '92'),
    course('c1a', 'm1', '体育Ⅱ', '401E0020', 1, 'passed', '90'),
    { id: 'm2', parentId: null, name: '专业基础课程', kind: '必修课程', status: 'none', requiredCredits: '30', earnedCredits: '17.5', requiredCourses: '8', completedCourses: '4' },
    course('c21', 'm2', '数学分析（甲）Ⅰ', '821T0150', 5, 'passed', '88'),
    course('c22', 'm2', '数学分析（甲）Ⅱ', '821T0160', 5, 'studying'),
    course('c23', 'm2', '线性代数（甲）', '821T0170', 3.5, 'passed', '93'),
    course('c24', 'm2', '程序设计基础', '211G0200', 3, 'passed', '95'),
    course('c25', 'm2', '大学物理（甲）Ⅰ', '761T0010', 4, 'failed', '52'),
    course('c26', 'm2', '大学物理（甲）Ⅱ', '761T0020', 4, 'none'),
    course('c27', 'm2', '概率论与数理统计', '061B0170', 2.5, 'none'),
    course('c28', 'm2', '工程图学', '101C0070', 2.5, 'passed', '81'),
    { id: 'm3', parentId: null, name: '专业核心课程', kind: '必修课程', status: 'none', requiredCredits: '24', earnedCredits: '0', requiredCourses: '6', completedCourses: '0' },
    course('c31', 'm3', '数据结构基础', '211C0020', 4, 'studying'),
    course('c32', 'm3', '计算机组成', '211C0040', 4, 'none'),
    course('c33', 'm3', '操作系统', '211C0060', 4, 'none'),
    course('c34', 'm3', '计算机网络', '211C0080', 4, 'none'),
    course('c35', 'm3', '数据库系统', '211C0100', 4, 'none'),
    course('c36', 'm3', '编译原理', '211C0120', 4, 'none'),
    { id: 'm4', parentId: null, name: '劳动教育', kind: '必修课程', status: 'none', requiredCredits: '1', earnedCredits: '0' },
    course('c41', 'm4', '劳动教育', '031E0030', 1, 'none'),
    { id: 'm5', parentId: null, name: '通识选修课程', kind: '选修课程', status: 'failed', requiredCredits: '12', earnedCredits: '10' },
    { id: 'm51', parentId: 'm5', name: '美育类', kind: '选修课程', status: 'passed', requiredCredits: '1', earnedCredits: '1.5' },
    { id: 'm52', parentId: 'm5', name: '科学研究与创新创业类', kind: '选修课程', status: 'failed', requiredCredits: '2', earnedCredits: '0' },
    { id: 'm53', parentId: 'm5', name: '至少修读1门“博雅技艺”类课程', kind: '选修课程', status: 'none', requiredCourses: '1', completedCourses: '0' },
    { id: 'm6', parentId: null, name: '个性修读课程', kind: '选修课程', status: 'none', requiredCredits: '15', earnedCredits: '0' },
    { id: 'm61', parentId: 'm6', name: '学生自主修读模块', kind: '选修课程', status: 'none', requiredCredits: '15', earnedCredits: '0' },
    { id: 'm62', parentId: 'm61', name: '跨专业课程至少1门', kind: '选修课程', status: 'none', requiredCourses: '1', completedCourses: '0' },
    { id: 'm7', parentId: null, name: '形势与政策', kind: '必修课程', status: 'passed', requiredCredits: '2', earnedCredits: '2' },
    course('c71', 'm7', '形势与政策Ⅰ', '551E0070', 1, 'passed', '优秀'),
    course('c72', 'm7', '形势与政策Ⅱ', '551E0080', 1, 'passed', '良好')
  ],
  classrooms: {
    second: { points: 6.5, credits: 2, grade: '优秀', passed: true },
    third: { points: 4, credits: 1, grade: '良好', passed: true },
    fourth: { points: 0, credits: 0, grade: null, passed: false }
  },
  aesthetic: { passed: true, points: 1.2, earnedCredits: '1.5', requiredCredits: '1' },
  labor: { passed: false, points: 0.6, earnedCredits: '0', requiredCredits: '1' },
  records: [
    { id: 'r1', name: '新生入学教育', classroom: 'second', status: 'done', statusLabel: '审核通过', category: '思想成长', points: 1, time: '2025-09-12T02:00:00.000Z', aesthetic: false, labor: false },
    { id: 'r2', name: '校园十佳歌手大赛观众', classroom: 'second', status: 'done', statusLabel: '审核通过', category: '文体活动', type: '美育', points: 0.5, time: '2025-11-03T11:00:00.000Z', aesthetic: true, labor: false },
    { id: 'r3', name: '紫金港校区志愿清扫', classroom: 'second', status: 'done', statusLabel: '审核通过', category: '志愿公益', type: '劳育', points: 0.6, time: '2026-03-20T06:00:00.000Z', aesthetic: false, labor: true },
    { id: 'r4', name: '学术讲座：大模型与科学发现', classroom: 'second', status: 'pending', statusLabel: '待审核', category: '学术科创', points: 0.5, time: '2026-10-25T07:00:00.000Z', aesthetic: false, labor: false },
    { id: 'r5', name: '书画社作品展', classroom: 'second', status: 'rejected', statusLabel: '审核不通过', category: '文体活动', type: '美育', points: 0.5, time: '2026-05-18T08:00:00.000Z', aesthetic: true, labor: false },
    { id: 'r6', name: '暑期社会实践：乡村振兴调研', classroom: 'third', status: 'done', statusLabel: '审核通过', category: '社会实践', points: 3, time: '2026-08-30T02:00:00.000Z', aesthetic: false, labor: false },
    { id: 'r7', name: '国际交流夏令营', classroom: 'third', status: 'done', statusLabel: '审核通过', category: '国际交流', points: 1, time: '2026-07-15T02:00:00.000Z', aesthetic: false, labor: false },
    { id: 'r8', name: '寒假返乡调研', classroom: 'third', status: 'pending', statusLabel: '待审核', category: '社会实践', points: 1, time: '2026-10-28T02:00:00.000Z', aesthetic: false, labor: false }
  ]
}
