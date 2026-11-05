import type { LibBooking, LibBuilding, LibFloor, LibOverview, LibSeat, LibSeatState, LibSegment, LibWriteResult } from '@shared/library'
import { ensureCas, zjuFetch } from '../http'

// 图书馆座位预约（booking.lib.zju.edu.cn/h5，浙大图书馆空间预约平台，多校在用的同一套商业系统，前端 AES 的 IV 为 ZZWBKJ_ZHIHUAWEI）。
// 接口事实与出处见 docs/research/library-seat.md。参考的开源实现：richardrren/zju_library_booking_tool（main.py，完整选座流程）、
// 5dbwat4/login-ZJU（src/bookingLib.ts，鉴权细节）、Elyyyyyyyyxer/Elychron（2026-10 真机，单设备登录与"我的预约"字段）、ChenyuHeee/Libot（Seat/seat 字段），
// 另对照了线上 H5 前端（2026-06 构建）与同一系统在同济 / 西建大 / 华东师大的实现。
// - 登录：CAS service 为 https://booking.lib.zju.edu.cn/api/cas/cas（302 到 http 的 zjuam，要升 https），跳回后落到
//   /h5/index.html#/cas/?cas=<一次性码>；POST /api/cas/user {cas} → member.token。之后请求头 authorization: bearer<token>
//  （bearer 与 token 之间没有空格）、lang: zh，前端还在 body 里再放一份 authorization。
//   接口全是 POST + JSON，成功 code 1（quickSelect 为 0），未登录 10001。单设备登录：在别处登录会把这边顶掉，原话照传；
// - 馆 / 层 / 区域余座：POST /reserve/index/quickSelect {id: '1', date} → data.date[] 可约日期、premises[] 馆、
//   storey[]（topId 指馆）层、area[]（parentId 指层）区域，各带 free_num / total_num；
// - 时段：POST /api/Seat/date {build_id: 区域 id} → data[] { day, times[] { id, start, end, status } }，status 1 可约、start 空为暂停；
// - 座位：POST /api/Seat/seat {area, segment, day, startTime, endTime} → data[] { id, no, name, status, in_label }，
//   status 1 空闲 / 7 临时离开 / 2,10,11 已预约 / 6,8,9 使用中 / 3,4,5 关闭，in_label 不为 1 不可选；
// - 预约：POST /api/Seat/confirm {aesjson}，aesjson = AES-128-CBC(PKCS7) 加密的 {"seat_id","segment"}，
//   key = 当天 YYYYMMDD + 其倒序（16 字节），iv = ZZWBKJ_ZHIHUAWEI，结果 base64；
// - 我的预约 POST /api/Member/seat {page, limit}；首页卡片 /api/index/subscribe 的 oksign 1 才可取消，取消 POST /api/Space/cancel {id}。
// 规则（官方 booking_rules）：可约当日与次日 8:30–22:30，每天 7:00 开放次日；每天只能取消一次；生效后 30 分钟内刷卡入馆
// （网页签到入口在浙大关着），否则记违约，3 次冻结一周。
// 以上都未以本应用的登录态实测（推测的字段在 docs 里标出）；预约与取消只能由用户本人验证，调试时一律不调用。

const BASE = 'https://booking.lib.zju.edu.cn'
const SERVICE = `${BASE}/api/cas/cas`
const IV = 'ZZWBKJ_ZHIHUAWEI'

interface Reply<T> {
  code: number | string
  msg?: string
  message?: string
  data?: T
}

type Row = Record<string, unknown>

let token: string | undefined

export function reset(): void {
  token = undefined
}

const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim())
const num = (v: unknown): number | null => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const kicked = (msg: string): boolean => /其他设备|别的设备/.test(msg)

/** 当天（北京时间）YYYY-MM-DD */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
}

async function login(): Promise<string> {
  await ensureCas()
  const landed = await zjuFetch(`https://zjuam.zju.edu.cn/cas/login?service=${encodeURIComponent(SERVICE)}`, { upgradeHttp: true })
  const cas = /[?&]cas=([^&#]+)/.exec(landed.url)?.[1]
  if (!cas) {
    if (new URL(landed.url).hostname === 'zjuam.zju.edu.cn') throw new Error('未登录')
    throw new Error('图书馆登录失败')
  }
  const reply = await (
    await zjuFetch(`${BASE}/api/cas/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', Accept: 'application/json' },
      body: JSON.stringify({ cas })
    })
  ).json<{ member?: { token?: string }; msg?: string }>()
  if (!reply.member?.token) throw new Error(reply.msg || '图书馆登录失败')
  return reply.member.token
}

/**
 * 接口调用。token 失效（10001）时重登一次再试；quiet（后台订阅）遇到"在其他设备登录"不重登，
 * 免得和用户手机上的网页互相顶掉。写请求不重试
 */
async function api<T>(path: string, body: Row, opts: { quiet?: boolean; write?: boolean; ok?: number } = {}): Promise<T | undefined> {
  for (let attempt = 0; ; attempt++) {
    token ??= await login()
    const authorization = `bearer${token}`
    const response = await zjuFetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        lang: 'zh',
        authorization
      },
      body: JSON.stringify({ ...body, authorization })
    })
    const reply = await response.json<Reply<T>>().catch(() => null)
    if (!reply) throw new Error('图书馆接口无响应')
    const code = Number(reply.code)
    const msg = text(reply.msg ?? reply.message)
    if (code === (opts.ok ?? 1)) return reply.data
    if (code === 10001) {
      token = undefined
      if (attempt === 0 && !opts.write && !(opts.quiet && kicked(msg))) continue
    }
    throw new Error(msg || '图书馆接口出错')
  }
}

/** quickSelect 的馆 / 层 / 区域平铺表 → 树 */
export function parseOverview(date: string, data: Row | undefined): LibOverview {
  const list = (key: string): Row[] => (Array.isArray(data?.[key]) ? (data[key] as Row[]) : [])
  const counts = (r: Row) => ({ id: text(r['id']), name: text(r['name']), free: num(r['free_num']), total: num(r['total_num']) })
  const floors = list('storey')
  const areas = list('area')
  const buildings: LibBuilding[] = list('premises').map((b) => ({
    ...counts(b),
    floors: floors
      .filter((f) => text(f['topId']) === text(b['id']))
      .map(
        (f): LibFloor => ({
          ...counts(f),
          areas: areas.filter((a) => text(a['parentId']) === text(f['id'])).map(counts)
        })
      )
  }))
  // 日期项多为字符串，也兼容 { date } / { day }（推测）
  const dates = (Array.isArray(data?.['date']) ? (data['date'] as unknown[]) : [])
    .map((d) => text(typeof d === 'object' && d ? ((d as Row)['date'] ?? (d as Row)['day']) : d))
    .filter(Boolean)
  return { date, dates: dates.length ? dates : [date], buildings }
}

export async function getOverview(date?: string, quiet?: boolean): Promise<LibOverview> {
  const day = date ?? today()
  return parseOverview(day, await api<Row>('/reserve/index/quickSelect', { id: '1', date: day }, { quiet, ok: 0 }))
}

export function parseSegments(data: unknown): LibSegment[] {
  if (!Array.isArray(data)) return []
  return (data as Row[]).flatMap((d) =>
    (Array.isArray(d['times']) ? (d['times'] as Row[]) : [])
      .filter((t) => text(t['start']) && (t['status'] === undefined || text(t['status']) === '1'))
      .map((t) => ({
        id: text(t['id']),
        day: text(d['day']),
        start: text(t['start']).slice(0, 5),
        end: text(t['end']).slice(0, 5)
      }))
  )
}

export async function getSegments(areaId: string, quiet?: boolean): Promise<LibSegment[]> {
  return parseSegments(await api('/api/Seat/date', { build_id: areaId }, { quiet }))
}

/** 照线上前端的座位图：1 空闲 / 7 临时离开 / 3,4,5 关闭，其余为已约或使用中；in_label 不为 1 的不可选 */
export function seatState(status: string, inLabel: unknown): LibSeatState {
  if (inLabel !== undefined && inLabel !== null && text(inLabel) !== '1') return 'closed'
  if (status === '1') return 'free'
  if (status === '7') return 'away'
  if (['3', '4', '5'].includes(status)) return 'closed'
  return 'busy'
}

export function parseSeats(data: unknown): LibSeat[] {
  if (!Array.isArray(data)) return []
  return (data as Row[]).map((s) => ({
    id: text(s['id']),
    name: text(s['no']) || text(s['name']),
    state: seatState(text(s['status']), s['in_label'])
  }))
}

export async function getSeats(areaId: string, segment: LibSegment, quiet?: boolean): Promise<LibSeat[]> {
  return parseSeats(
    await api('/api/Seat/seat', { area: areaId, segment: segment.id, day: segment.day, startTime: segment.start, endTime: segment.end }, { quiet })
  )
}

const bytes = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s)

/** Seat/confirm 的 aesjson：AES-128-CBC（PKCS7）+ base64，key 为当天 YYYYMMDD 加倒序 */
export async function aesjson(payload: Row, day = today()): Promise<string> {
  const d = day.replaceAll('-', '')
  const key = await crypto.subtle.importKey('raw', bytes(d + [...d].reverse().join('')), { name: 'AES-CBC' }, false, ['encrypt'])
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: bytes(IV) }, key, bytes(JSON.stringify(payload))))
  let binary = ''
  for (const b of sealed) binary += String.fromCharCode(b)
  return btoa(binary)
}

async function write(path: string, body: Row): Promise<LibWriteResult> {
  try {
    await api(path, body, { write: true })
    return { status: 'saved', message: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: /无响应|net::|timeout/i.test(message) ? 'unknown' : 'rejected', message }
  }
}

export async function reserve(seatId: string, segment: LibSegment): Promise<LibWriteResult> {
  return write('/api/Seat/confirm', { aesjson: await aesjson({ seat_id: seatId, segment: segment.id }) })
}

export async function cancel(bookingId: string): Promise<LibWriteResult> {
  return write('/api/Space/cancel', { id: bookingId })
}

/** 时间可能是 "2026-11-04 08:00:00" 或秒级时间戳（推测），统一成 YYYY-MM-DD HH:MM */
const when = (v: unknown): string => {
  const raw = text(v)
  if (/^\d{9,10}$/.test(raw)) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(Number(raw) * 1000))
    const p = (type: string) => parts.find((x) => x.type === type)?.value ?? ''
    return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')}`
  }
  return raw.replace('T', ' ').slice(0, 16)
}

/** oksign 取自首页卡片（/api/index/subscribe），没有时按状态文字猜（推测） */
const cancellable = (status: string, oksign: unknown): boolean =>
  oksign !== undefined ? text(oksign) === '1' : /待签到|预约成功|未签到|待使用|已预约/.test(status)

export function parseBookings(data: unknown, oksign: Map<string, unknown> = new Map()): LibBooking[] {
  // 有的版本直接是数组，有的是分页对象 { data: [] }；每条的 timelist 是该预约的小时段，不是另一条预约
  const rows = Array.isArray(data) ? data : Array.isArray((data as Row | undefined)?.['data']) ? ((data as Row)['data'] as unknown[]) : []
  return (rows as Row[]).map((r) => {
    const status = text(r['statusname'] ?? r['status_name'])
    return {
      id: text(r['id']),
      place: text(r['nameMerge'] ?? r['title']),
      begin: when(r['beginTime']),
      end: when(r['endTime']),
      status,
      canCancel: cancellable(status, oksign.get(text(r['id'])))
    }
  })
}

export async function getBookings(): Promise<LibBooking[]> {
  const [records, cards] = await Promise.all([
    api('/api/Member/seat', { page: 1, limit: 20 }),
    api<Row[]>('/api/index/subscribe', {}).catch(() => undefined)
  ])
  // 首页卡片里座位类（type 1）的 oksign 决定能否取消；卡片 id 与记录 id 是否同一个未实测
  const oksign = new Map((Array.isArray(cards) ? cards : []).filter((c) => text(c['type']) === '1').map((c) => [text(c['id']), c['oksign']]))
  return parseBookings(records, oksign)
}
