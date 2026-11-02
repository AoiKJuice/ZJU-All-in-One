import { BrowserWindow, Notification } from 'electron'
import { OPEN_EVENT } from '@shared/ipc'
import type { OpenRequest } from '@shared/types'
import type { XkCourse, XkSection, XkWatch } from '@shared/xk'
import { call } from './ipc'
import { readConfig, writeConfig } from './secure'
import { logDiagnostic } from './diagnostics'

// 选课订阅（userData/xk-watch.json，只在桌面端）：定时查订阅教学班的余量，有余量时弹通知；
// auto 为用户在应用内确认后授权的自动提交，选上后停止该订阅，总学分超过 22 时停掉所有自动提交（低定规则）。
// 低定期间退课余量在 18:00–24:00 随机释放，所以这段时间每 20–40 秒查一次，其余时间每 5 分钟一次。
// 写请求不重发：被拒或结果不明时关掉自动提交，只通知，留给用户查看已选。

const FILE = 'xk-watch.json'

let watches: XkWatch[] | undefined
let timer: NodeJS.Timeout | undefined

const load = (): XkWatch[] => (watches ??= readConfig<XkWatch[]>(FILE) ?? [])
const save = (): Promise<void> => writeConfig(FILE, load())

export const getWatches = (): XkWatch[] => load()

export async function addWatch(course: XkCourse, section: XkSection, auto: boolean): Promise<XkWatch[]> {
  watches = [
    ...load().filter((w) => w.section.id !== section.id),
    { course, section, auto, remaining: section.remaining, checkedAt: null }
  ]
  await save()
  schedule(1000)
  return watches
}

export async function removeWatch(sectionId: string): Promise<XkWatch[]> {
  watches = load().filter((w) => w.section.id !== sectionId)
  await save()
  return watches
}

// 点通知打开选课工具
function notify(title: string, body: string): void {
  const n = new Notification({ title, body })
  n.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send(OPEN_EVENT, { tool: 'course' } satisfies OpenRequest)
  })
  n.show()
}

const label = (w: XkWatch): string => `${w.section.courseName || w.course.name}　${w.section.teachers.join(' ')}`

async function check(w: XkWatch): Promise<void> {
  const now = (await call('xk:sections', w.course)).find((s) => s.id === w.section.id)
  const before = w.remaining ?? 0
  w.remaining = now?.remaining ?? null
  w.checkedAt = Date.now()
  if (!now?.remaining) return
  if (!w.auto) {
    if (before === 0) notify('有余量', label(w))
    return
  }
  const result = await call('xk:select', now)
  logDiagnostic('xk-auto-select', { status: result.status })
  if (result.status === 'saved' || result.status === 'already') {
    w.done = '已提交'
    notify('已自动选课', label(w))
    const credits = (await call('xk:context')).credits
    if (credits && credits.total > 22) {
      for (const other of load()) other.auto = false
      notify('已超过 22 学分', '自动选课已全部停止')
    }
  } else {
    w.auto = false
    notify(result.status === 'rejected' ? '自动选课被拒' : '自动选课结果未知', `${label(w)}　${result.message}`)
  }
}

function interval(): number {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' }).format(new Date())
  )
  return hour >= 18 ? 20_000 + Math.random() * 20_000 : 5 * 60_000
}

function schedule(delay = interval()): void {
  clearTimeout(timer)
  if (!load().some((w) => !w.done)) return
  timer = setTimeout(() => void poll(), delay)
}

async function poll(): Promise<void> {
  // 逐个查，不同时给教务发一串请求
  for (const w of load().filter((x) => !x.done)) {
    try {
      await check(w)
    } catch (error) {
      logDiagnostic('xk-watch', { message: error instanceof Error ? error.message : String(error) })
    }
  }
  await save()
  schedule()
}

export function initXkWatch(): void {
  schedule(60_000)
}
