import { useEffect, useState } from 'react'
import type { TermCalendar } from '@shared/types'
import { useApp } from '@renderer/store'
import { cached, peek } from '@renderer/lib/cache'

/** 当前学期校历（单双周、教学周、放假调休都靠它），先显示缓存；演示模式不登录也取 */
export function useCalendar(): TermCalendar | null {
  const loggedIn = useApp((s) => s.auth.loggedIn) || import.meta.env.VITE_ZJU_DEMO === '1'
  const epoch = useApp((s) => s.epoch)
  const [cal, setCal] = useState<TermCalendar | null>(() => peek<TermCalendar>('calendar', true) ?? null)

  useEffect(() => {
    if (loggedIn) void cached('calendar', epoch, () => window.zju['data:calendar'](), true).then(setCal, () => {})
  }, [loggedIn, epoch])

  return cal
}
