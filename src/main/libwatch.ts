import { BrowserWindow, Notification } from 'electron'
import { randomUUID } from 'node:crypto'
import { OPEN_EVENT } from '@shared/ipc'
import type { OpenRequest } from '@shared/types'
import { areasIn, type LibPreset, type LibPresetInput, type LibWatch, type LibWatchInput } from '@shared/library'
import { call } from './ipc'
import { readConfig, writeConfig } from './secure'
import { logDiagnostic } from './diagnostics'

// 图书馆余座订阅（userData/lib-watch.json，只在桌面端）：每天只在订阅设定的时段里查当天余座，
// 一次 quickSelect 就拿到全部区域，所有订阅共用；间隔 45–90 秒随机，不在时段内时睡到下一个时段开始（最多 30 分钟醒一次）。
// 范围内由满座变出空座时弹通知；auto 为用户在应用内确认后授权的自动预约：挑空座最多的区域、当天最早还没结束的时段、
// 第一个空座提交一次，约上即停（并停掉其余自动预约，系统一天一般只许一个座位预约），失败不重试，关掉自动只通知。
// 被别处登录顶掉时不重登（quiet），歇 10 分钟再查，免得和用户手机上的网页互相顶。

const FILE = 'lib-watch.json'
const MIN = 45_000
const SPAN = 45_000

let watches: LibWatch[] | undefined
let timer: NodeJS.Timeout | undefined

const load = (): LibWatch[] => (watches ??= readConfig<LibWatch[]>(FILE) ?? [])
const save = (): Promise<void> => writeConfig(FILE, load())

export const getLibWatches = (): LibWatch[] => load()

export async function saveLibWatch(input: LibWatchInput): Promise<LibWatch[]> {
  const old = input.id ? load().find((w) => w.id === input.id) : undefined
  const next: LibWatch = {
    id: input.id ?? randomUUID(),
    ...((input.name ?? old?.name) ? { name: input.name ?? old?.name } : {}),
    scopes: input.scopes,
    from: input.from,
    to: input.to,
    auto: input.auto,
    ...(input.paused ? { paused: true } : {}),
    free: old?.free ?? null,
    checkedAt: old?.checkedAt ?? null
  }
  watches = old ? load().map((w) => (w.id === old.id ? next : w)) : [...load(), next]
  await save()
  schedule(1000)
  return watches
}

export async function removeLibWatch(id: string): Promise<LibWatch[]> {
  watches = load().filter((w) => w.id !== id)
  await save()
  schedule()
  return watches
}

// 套餐（userData/lib-presets.json）：存下的范围与时段，界面与 MCP 一键据此订阅
const PRESETS = 'lib-presets.json'
let presets: LibPreset[] | undefined

const loadPresets = (): LibPreset[] => (presets ??= readConfig<LibPreset[]>(PRESETS) ?? [])

export const getLibPresets = (): LibPreset[] => loadPresets()

export async function saveLibPreset(input: LibPresetInput): Promise<LibPreset[]> {
  const next: LibPreset = { ...input, id: input.id ?? randomUUID() }
  presets = loadPresets().some((p) => p.id === next.id) ? loadPresets().map((p) => (p.id === next.id ? next : p)) : [...loadPresets(), next]
  await writeConfig(PRESETS, presets)
  return presets
}

export async function removeLibPreset(id: string): Promise<LibPreset[]> {
  presets = loadPresets().filter((p) => p.id !== id)
  await writeConfig(PRESETS, presets)
  return presets
}

// 点通知打开图书馆预约工具
function notify(title: string, body: string): void {
  const n = new Notification({ title, body })
  n.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send(OPEN_EVENT, { tool: 'library' } satisfies OpenRequest)
  })
  n.show()
}

/** 北京时间的 HH:MM 与分钟数 */
function clock(): { hm: string; minutes: number } {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
  return { hm, minutes: toMinutes(hm) }
}

const toMinutes = (hm: string): number => {
  const [h, m] = hm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** 时段可跨零点（22:00–01:00） */
export function inWindow(w: Pick<LibWatch, 'from' | 'to'>, minutes: number): boolean {
  const from = toMinutes(w.from)
  const to = toMinutes(w.to)
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to
}

/** 距最近一个时段开始还有多少毫秒 */
function untilNext(active: LibWatch[], minutes: number): number {
  const waits = active.map((w) => (toMinutes(w.from) - minutes + 1440) % 1440 || 1440)
  return Math.min(...waits) * 60_000
}

const scopeLabel = (w: LibWatch): string => w.name ?? w.scopes.map((s) => s.label).join('　')

async function autoReserve(w: LibWatch, candidates: { id: string; free: number; label: string }[]): Promise<void> {
  const target = [...candidates].sort((a, b) => b.free - a.free)[0]
  if (!target) return
  const { hm } = clock()
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const segment = (await call('lib:segments', target.id)).find((s) => s.day === day && s.end > hm)
  const seat = segment && (await call('lib:seats', target.id, segment)).find((s) => s.state === 'free')
  if (!segment || !seat) return
  const result = await call('lib:reserve', target.id, seat.id, segment)
  logDiagnostic('lib-auto-reserve', { status: result.status })
  if (result.status === 'saved') {
    for (const other of load()) other.auto = false
    w.done = '已预约'
    notify('已自动预约', `${target.label} ${seat.name}号　${segment.start}–${segment.end}`)
  } else {
    w.auto = false
    notify(result.status === 'rejected' ? '自动预约被拒' : '自动预约结果未知', `${target.label}　${result.message}`)
  }
}

async function poll(): Promise<void> {
  const { minutes } = clock()
  const due = load().filter((w) => !w.done && !w.paused && inWindow(w, minutes))
  let pause = 0
  if (due.length) {
    try {
      const overview = await call('lib:overview', undefined, true)
      for (const w of due) {
        const areas = areasIn(overview, w.scopes)
        const before = w.free ?? 0
        w.free = areas.reduce((n, a) => n + (a.area.free ?? 0), 0)
        w.checkedAt = Date.now()
        if (!w.free) continue
        if (w.auto) {
          await autoReserve(w, areas.filter((a) => a.area.free).map((a) => ({ id: a.area.id, free: a.area.free ?? 0, label: a.label })))
        } else if (before === 0) {
          notify('有空座', `${scopeLabel(w)}　余 ${w.free}`)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logDiagnostic('lib-watch', { message })
      if (/其他设备|别的设备/.test(message)) pause = 10 * 60_000
    }
    await save()
  }
  schedule(pause || undefined)
}

function schedule(delay?: number): void {
  clearTimeout(timer)
  const active = load().filter((w) => !w.done && !w.paused)
  if (!active.length) return
  const { minutes } = clock()
  const wait = delay ?? (active.some((w) => inWindow(w, minutes)) ? MIN + Math.random() * SPAN : Math.min(untilNext(active, minutes), 30 * 60_000))
  timer = setTimeout(() => void poll(), wait)
}

export function initLibWatch(): void {
  schedule(60_000)
}
