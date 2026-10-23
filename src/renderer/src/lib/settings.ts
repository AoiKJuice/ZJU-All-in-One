import { initialTheme, applyTheme, type Theme } from './theme'

export type FontStyle = 'song' | 'hei' | 'kai'
export type Accent = 'shu' | 'blue' | 'red'

export interface Settings {
  theme: Theme
  font: FontStyle
  accent: Accent
}

export const FONT_OPTIONS: { id: FontStyle; label: string }[] = [
  { id: 'song', label: '书宋' },
  { id: 'hei', label: '黑体' },
  { id: 'kai', label: '文楷' }
]

export const ACCENT_OPTIONS: { id: Accent; label: string; color: string }[] = [
  { id: 'blue', label: '求是蓝', color: '#003f88' },
  { id: 'red', label: '求是红', color: '#b01f24' },
  { id: 'shu', label: '朱砂', color: '#a94f35' }
]

const KEY = 'zju-settings'

export function initialSettings(): Settings {
  const defaults: Settings = { theme: initialTheme(), font: 'song', accent: 'blue' }
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
    return {
      theme: defaults.theme,
      font: FONT_OPTIONS.some((o) => o.id === stored.font) ? stored.font! : defaults.font,
      accent: ACCENT_OPTIONS.some((o) => o.id === stored.accent) ? stored.accent! : defaults.accent
    }
  } catch {
    return defaults
  }
}

export function applySettings(s: Settings): void {
  applyTheme(s.theme)
  document.documentElement.dataset.font = s.font
  document.documentElement.dataset.accent = s.accent
  try {
    localStorage.setItem(KEY, JSON.stringify({ font: s.font, accent: s.accent }))
  } catch {}
}
