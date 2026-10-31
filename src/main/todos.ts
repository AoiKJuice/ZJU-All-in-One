import { app, BrowserWindow, Notification } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OPEN_EVENT } from '@shared/ipc'
import type { Assignment, OpenRequest, TodoState } from '@shared/types'
import { call } from './ipc'
import { logDiagnostic } from './diagnostics'

// 待办的本地状态（userData/todos.json）：忽略的条目在主页隐藏、不提醒；
// 开启提醒后，未完成的待办在截止前 3 小时弹一次 Windows 通知，点通知打开作业侧页。

const LEAD = 3 * 60 * 60_000
// 每半小时重取一次待办，期间到点的用定时器准时提醒
const POLL = 30 * 60_000

interface Stored extends TodoState {
  /** 已提醒过的 `<id>@<截止时间>`：截止时间改了会再提醒 */
  reminded: string[]
}

const path = (): string => join(app.getPath('userData'), 'todos.json')

let stored: Stored | undefined

function load(): Stored {
  stored ??= existsSync(path())
    ? { ignored: [], remind: false, reminded: [], ...(JSON.parse(readFileSync(path(), 'utf8')) as Partial<Stored>) }
    : { ignored: [], remind: false, reminded: [] }
  return stored
}

const save = (): Promise<void> => writeFile(path(), JSON.stringify(load()))

export function getTodoState(): TodoState {
  const { ignored, remind } = load()
  return { ignored, remind }
}

export async function setIgnored(id: string, ignored: boolean): Promise<TodoState> {
  const s = load()
  s.ignored = ignored ? [...new Set([...s.ignored, id])] : s.ignored.filter((x) => x !== id)
  await save()
  schedule()
  return getTodoState()
}

export async function setRemind(on: boolean): Promise<TodoState> {
  load().remind = on
  await save()
  restart()
  return getTodoState()
}

const key = (a: Assignment): string => `${a.id}@${a.deadline}`
const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' })

let latest: Assignment[] = []
let timers: NodeJS.Timeout[] = []
let poller: NodeJS.Timeout | undefined

function notify(a: Assignment): void {
  const s = load()
  s.reminded = [...s.reminded, key(a)]
  void save()
  const n = new Notification({ title: a.title, body: `${a.courseName}　${clock(a.deadline)} 截止` })
  n.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send(OPEN_EVENT, { assignment: a } satisfies OpenRequest)
  })
  n.show()
}

/** 按最近一次取到的待办重排定时器：已进入 3 小时内的立即提醒，之后才进入的到点提醒 */
function schedule(): void {
  timers.forEach(clearTimeout)
  timers = []
  const s = load()
  if (!s.remind) return
  const now = Date.now()
  const ignored = new Set(s.ignored)
  const reminded = new Set(s.reminded)
  for (const a of latest) {
    const deadline = Date.parse(a.deadline)
    if (a.submitted || ignored.has(a.id) || reminded.has(key(a)) || deadline <= now) continue
    const wait = deadline - LEAD - now
    if (wait <= 0) notify(a)
    else if (wait < POLL * 2) timers.push(setTimeout(() => notify(a), wait))
  }
}

async function poll(): Promise<void> {
  try {
    latest = (await call('data:assignments')).data
    // 截止已过的提醒记录不再需要
    const s = load()
    const live = new Set(latest.map(key))
    s.reminded = s.reminded.filter((k) => live.has(k))
    schedule()
  } catch (error) {
    logDiagnostic('todo-poll', { message: error instanceof Error ? error.message : String(error) })
  }
}

function restart(): void {
  clearInterval(poller)
  poller = undefined
  timers.forEach(clearTimeout)
  timers = []
  if (!load().remind) return
  void poll()
  poller = setInterval(() => void poll(), POLL)
}

export function initTodos(): void {
  // 通知归属到安装包的应用身份（与 electron-builder 的 appId 一致）
  app.setAppUserModelId('top.aoikjuice.zju-all-in-one')
  // 启动时先等登录态恢复再取
  setTimeout(restart, 60_000)
}
