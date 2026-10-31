import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { McpState, McpToolGroup, PtaState } from '@shared/types'
import { useApp } from '@renderer/store'
import { OutlineWord, Reveal, SectionHead } from '@renderer/components/Type'
import { ACCENT_OPTIONS, FONT_OPTIONS, SIZE_OPTIONS, type FontStyle } from '@renderer/lib/settings'

// 与 styles.css 中 html[data-font] 的字体栈一致，用来让每个选项以自身字体预览
const FAMILY: Record<FontStyle, string> = {
  song: "'AJ Digits', 'AJ Latin', 'AJ Song', serif",
  hei: "'AJ Sans', 'Microsoft YaHei UI', sans-serif",
  kai: "'AJ Digits', 'AJ Kai', 'KaiTi', serif"
}

const MCP_TOOLS: { id: McpToolGroup; label: string }[] = [
  { id: 'query', label: '读取信息' },
  { id: 'download', label: '下载与导出' },
  { id: 'app', label: '操作界面' },
  { id: 'transcribe', label: '转写' },
  { id: 'submit', label: '提交与撤回作业' }
]

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

/** 设置：按 外观 / 待办 / 账号 / 本地 Agent 分组，每组一列细线条目 */
export function Settings() {
  const { settings, setSetting, todos, setRemind } = useApp()

  return (
    <div className="page">
      <OutlineWord text="Settings" />
      <div className="mt-20 flex max-w-3xl flex-col gap-14">
        <Reveal>
          <Section title="外观">
            <Row label="模式">
              {(['light', 'dark'] as const).map((t) => (
                <Option key={t} active={settings.theme === t} onClick={() => setSetting('theme', t)}>
                  {t === 'light' ? '浅色' : '深色'}
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
            <Row label="背景徽标">
              {([true, false] as const).map((on) => (
                <Option key={String(on)} active={settings.emblem === on} onClick={() => setSetting('emblem', on)}>
                  {on ? '显示' : '隐藏'}
                </Option>
              ))}
            </Row>
          </Section>
        </Reveal>

        <Reveal i={1}>
          <Section title="待办">
            <Row label="截止前 3 小时提醒">
              {([true, false] as const).map((on) => (
                <Option key={String(on)} active={todos.remind === on} onClick={() => void setRemind(on)}>
                  {on ? '开启' : '关闭'}
                </Option>
              ))}
            </Row>
          </Section>
        </Reveal>

        <Reveal i={2}>
          <Section title="账号">
            <ZjuAccount />
            <Pta />
          </Section>
        </Reveal>

        <Reveal i={3}>
          <Section title="本地 Agent">
            <Mcp />
          </Section>
        </Reveal>
      </div>
    </div>
  )
}

/** 统一身份认证：登录状态与登录 / 退出（退出两次点击确认） */
function ZjuAccount() {
  const { auth, authBusy, setLoginOpen, logout } = useApp()
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  return (
    <Row label="统一身份认证">
      {auth.loggedIn ? (
        <>
          <span className="text-[var(--ink)]">{auth.account ?? '已登录'}</span>
          <button
            className="act"
            data-on={armed || undefined}
            disabled={authBusy}
            onClick={() => {
              if (!armed) return setArmed(true)
              setArmed(false)
              void logout()
            }}
          >
            {armed ? '确认退出' : '退出'}
          </button>
        </>
      ) : (
        <>
          <span className="text-[var(--ink-3)]">未登录</span>
          <button className="act" data-login-toggle onClick={() => setLoginOpen(true)}>
            登录
          </button>
        </>
      )}
    </Row>
  )
}

/** PTA：开关；开启后登录（账号密码，验证码时走网页登录）或显示账号与退出。题目集并入主页待办 */
function Pta() {
  const refresh = useApp((s) => s.refresh)
  const [pta, setPta] = useState<PtaState | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.zju['pta:state']().then(setPta)
  }, [])

  // 开关、登录状态变化后让主页待办重取
  const run = async (call: () => Promise<PtaState>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setPta(await call())
      refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (username.trim() && password) {
      void run(() => window.zju['pta:login']({ username: username.trim(), password })).then(() => setPassword(''))
    }
  }

  if (!pta) return null
  return (
    <>
      <Row label="PTA">
        {([true, false] as const).map((on) => (
          <Option key={String(on)} active={pta.enabled === on} onClick={() => void run(() => window.zju['pta:enable'](on))}>
            {on ? '开启' : '关闭'}
          </Option>
        ))}
      </Row>
      {pta.enabled && (
        <Row label="PTA 账号">
          {pta.loggedIn ? (
            <>
              <span className="text-[var(--ink)]">{pta.user ?? '已登录'}</span>
              <button className="act" disabled={busy} onClick={() => void run(() => window.zju['pta:logout']())}>
                退出
              </button>
            </>
          ) : (
            <form className="flex w-full flex-col gap-1" onSubmit={submit}>
              <div className="flex flex-wrap gap-x-6">
                <input
                  className="field login-field !w-[13em]"
                  placeholder="手机号或邮箱"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <input
                  className="field login-field !w-[11em]"
                  type="password"
                  placeholder="密码"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="login-error">{error}</p>}
              <div className="acts mt-3">
                <button type="submit" className="act" disabled={busy || !username.trim() || !password}>
                  {busy ? '登录中' : '登录'}
                </button>
                <button type="button" className="act" disabled={busy} onClick={() => void run(() => window.zju['pta:login']())}>
                  网页登录
                </button>
              </div>
            </form>
          )}
        </Row>
      )}
    </>
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
      <Row label="MCP 接口">
        {([true, false] as const).map((on) => (
          <Option key={String(on)} active={mcp.enabled === on} onClick={() => void set({ enabled: on })}>
            {on ? '开启' : '关闭'}
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
                <span className="text-[0.85em] text-[var(--ink-2)]" style={{ fontFamily: 'var(--f-mono)' }}>
                  {url}
                </span>
                <button
                  className="act"
                  onClick={() => copy(`claude mcp add --transport http zju ${url} --header "Authorization: Bearer ${mcp.token}"`)}
                >
                  复制 Claude Code 命令
                </button>
                <button
                  className="act"
                  onClick={() =>
                    copy(JSON.stringify({ mcpServers: { zju: { type: 'http', url, headers: { Authorization: `Bearer ${mcp.token}` } } } }, null, 2))
                  }
                >
                  复制 JSON 配置
                </button>
              </>
            )}
          </Row>
          <Row label="允许">
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <SectionHead title={title} />
      <ul className="rows">{children}</ul>
    </section>
  )
}

/** 一行设置：左侧名称，右侧选项 */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="row !grid-cols-[8.5em_minmax(0,1fr)] !items-start !py-5">
      <span className="text-base tracking-[0.1em] text-[var(--ink-2)]">{label}</span>
      <span className="flex flex-wrap items-center gap-x-8 gap-y-2">{children}</span>
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
