import type { LibraryHandlers } from '@shared/library'
import * as lib from './library'

// 图书馆预约的通道实现（不含订阅：订阅只在桌面端，见 main/libwatch.ts）。桌面 libIpc.ts 与安卓 bridge.ts 共用

/** 订阅与套餐只在桌面端（main/libwatch.ts） */
export type LibraryLocalChannel = 'lib:watches' | 'lib:watch' | 'lib:unwatch' | 'lib:presets' | 'lib:savePreset' | 'lib:removePreset'

export type LibraryCoreHandlers = Omit<LibraryHandlers, LibraryLocalChannel>

export const libraryHandlers: LibraryCoreHandlers = {
  'lib:overview': (date, quiet) => lib.getOverview(date, quiet),
  'lib:segments': (areaId) => lib.getSegments(areaId),
  'lib:seats': (areaId, segment) => lib.getSeats(areaId, segment),
  'lib:reserve': (_areaId, seatId, segment) => lib.reserve(seatId, segment),
  'lib:bookings': () => lib.getBookings(),
  'lib:cancel': (bookingId) => lib.cancel(bookingId)
}

export const resetLibrary = (): void => lib.reset()
