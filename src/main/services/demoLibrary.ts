import type { LibArea, LibBooking, LibOverview, LibSeat, LibSegment, LibWriteResult } from '@shared/library'
import { today } from './library'
import type { LibraryCoreHandlers } from './libraryApi'

// 图书馆预约演示数据（馆名、楼层、区域全部虚构，由 DeepSeek 编造）：余座每两分钟变一次，有的区域满座，
// 便于看订阅提醒；预约与取消只记在内存里，不连预约系统

type Raw = [string, [string, [string, number][]][]][]

const RAW: Raw = [
  ['启明图书馆', [
    ['负一层', [['自习区', 120], ['电子阅览', 48], ['静音区', 36]]],
    ['2F', [['东区阅览', 150], ['窗边长桌', 42], ['研讨区', 64]]],
    ['3F', [['西区阅览', 138], ['小组研讨', 54], ['休闲阅读', 60]]]
  ]],
  ['北山主图书馆', [
    ['2F', [['新书展区', 160], ['开放阅览', 72], ['南区自习', 90]]],
    ['3F', [['人文阅览', 156], ['静音自习', 84], ['期刊阅览', 66]]],
    ['4F', [['理工阅览', 145], ['电子阅览', 52], ['研讨区外侧', 58]]],
    ['5F', [['特藏阅览', 46], ['研习间', 28], ['共享自习', 112]]]
  ]],
  ['农医分馆', [
    ['负一层', [['备考专区', 72], ['静音区', 40], ['电子阅览', 56]]],
    ['2F', [['农学阅览', 96], ['医学阅览', 108], ['窗边长桌', 36]]],
    ['3F', [['研讨区', 60], ['休闲阅读', 48], ['小组自习', 82]]],
    ['4F', [['期刊阅览', 66], ['数据检索', 48], ['静音长桌', 32]]]
  ]],
  ['云溪图书馆', [
    ['2F', [['东区阅览', 128], ['沙发座', 30], ['新书阅览', 74]]],
    ['3F', [['西区阅览', 124], ['电子阅览', 44], ['研讨区', 58]]],
    ['4F', [['静音自习', 92], ['窗边长桌', 38], ['专题阅览', 64]]]
  ]]
]

const AREAS = RAW.flatMap(([, floors], b) =>
  floors.flatMap(([, areas], f) => areas.map(([name, total], a) => ({ id: `${b + 1}${f + 1}${a + 1}`, name, total, building: b, floor: f })))
)

/** 小的确定性散列：同一区域同一时段的余座稳定，两分钟换一次 */
const hash = (s: string): number => {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0) / 2 ** 32
}

const bookings: LibBooking[] = []
const taken = new Set<string>()
/** 预约 id → 占的座位（taken 里的键） */
const seatOf = new Map<string, string>()

function freeOf(id: string, total: number, date: string): number {
  const r = hash(`${id}|${date}|${Math.floor(Date.now() / 120_000)}`)
  // 三成区域满座，其余剩一到四成
  const base = r < 0.3 ? 0 : Math.round(total * (0.1 + (r - 0.3) * 0.45))
  return Math.max(0, base - [...taken].filter((k) => k.startsWith(`${id}|`)).length)
}

const sum = (list: LibArea[]): Pick<LibArea, 'free' | 'total'> => ({
  free: list.reduce((n, a) => n + (a.free ?? 0), 0),
  total: list.reduce((n, a) => n + (a.total ?? 0), 0)
})

function overview(date = today()): LibOverview {
  const tomorrow = new Date(`${today()}T12:00:00+08:00`)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const dates = [today(), tomorrow.toISOString().slice(0, 10)]
  return {
    date,
    dates,
    buildings: RAW.map(([name, floors], b) => {
      const fl = floors.map(([floorName], f) => {
        const areas = AREAS.filter((a) => a.building === b && a.floor === f).map((a) => ({
          id: a.id,
          name: a.name,
          free: freeOf(a.id, a.total, date),
          total: a.total
        }))
        return { id: `${b + 1}${f + 1}`, name: floorName, ...sum(areas), areas }
      })
      return { id: `${b + 1}`, name, ...sum(fl), floors: fl }
    })
  }
}

function segments(areaId: string): LibSegment[] {
  return overview().dates.map((day) => ({ id: `${areaId}-${day}`, day, start: '08:00', end: '22:30' }))
}

function seats(areaId: string, segment: LibSegment): LibSeat[] {
  const area = AREAS.find((a) => a.id === areaId)
  if (!area) return []
  const free = freeOf(area.id, area.total, segment.day)
  // 空座散落在整片区域里
  const order = Array.from({ length: area.total }, (_, i) => i).sort((x, y) => hash(`${areaId}${x}`) - hash(`${areaId}${y}`))
  const open = new Set(order.slice(0, free))
  return Array.from({ length: area.total }, (_, i) => {
    const id = `${areaId}-${i + 1}`
    const state = taken.has(`${areaId}|${id}`) ? 'busy' : open.has(i) ? 'free' : hash(id) < 0.08 ? 'away' : 'busy'
    return { id, name: String(i + 1).padStart(3, '0'), state }
  })
}

function place(areaId: string, seatName: string): string {
  const a = AREAS.find((x) => x.id === areaId)
  if (!a) return seatName
  const [building, floors] = RAW[a.building]
  return `${building} ${floors[a.floor][0]} ${a.name} ${seatName}号`
}

async function reserve(areaId: string, seatId: string, segment: LibSegment): Promise<LibWriteResult> {
  await new Promise((r) => setTimeout(r, 600))
  if (bookings.some((b) => b.canCancel && b.begin.startsWith(segment.day))) return { status: 'rejected', message: '当天已有预约' }
  const seat = seats(areaId, segment).find((s) => s.id === seatId)
  if (seat?.state !== 'free') return { status: 'rejected', message: '该座位已被预约' }
  const id = `demo-${Date.now()}`
  taken.add(`${areaId}|${seatId}`)
  seatOf.set(id, `${areaId}|${seatId}`)
  bookings.unshift({
    id,
    place: place(areaId, seat.name),
    begin: `${segment.day} ${segment.start}`,
    end: `${segment.day} ${segment.end}`,
    status: '待签到',
    canCancel: true
  })
  return { status: 'saved', message: '' }
}

async function cancel(id: string): Promise<LibWriteResult> {
  await new Promise((r) => setTimeout(r, 400))
  const b = bookings.find((x) => x.id === id)
  if (!b?.canCancel) return { status: 'rejected', message: '该预约不能取消' }
  Object.assign(b, { status: '已取消', canCancel: false })
  taken.delete(seatOf.get(id) ?? '')
  return { status: 'saved', message: '' }
}

export const demoLibrary: LibraryCoreHandlers = {
  'lib:overview': async (date) => overview(date),
  'lib:segments': async (areaId) => segments(areaId),
  'lib:seats': async (areaId, segment) => seats(areaId, segment),
  'lib:reserve': reserve,
  'lib:bookings': async () => bookings.map((b) => ({ ...b })),
  'lib:cancel': cancel
}
