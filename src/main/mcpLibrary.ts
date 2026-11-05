import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ConfirmRequest, McpToolGroup } from '@shared/types'
import { areasIn, type LibScope, type LibSegment } from '@shared/library'
import { call } from './ipc'

// 图书馆预约的 MCP 工具（由 mcp.ts 的 buildServer 调用）：查询组只读；余座订阅归界面组；
// 预约 / 取消 / 授权自动预约归提交组，一律先经 askUser 让用户在应用内确认

const json = (value: unknown): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }]
})

const read = { readOnlyHint: true, openWorldHint: true }
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }

const segment = z
  .object({ id: z.string(), day: z.string(), start: z.string(), end: z.string() })
  .describe('get_library_segments 返回的一项，原样传回')

const scope = z.object({
  kind: z.enum(['building', 'floor', 'area']).describe('整个馆 / 某一层 / 某个区域'),
  id: z.string().describe('get_library_overview 里对应的 id')
})

const hm = z.string().regex(/^\d{2}:\d{2}$/).describe('HH:MM，北京时间')

/** 给 scope 补上「馆 层 区域」标签，顺带校验 id 存在 */
async function labelScopes(scopes: z.infer<typeof scope>[]): Promise<LibScope[]> {
  const overview = await call('lib:overview')
  return scopes.map((s) => {
    for (const b of overview.buildings) {
      if (s.kind === 'building' && b.id === s.id) return { ...s, label: b.name }
      for (const f of b.floors) {
        if (s.kind === 'floor' && f.id === s.id) return { ...s, label: `${b.name} ${f.name}` }
        const a = f.areas.find((x) => s.kind === 'area' && x.id === s.id)
        if (a) return { ...s, label: `${b.name} ${f.name} ${a.name}` }
      }
    }
    throw new Error(`没有 ${s.kind} ${s.id}`)
  })
}

async function areaLabel(areaId: string): Promise<string> {
  const hit = areasIn(await call('lib:overview'), [{ kind: 'area', id: areaId, label: '' }])[0]
  if (!hit) throw new Error('没有这个区域')
  return hit.label
}

/** 范围与时段：给 preset_id 时取套餐里存的，否则用传入的 */
async function resolveWatch(args: { preset_id?: string; scopes?: z.infer<typeof scope>[]; from?: string; to?: string }): Promise<{ name?: string; scopes: LibScope[]; from?: string; to?: string }> {
  if (Boolean(args.from) !== Boolean(args.to)) throw new Error('from 与 to 要一起给')
  if (args.preset_id) {
    const preset = (await call('lib:presets')).find((p) => p.id === args.preset_id)
    if (!preset) throw new Error('没有这个套餐')
    const from = args.from ?? preset.from
    const to = args.to ?? preset.to
    return { name: preset.name, scopes: preset.scopes, ...(from && to ? { from, to } : {}) }
  }
  if (!args.scopes?.length) throw new Error('需要 preset_id 或 scopes')
  return { scopes: await labelScopes(args.scopes), ...(args.from && args.to ? { from: args.from, to: args.to } : {}) }
}

const windowText = (w: { from?: string; to?: string }): string => (w.from && w.to ? `每天 ${w.from}–${w.to}` : '今天，从现在开始')

const watchInput = {
  preset_id: z.string().optional().describe('list_library_presets 的套餐 id；给了就用套餐里的范围与时段'),
  scopes: z.array(scope).min(1).optional(),
  from: hm.optional().describe('每天定时查询的开始；与 to 一起给，不给则从现在开始查到今天结束'),
  to: hm.optional()
}

const when = (s: LibSegment): string => `${s.day} ${s.start}–${s.end}`

export function registerLibraryTools(
  mcp: McpServer,
  tools: Record<McpToolGroup, boolean>,
  askUser: (request: Omit<ConfirmRequest, 'id'>) => Promise<boolean>
): void {
  const cancelled = json({ status: 'cancelled', message: '用户取消' })

  if (tools.query) {
    mcp.registerTool('get_library_overview', {
      description: '图书馆座位预约：各馆 buildings → 楼层 floors → 区域 areas 的余座 free / 总座 total，dates 为可预约的日期（次日的一般要到开放时刻后才出现）',
      inputSchema: { date: z.string().optional().describe('YYYY-MM-DD，缺省为今天') },
      annotations: read
    }, async ({ date }) => json(await call('lib:overview', date)))

    mcp.registerTool('get_library_segments', {
      description: '图书馆座位预约：某个区域可预约的时段（按天），返回项原样传给 get_library_seats / reserve_library_seat',
      inputSchema: { area_id: z.string() },
      annotations: read
    }, async ({ area_id }) => json(await call('lib:segments', area_id)))

    mcp.registerTool('get_library_seats', {
      description: '图书馆座位预约：某区域某时段的座位，state 为 free 空闲 / busy 已占 / away 暂离 / closed 不可用',
      inputSchema: { area_id: z.string(), segment },
      annotations: read
    }, async ({ area_id, segment: s }) => json(await call('lib:seats', area_id, s)))

    mcp.registerTool('get_library_bookings', {
      description: '图书馆座位预约：本人的预约（地点、起止、状态原文、能否取消）。预约后需按图书馆规定按时签到，逾期一般记违约',
      annotations: read
    }, async () => json(await call('lib:bookings')))
  }

  if (tools.app) {
    mcp.registerTool('watch_library_seats', {
      description:
        '图书馆订阅（开始查询余座）：每 45–90 秒查一次当天范围内的余座，由满座变出空座时弹 Windows 通知。范围给 preset_id（套餐）或 scopes；给 from + to 为每天定时（只在该时段查，可跨零点），不给则从现在查到今天结束。只通知不预约；要自动预约用 auto_reserve_library_seat',
      inputSchema: watchInput,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true }
    }, async (args) => json(await call('lib:watch', { ...(await resolveWatch(args)), auto: false })))

    mcp.registerTool('list_library_presets', {
      description: '用户在应用里存的图书馆套餐：一组范围（馆 / 层 / 区域）与每天的检查时段，id 可传给 watch_library_seats / auto_reserve_library_seat',
      annotations: { readOnlyHint: true, openWorldHint: false }
    }, async () => json(await call('lib:presets')))

    mcp.registerTool('unwatch_library_seats', {
      description: '停止一个图书馆订阅（list_library_watches 的 id）：结束查询，从列表里去掉',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false }
    }, async ({ id }) => json(await call('lib:unwatch', id)))

    mcp.registerTool('list_library_watches', {
      description: '正在进行的图书馆订阅：范围、每天定时的时段（没有 from / to 的是今天手动开始的）、是否授权自动预约、最近查到的余座',
      annotations: { readOnlyHint: true, openWorldHint: false }
    }, async () => json(await call('lib:watches')))
  }

  if (tools.submit) {
    mcp.registerTool('reserve_library_seat', {
      description: '图书馆座位预约：预约一个座位。应用内会请用户确认；结果不明时不要重试，先 get_library_bookings',
      inputSchema: { area_id: z.string(), seat_id: z.string(), segment },
      annotations: write
    }, async ({ area_id, seat_id, segment: s }) => {
      const seat = (await call('lib:seats', area_id, s)).find((x) => x.id === seat_id)
      if (!seat) throw new Error('没有这个座位')
      if (!(await askUser({ action: 'libreserve', courseName: `${await areaLabel(area_id)} ${seat.name}号`, title: when(s), files: [], comment: '' }))) return cancelled
      return json(await call('lib:reserve', area_id, seat_id, s))
    })

    mcp.registerTool('cancel_library_booking', {
      description: '图书馆座位预约：取消本人的一个预约（get_library_bookings 里 canCancel 的 id）。应用内会请用户确认',
      inputSchema: { booking_id: z.string() },
      annotations: { ...write, destructiveHint: true, idempotentHint: true }
    }, async ({ booking_id }) => {
      const booking = (await call('lib:bookings')).find((b) => b.id === booking_id)
      if (!booking) throw new Error('没有这个预约')
      if (!(await askUser({ action: 'libcancel', courseName: booking.place, title: `${booking.begin}–${booking.end.slice(11)}`, files: [], comment: '' }))) return cancelled
      return json(await call('lib:cancel', booking_id))
    })

    mcp.registerTool('auto_reserve_library_seat', {
      description:
        '图书馆订阅并授权自动预约：查范围内余座，有空座时自动预约当天最早还没结束的时段里的一个空座，约上后这一项结束并关掉其余订阅的自动预约；失败不重试，关掉自动只通知。范围给 preset_id（套餐）或 scopes；给 from + to 为每天定时，不给则从现在查到今天结束。应用内会请用户确认授权',
      inputSchema: watchInput,
      annotations: write
    }, async (args) => {
      const w = await resolveWatch(args)
      if (!(await askUser({ action: 'libauto', courseName: w.scopes.map((s) => s.label).join('　'), title: windowText(w), files: [], comment: '' }))) return cancelled
      return json(await call('lib:watch', { ...w, auto: true }))
    })
  }
}
