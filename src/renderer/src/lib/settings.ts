import { initialTheme, applyTheme, type Theme } from './theme'
import { MOBILE } from './platform'
import { setMotionSpeed } from './motion'

export type FontStyle = 'song' | 'hei' | 'kai'
export type Accent = 'shu' | 'blue' | 'red'
export type FontSize = 's' | 'm' | 'l' | 'xl'
export type Speed = 'off' | 'fast' | 'normal' | 'slow'
export type Style = 'paper' | 'material' | 'glass'

export interface Settings {
  theme: Theme
  /** 整体风格：经典（纸与墨，默认）以外的各在 themes/*.css */
  style: Style
  font: FontStyle
  accent: Accent
  size: FontSize
  /** 主页左侧的钟鹰衬底 */
  emblem: boolean
  /** 动效速度：所有动画时长乘以系数，关闭为 0 */
  speed: Speed
}

// name 为字体本身的名字，设置页以该字体显示它；安卓上的黑体是系统自带的思源黑体
export const STYLE_OPTIONS: { id: Style; label: string }[] = [
  { id: 'paper', label: '经典' },
  { id: 'material', label: 'Material' },
  { id: 'glass', label: '液态玻璃' }
]

export const FONT_OPTIONS: { id: FontStyle; name: string }[] = [
  { id: 'song', name: '思源宋体' },
  { id: 'hei', name: MOBILE ? '思源黑体' : '微软雅黑' },
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

export const SPEED_OPTIONS: { id: Speed; label: string; factor: number }[] = [
  { id: 'off', label: '关闭', factor: 0 },
  { id: 'fast', label: '快', factor: 0.6 },
  { id: 'normal', label: '标准', factor: 1 },
  { id: 'slow', label: '慢', factor: 1.6 }
]

const KEY = 'zju-settings'

export function initialSettings(): Settings {
  const defaults: Settings = { theme: initialTheme(), style: 'paper', font: 'song', accent: 'blue', size: 'm', emblem: true, speed: 'normal' }
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
    return {
      theme: defaults.theme,
      style: STYLE_OPTIONS.some((o) => o.id === stored.style) ? stored.style! : defaults.style,
      font: FONT_OPTIONS.some((o) => o.id === stored.font) ? stored.font! : defaults.font,
      accent: ACCENT_OPTIONS.some((o) => o.id === stored.accent) ? stored.accent! : defaults.accent,
      size: SIZE_OPTIONS.some((o) => o.id === stored.size) ? stored.size! : defaults.size,
      emblem: stored.emblem ?? defaults.emblem,
      speed: SPEED_OPTIONS.some((o) => o.id === stored.speed) ? stored.speed! : defaults.speed
    }
  } catch {
    return defaults
  }
}

export function applySettings(s: Settings): void {
  applyTheme(s.theme)
  document.documentElement.dataset.style = s.style
  document.documentElement.dataset.font = s.font
  document.documentElement.dataset.accent = s.accent
  document.documentElement.style.setProperty('--scale', String(SIZE_OPTIONS.find((o) => o.id === s.size)!.scale))
  setMotionSpeed(SPEED_OPTIONS.find((o) => o.id === s.speed)!.factor)
  try {
    localStorage.setItem(KEY, JSON.stringify({ style: s.style, font: s.font, accent: s.accent, size: s.size, emblem: s.emblem, speed: s.speed }))
  } catch {}
}
