import { initialTheme, applyTheme, type Theme } from './theme'

export type FontStyle = 'song' | 'hei' | 'kai'
export type Accent = 'shu' | 'blue' | 'red'
export type FontSize = 's' | 'm' | 'l' | 'xl'

export interface Settings {
  theme: Theme
  font: FontStyle
  accent: Accent
  size: FontSize
}

// name 为字体本身的名字，设置页以该字体显示它
export const FONT_OPTIONS: { id: FontStyle; name: string }[] = [
  { id: 'song', name: '方正书宋' },
  { id: 'hei', name: '微软雅黑' },
  { id: 'kai', name: '霞鹜文楷' }
]

export const ACCENT_OPTIONS: { id: Accent; label: string; color: string }[] = [
  { id: 'blue', label: '求是蓝', color: '#003f88' },
  { id: 'red', label: '创新红', color: '#b01f24' },
  { id: 'shu', label: '朱砂', color: '#a94f35' }
]

// scale 乘在根字号上（根字号本身随窗口缩放），所有 rem 尺寸一起变
export const SIZE_OPTIONS: { id: FontSize; label: string; scale: number }[] = [
  { id: 's', label: '小', scale: 0.9 },
  { id: 'm', label: '标准', scale: 1 },
  { id: 'l', label: '大', scale: 1.1 },
  { id: 'xl', label: '特大', scale: 1.22 }
]

const KEY = 'zju-settings'

export function initialSettings(): Settings {
  const defaults: Settings = { theme: initialTheme(), font: 'song', accent: 'blue', size: 'm' }
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
    return {
      theme: defaults.theme,
      font: FONT_OPTIONS.some((o) => o.id === stored.font) ? stored.font! : defaults.font,
      accent: ACCENT_OPTIONS.some((o) => o.id === stored.accent) ? stored.accent! : defaults.accent,
      size: SIZE_OPTIONS.some((o) => o.id === stored.size) ? stored.size! : defaults.size
    }
  } catch {
    return defaults
  }
}

export function applySettings(s: Settings): void {
  applyTheme(s.theme)
  document.documentElement.dataset.font = s.font
  document.documentElement.dataset.accent = s.accent
  document.documentElement.style.setProperty('--scale', String(SIZE_OPTIONS.find((o) => o.id === s.size)!.scale))
  try {
    localStorage.setItem(KEY, JSON.stringify({ font: s.font, accent: s.accent, size: s.size }))
  } catch {}
}
