// 图书馆座位预约（booking.lib.zju.edu.cn）：类型与 IPC 通道。单独成文件，ipc.ts 的 ZjuApi 继承 LibraryApi、ZJU_CHANNELS 并入 LIBRARY_CHANNELS

/** 馆 → 层 → 区域，余座 / 总座取自预约系统的快速选座（某一天） */
export interface LibArea {
  id: string
  name: string
  free: number | null
  total: number | null
}

export interface LibFloor extends LibArea {
  areas: LibArea[]
}

export interface LibBuilding extends LibArea {
  floors: LibFloor[]
}

export interface LibOverview {
  /** YYYY-MM-DD */
  date: string
  /** 可预约的日期（一般为今天，开放后加上明天） */
  dates: string[]
  buildings: LibBuilding[]
}

/** 区域某天的一个可预约时段（Seat/date 的 times） */
export interface LibSegment {
  id: string
  /** YYYY-MM-DD */
  day: string
  /** HH:MM */
  start: string
  end: string
}

export type LibSeatState = 'free' | 'busy' | 'away' | 'closed'

export interface LibSeat {
  id: string
  /** 座位号 */
  name: string
  state: LibSeatState
}

/** 本人的预约 */
export interface LibBooking {
  id: string
  /** 地点：馆 层 区域 座位 */
  place: string
  /** YYYY-MM-DD HH:MM */
  begin: string
  end: string
  /** 预约系统给的状态原文（待签到 / 使用中 / 已使用 / 已取消…） */
  status: string
  canCancel: boolean
}

export interface LibWriteResult {
  status: 'saved' | 'rejected' | 'unknown'
  message: string
}

/** 订阅范围的一项：整个馆、某一层或某个区域 */
export interface LibScope {
  kind: 'building' | 'floor' | 'area'
  id: string
  /** 如「主馆 3F 东区」 */
  label: string
}

/**
 * 订阅＝正在查询余座的一项；停止即结束（从列表里去掉），要再用就存成套餐。
 * 不带 from / to 的是手动开始的，开始后一直查到当天结束；带 from / to 的是每天定时的，只在该时段里查。
 * 有空座时通知；auto 为用户事先授权的自动预约，约上后这一项结束
 */
export interface LibWatch {
  id: string
  /** 从套餐开始时为套餐名 */
  name?: string
  scopes: LibScope[]
  /** HH:MM，每天定时查询的时段；不定时则没有 */
  from?: string
  to?: string
  /** 手动开始的那天（YYYY-MM-DD），过了这天自动结束 */
  day?: string
  auto: boolean
  /** 最近一次查到的范围内余座合计 */
  free: number | null
  checkedAt: number | null
}

export type LibWatchInput = Pick<LibWatch, 'scopes' | 'from' | 'to' | 'auto' | 'name'> & { id?: string }

/** 套餐：存下的一组范围与（可选的）每天定时时段，一键开始订阅 / 自动预约 */
export interface LibPreset {
  id: string
  name: string
  scopes: LibScope[]
  from?: string
  to?: string
}

export type LibPresetInput = Omit<LibPreset, 'id'> & { id?: string }

/** 预约系统公开的规则：次日座位几点开放（config.new）与官方座位规则原文（按行） */
export interface LibRules {
  /** HH:MM */
  openNext?: string
  lines: string[]
}

/** Agent 经 MCP 发起、要用户在应用内确认的图书馆写操作 */
export type LibConfirmAction = 'libreserve' | 'libcancel' | 'libauto'

export interface LibraryApi {
  /** 各馆 / 层 / 区域某天的余座；date 缺省为今天。quiet：后台订阅在用，被别处登录顶掉时不重登 */
  'lib:overview': (date?: string, quiet?: boolean) => Promise<LibOverview>
  /** 区域可预约的时段（按天） */
  'lib:segments': (areaId: string) => Promise<LibSegment[]>
  'lib:seats': (areaId: string, segment: LibSegment) => Promise<LibSeat[]>
  /** 写：预约一个座位（结果以回查本人预约为准，不重发） */
  'lib:reserve': (areaId: string, seatId: string, segment: LibSegment) => Promise<LibWriteResult>
  'lib:bookings': () => Promise<LibBooking[]>
  /** 公开规则，不需登录 */
  'lib:rules': () => Promise<LibRules>
  /** 写：取消预约 */
  'lib:cancel': (bookingId: string) => Promise<LibWriteResult>
  /** 订阅（正在查询的，只在桌面端）；lib:unwatch 即停止 */
  'lib:watches': () => Promise<LibWatch[]>
  'lib:watch': (input: LibWatchInput) => Promise<LibWatch[]>
  'lib:unwatch': (id: string) => Promise<LibWatch[]>
  /** 套餐（只在桌面端） */
  'lib:presets': () => Promise<LibPreset[]>
  'lib:savePreset': (input: LibPresetInput) => Promise<LibPreset[]>
  'lib:removePreset': (id: string) => Promise<LibPreset[]>
}

export type LibraryChannel = keyof LibraryApi

export const LIBRARY_CHANNELS = [
  'lib:overview',
  'lib:segments',
  'lib:seats',
  'lib:reserve',
  'lib:bookings',
  'lib:rules',
  'lib:cancel',
  'lib:watches',
  'lib:watch',
  'lib:unwatch',
  'lib:presets',
  'lib:savePreset',
  'lib:removePreset'
] as const satisfies readonly LibraryChannel[]

/** 去掉主进程 handler 的 win 参数后的通道实现，桌面端与安卓端共用 */
export type LibraryHandlers = { [K in LibraryChannel]: (...args: Parameters<LibraryApi[K]>) => ReturnType<LibraryApi[K]> }

/** 订阅范围覆盖的全部区域 */
export function areasIn(overview: LibOverview, scopes: LibScope[]): { area: LibArea; label: string }[] {
  const out: { area: LibArea; label: string }[] = []
  for (const b of overview.buildings) {
    for (const f of b.floors) {
      for (const a of f.areas) {
        const hit = scopes.some(
          (s) => (s.kind === 'building' && s.id === b.id) || (s.kind === 'floor' && s.id === f.id) || (s.kind === 'area' && s.id === a.id)
        )
        if (hit) out.push({ area: a, label: `${b.name} ${f.name} ${a.name}` })
      }
    }
  }
  return out
}
