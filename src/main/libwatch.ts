import { BrowserWindow, Notification } from 'electron'
import { randomUUID } from 'node:crypto'
import { OPEN_EVENT } from '@shared/ipc'
import type { OpenRequest } from '@shared/types'
import { areasIn, type LibPreset, type LibPresetInput, type LibWatch, type LibWatchInput } from '@shared/library'
import { call } from './ipc'
import { readConfig, writeConfig } from './secure'
import { logDiagnostic } from './diagnostics'

// 图书馆订阅（userData/lib-watch.json，只在桌面端）：订阅＝正在查询余座的一项，停止就从列表里去掉。
// 手动开始的（不带时段）开始后一直查，过了当天自动结束；每天定时的只在设定时段里查，不在时段内时睡到下一个时段开始（最多 30 分钟醒一次）。
// 一次 quickSelect 就拿到全部区域，所有订阅共用；间隔 45–90 秒随机。范围内由满座变出空座时弹通知；
// auto 为用户在应用内确认后授权的自动预约：挑空座最多的区域、当天最早还没结束的时段、第一个空座提交一次，
// 约上后这一项结束，并关掉其余订阅的自动预约（系统一天一般只许一个座位预约，用户确认：只关自动，不取消已约的座位）；
// 失败不重试，关掉自动只通知。被别处登录顶掉时不重登（quiet），歇 10 分钟再查，免得和用户手机上的网页互相顶。

const FILE = 'lib-watch.json'
const MIN = 45_000
const SPAN = 45_000

let watches: LibWatch[] | undefined
let timer: NodeJS.Timeout | undefined

const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const scheduled = (w: Pick<LibWatch, 'from' | 'to'>): w is { from: string; to: string } => Boolean(w.from && w.to)

/** 读出时去掉过了当天的手动订阅（旧版存下的已停止 / 已完成项也一并清掉） */
const load = (): LibWatch[] =>
  (watches ??= (readConfig<(LibWatch & { done?: string; paused?: boolean })[]>(FILE) ?? []).filter((w) => !w.done && !w.paused))
const save = (): Promise<void> => writeConfig(FILE, load())

function expire(): boolean {
  const day = today()
  const keep = load().filter((w) => scheduled(w) || !w.day || w.day === day)
  if (keep.length === load().length) return false
  watches = keep
  return true
}

export const getLibWatches = (): LibWatch[] => {
  if (expire()) void save()
  return load()
}

export async function saveLibWatch(input: LibWatchInput): Promise<LibWatch[]> {
  const old = input.id ? load().find((w) => w.id === input.id) : undefined
  const timed = scheduled(input)
  const next: LibWatch = {
    id: input.id ?? randomUUID(),
    ...((input.name ?? old?.name) ? { name: input.name ?? old?.name } : {}),
    scopes: input.scopes,
    ...(timed ? { from: input.from, to: input.to } : { day: today() }),
    auto: input.auto,
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

// 套餐（userData/lib-presets.json）：存下的范围与可选的定时时段，界面与 MCP 一键据此开始订阅
const PRESETS = 'lib-presets.json'
let presets: LibPreset[] | undefined

const loadPresets = (): LibPreset[] => (presets ??= readConfig<LibPreset[]>(PRESETS) ?? [])

export const getLibPresets = (): LibPreset[] => loadPresets()

export async function saveLibPreset(input: LibPresetInput): Promise<LibPreset[]> {
  const { from, to, ...rest } = input
  const next: LibPreset = { ...rest, ...(from && to ? { from, to } : {}), id: input.id ?? randomUUID() }
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

/** 现在是否该查：手动的一直查；定时的只在时段内（可跨零点，22:00–01:00） */
export function inWindow(w: Pick<LibWatch, 'from' | 'to'>, minutes: number): boolean {
  if (!scheduled(w)) return true
  const from = toMinutes(w.from)
  const to = toMinutes(w.to)
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to
}

/** 距最近一个定时时段开始还有多少毫秒 */
function untilNext(list: LibWatch[], minutes: number): number {
  const waits = list.filter(scheduled).map((w) => (toMinutes(w.from ?? '00:00') - minutes + 1440) % 1440 || 1440)
  return Math.min(...waits) * 60_000
}

const scopeLabel = (w: LibWatch): string => w.name ?? w.scopes.map((s) => s.label).join('　')

/** 自动预约一次；约上返回 true（这一项随后结束） */
async function autoReserve(w: LibWatch, candidates: { id: string; free: number; label: string }[]): Promise<boolean> {
  const target = [...candidates].sort((a, b) => b.free - a.free)[0]
  if (!target) return false
  const { hm } = clock()
  const segment = (await call('lib:segments', target.id)).find((s) => s.day === today() && s.end > hm)
  const seat = segment && (await call('lib:seats', target.id, segment)).find((s) => s.state === 'free')
  if (!segment || !seat) return false
  const result = await call('lib:reserve', target.id, seat.id, segment)
  logDiagnostic('lib-auto-reserve', { status: result.status })
  if (result.status === 'saved') {
    for (const other of load()) other.auto = false
    notify('已自动预约', `${target.label} ${seat.name}号　${segment.start}–${segment.end}`)
    return true
  }
  w.auto = false
  notify(result.status === 'rejected' ? '自动预约被拒' : '自动预约结果未知', `${target.label}　${result.message}`)
  return false
}

async function poll(): Promise<void> {
  expire()
  const { minutes } = clock()
  const due = load().filter((w) => inWindow(w, minutes))
  const finished = new Set<string>()
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
          if (await autoReserve(w, areas.filter((a) => a.area.free).map((a) => ({ id: a.area.id, free: a.area.free ?? 0, label: a.label })))) finished.add(w.id)
        } else if (before === 0) {
          notify('有空座', `${scopeLabel(w)}　余 ${w.free}`)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logDiagnostic('lib-watch', { message })
      if (/其他设备|别的设备/.test(message)) pause = 10 * 60_000
    }
  }
  if (finished.size) watches = load().filter((w) => !finished.has(w.id))
  await save()
  schedule(pause || undefined)
}

function schedule(delay?: number): void {
  clearTimeout(timer)
  const list = load()
  if (!list.length) return
  const { minutes } = clock()
  const wait = delay ?? (list.some((w) => inWindow(w, minutes)) ? MIN + Math.random() * SPAN : Math.min(untilNext(list, minutes), 30 * 60_000))
  timer = setTimeout(() => void poll(), wait)
}

export function initLibWatch(): void {
  schedule(60_000)
}
