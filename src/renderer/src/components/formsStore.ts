import { create } from 'zustand'
import type { FormSession } from '@shared/forms'

// 问卷订阅的界面状态：FormPrompt（全局）每秒取一次记录，工具页与弹窗共用

interface FormsState {
  sessions: FormSession[]
  /** 用户点开的那条（填写弹窗或答卷备份） */
  open: string | null
  /** 点了「稍后」收起的：订阅 id → 收起时的 round，再问一次（round 变了）会重新弹出 */
  later: Record<string, number>
  setSessions: (sessions: FormSession[]) => void
  show: (id: string | null) => void
  postpone: (session: FormSession) => void
}

export const useForms = create<FormsState>((set) => ({
  sessions: [],
  open: null,
  later: {},
  setSessions: (sessions) => set({ sessions }),
  show: (open) => set({ open }),
  postpone: (session) => set((s) => ({ open: null, later: { ...s.later, [session.id]: session.round } }))
}))

/** 现在该弹出的：用户点开的，否则第一条在等用户、又没被收起的 */
export function promptOf(state: Pick<FormsState, 'sessions' | 'open' | 'later'>): FormSession | null {
  if (state.open) return state.sessions.find((s) => s.id === state.open) ?? null
  return state.sessions.find((s) => s.status === 'asking' && state.later[s.id] !== s.round) ?? null
}
