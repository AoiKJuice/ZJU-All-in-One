import { LocalNotifications } from '@capacitor/local-notifications'
import type { Assignment, OpenRequest, TodoState } from '@shared/types'

// 安卓端的 src/main/todos.ts：忽略与提醒开关存 localStorage；提醒交给系统闹钟（LocalNotifications 预约），
// 应用不在前台也会到点弹出。每次取到待办就按最新截止时间重排；已进入 3 小时内的立即提醒一次

const LEAD = 3 * 60 * 60_000
const KEY = 'todos'

interface Stored extends TodoState {
  /** 已提醒过的 `<id>@<截止时间>` */
  reminded: string[]
  /** 已预约的 `<id>@<截止时间>` → 提醒时刻；时刻过了就算提醒过 */
  scheduled: Record<string, number>
}

let stored: Stored | undefined
let latest: Assignment[] = []

function load(): Stored {
  stored ??= { ignored: [], remind: false, reminded: [], scheduled: {}, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Stored>) }
  return stored
}

const save = (): void => localStorage.setItem(KEY, JSON.stringify(load()))
const key = (a: Assignment): string => `${a.id}@${a.deadline}`
const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' })

// 通知 id 须为 32 位整数：由键散列得到
const notificationId = (k: string): number => {
  let h = 0
  for (const ch of k) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0
  return Math.abs(h) || 1
}

export function getTodoState(): TodoState {
  const { ignored, remind } = load()
  return { ignored, remind }
}

export async function setIgnored(id: string, ignored: boolean): Promise<TodoState> {
  const s = load()
  s.ignored = ignored ? [...new Set([...s.ignored, id])] : s.ignored.filter((x) => x !== id)
  save()
  await schedule()
  return getTodoState()
}

export async function setRemind(on: boolean): Promise<TodoState> {
  if (on) {
    const { display } = await LocalNotifications.requestPermissions()
    if (display !== 'granted') throw new Error('未允许通知')
  }
  load().remind = on
  save()
  await schedule()
  return getTodoState()
}

/** 每次取到待办后调用 */
export async function updateAssignments(list: Assignment[]): Promise<void> {
  latest = list
  const s = load()
  const live = new Set(list.map(key))
  s.reminded = s.reminded.filter((k) => live.has(k))
  await schedule()
}

async function schedule(): Promise<void> {
  const s = load()
  const now = Date.now()
  for (const [k, at] of Object.entries(s.scheduled)) if (at <= now) s.reminded.push(k)
  const { notifications: pending } = await LocalNotifications.getPending()
  if (pending.length) await LocalNotifications.cancel({ notifications: pending.map(({ id }) => ({ id })) })
  s.scheduled = {}
  if (s.remind) {
    const ignored = new Set(s.ignored)
    const reminded = new Set(s.reminded)
    const notifications = latest
      .filter((a) => !a.submitted && !ignored.has(a.id) && !reminded.has(key(a)) && Date.parse(a.deadline) > now)
      .map((a) => {
        const at = Math.max(Date.parse(a.deadline) - LEAD, now + 1000)
        s.scheduled[key(a)] = at
        return {
          id: notificationId(key(a)),
          title: a.title,
          body: `${a.courseName}　${clock(a.deadline)} 截止`,
          schedule: { at: new Date(at), allowWhileIdle: true },
          extra: { assignment: a }
        }
      })
    if (notifications.length) await LocalNotifications.schedule({ notifications })
  }
  save()
}

/** 点通知打开作业侧页 */
export function onReminderTap(listener: (request: OpenRequest) => void): void {
  void LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const a = (notification.extra as { assignment?: Assignment } | undefined)?.assignment
    if (a) listener({ assignment: a })
  })
}
