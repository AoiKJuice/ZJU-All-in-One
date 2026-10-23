import type { ReactNode } from 'react'
import { useApp } from '@renderer/store'
import { OutlineWord, Reveal } from '@renderer/components/Type'
import { ACCENT_OPTIONS, FONT_OPTIONS, type FontStyle } from '@renderer/lib/settings'

// 与 styles.css 中 html[data-font] 的字体栈一致，用来让每个选项以自身字体预览
const FAMILY: Record<FontStyle, string> = {
  song: "'AJ Digits', 'AJ Latin', 'AJ Song', serif",
  hei: "'AJ Sans', 'Microsoft YaHei UI', sans-serif",
  kai: "'AJ Digits', 'AJ Kai', 'KaiTi', serif"
}

export function Settings() {
  const { settings, setSetting } = useApp()

  return (
    <div className="page">
      <OutlineWord text="Settings" />
      <Reveal className="mt-24 max-w-3xl">
        <ul className="rows border-t border-[var(--rule)]">
          <Row label="字体">
            {FONT_OPTIONS.map((o) => (
              <Option key={o.id} active={settings.font === o.id} onClick={() => setSetting('font', o.id)}>
                <span style={{ fontFamily: FAMILY[o.id] }}>
                  {o.label}
                  <span className="ml-2 text-[var(--ink-3)]">求是 2026.10</span>
                </span>
              </Option>
            ))}
          </Row>
          <Row label="主题色">
            {ACCENT_OPTIONS.map((o) => (
              <Option key={o.id} active={settings.accent === o.id} onClick={() => setSetting('accent', o.id)}>
                <span className="swatch" style={{ background: o.color }} />
                {o.label}
              </Option>
            ))}
          </Row>
          <Row label="昼夜">
            {(['light', 'dark'] as const).map((t) => (
              <Option key={t} active={settings.theme === t} onClick={() => setSetting('theme', t)}>
                {t === 'light' ? '昼' : '夜'}
              </Option>
            ))}
          </Row>
        </ul>
      </Reveal>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="row !grid-cols-[6.5em_minmax(0,1fr)] !py-5">
      <span className="row-time !text-base tracking-[0.14em]">{label}</span>
      <span className="flex flex-wrap gap-x-8 gap-y-2">{children}</span>
    </li>
  )
}

function Option({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className="opt" data-active={active || undefined} onClick={onClick}>
      {children}
    </button>
  )
}
