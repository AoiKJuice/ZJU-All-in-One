import { useEffect, useState, type ReactNode } from 'react'
import type { McpState, McpToolGroup } from '@shared/types'
import { useApp } from '@renderer/store'
import { OutlineWord, Reveal } from '@renderer/components/Type'
import { ACCENT_OPTIONS, FONT_OPTIONS, SIZE_OPTIONS, type FontStyle } from '@renderer/lib/settings'

// 与 styles.css 中 html[data-font] 的字体栈一致，用来让每个选项以自身字体预览
const FAMILY: Record<FontStyle, string> = {
  song: "'AJ Digits', 'AJ Latin', 'AJ Song', serif",
  hei: "'AJ Sans', 'Microsoft YaHei UI', sans-serif",
  kai: "'AJ Digits', 'AJ Kai', 'KaiTi', serif"
}

const MCP_TOOLS: { id: McpToolGroup; label: string }[] = [
  { id: 'query', label: '查询' },
  { id: 'refresh', label: '刷新' },
  { id: 'transcribe', label: '转写' },
  { id: 'submit', label: '提交作业' }
]

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
                <span style={{ fontFamily: FAMILY[o.id] }}>{o.name}</span>
              </Option>
            ))}
          </Row>
          <Row label="字号">
            {SIZE_OPTIONS.map((o) => (
              <Option key={o.id} active={settings.size === o.id} onClick={() => setSetting('size', o.id)}>
                <span style={{ fontSize: `${o.scale}em` }}>{o.label}</span>
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
          <Mcp />
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

/** 本地 MCP 服务：总开关、接入配置、按组开关工具 */
function Mcp() {
  const notify = useApp((s) => s.notify)
  const [mcp, setMcp] = useState<McpState | null>(null)

  useEffect(() => {
    void window.zju['mcp:state']().then(setMcp)
  }, [])

  if (!mcp) return null
  const set = async (patch: Parameters<(typeof window.zju)['mcp:set']>[0]): Promise<void> => setMcp(await window.zju['mcp:set'](patch))
  const url = mcp.url ?? 'http://127.0.0.1:17321/mcp'
  const copy = (text: string): void => {
    void navigator.clipboard.writeText(text).then(() => notify('已复制'))
  }

  return (
    <>
      <Row label="MCP">
        {([false, true] as const).map((on) => (
          <Option key={String(on)} active={mcp.enabled === on} onClick={() => void set({ enabled: on })}>
            {on ? '开' : '关'}
          </Option>
        ))}
      </Row>
      {mcp.enabled && (
        <>
          <Row label="接入">
            {mcp.error ? (
              <span className="text-[var(--shu)]">{mcp.error}</span>
            ) : (
              <>
                <span className="text-[0.85em] text-[var(--ink-2)]" style={{ fontFamily: 'var(--f-mono)' }}>{url}</span>
                <button
                  className="act"
                  onClick={() => copy(`claude mcp add --transport http zju ${url} --header "Authorization: Bearer ${mcp.token}"`)}
                >
                  复制命令
                </button>
                <button
                  className="act"
                  onClick={() =>
                    copy(JSON.stringify({ mcpServers: { zju: { type: 'http', url, headers: { Authorization: `Bearer ${mcp.token}` } } } }, null, 2))
                  }
                >
                  复制 JSON
                </button>
              </>
            )}
          </Row>
          <Row label="工具">
            {MCP_TOOLS.map((t) => (
              <Option key={t.id} active={mcp.tools[t.id]} onClick={() => void set({ tools: { [t.id]: !mcp.tools[t.id] } })}>
                {t.label}
              </Option>
            ))}
          </Row>
        </>
      )}
    </>
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
