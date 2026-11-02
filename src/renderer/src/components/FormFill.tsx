import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { FormField, FormProfile, FormSession, FormStatus } from '@shared/forms'
import { useApp } from '@renderer/store'
import { Choice, Reveal, SectionHead } from '@renderer/components/Type'
import { useForms } from './formsStore'
import './forms.css'

const LABEL: Partial<Record<FormField, string>> = {
  studentId: '学号',
  name: '姓名',
  college: '学院',
  major: '专业',
  className: '班级',
  grade: '年级',
  phone: '手机',
  email: '邮箱',
  qq: 'QQ',
  wechat: '微信',
  dorm: '宿舍'
}

// 文本项按两列排；性别、校区是选项，各占一整行
const TEXT_FIELDS: { key: keyof FormProfile; type?: string }[] = [
  { key: 'studentId' },
  { key: 'name' },
  { key: 'college' },
  { key: 'major' },
  { key: 'className' },
  { key: 'grade' },
  { key: 'phone', type: 'tel' },
  { key: 'email', type: 'email' },
  { key: 'qq' },
  { key: 'wechat' },
  { key: 'dorm' }
]
const GENDERS = ['男', '女']
const CAMPUSES = ['紫金港', '玉泉', '西溪', '华家池', '之江', '海宁', '舟山']

const STATUS: Record<FormStatus, string> = {
  waiting: '等待开放',
  filling: '填写中',
  asking: '待填写',
  submitting: '提交中',
  verify: '需验证',
  login: '需登录',
  submitted: '已提交',
  closed: '已关闭',
  error: '打不开'
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')
const pad = (n: number): string => String(n).padStart(2, '0')

/** 倒计时：1:02:03；一天以上写「2 天 1:02:03」 */
function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const days = Math.floor(total / 86400)
  const clock = `${Math.floor((total % 86400) / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
  return days > 0 ? `${days} 天 ${clock}` : clock
}

/** 今天的写时刻，别的日子写月日 */
const when = (iso: string): string => {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getMonth() + 1}-${d.getDate()}`
}

/** datetime-local 的值（本地时刻）；默认给下一个整点 */
function nextHour(): string {
  const d = new Date(Date.now() + 3600_000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00:00`
}

/** 工具「问卷填写」：左边订阅问卷与订阅列表（开放倒计时、状态），右边是填写用的个人信息。开放后的补填、确认与答卷备份在全局弹窗 FormPrompt 里 */
export function FormFill() {
  const notify = useApp((s) => s.notify)
  const sessions = useForms((s) => s.sessions)
  const setSessions = useForms((s) => s.setSessions)
  const show = useForms((s) => s.show)
  const [profile, setProfile] = useState<FormProfile | null>(null)
  const [dirty, setDirty] = useState(false)
  const [url, setUrl] = useState('')
  const [timed, setTimed] = useState(false)
  const [at, setAt] = useState(nextHour)
  const [autoSubmit, setAutoSubmit] = useState(true)
  const [optional, setOptional] = useState(true)
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    void window.zju['forms:profile']().then(setProfile, (e) => notify(errorText(e)))
  }, [notify])

  // 倒计时按秒走（记录本身由 FormPrompt 每秒取）
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const set = (key: keyof FormProfile, value: string): void => {
    setProfile((p) => (p ? { ...p, [key]: value } : p))
    setDirty(true)
  }

  const save = async (): Promise<void> => {
    if (!profile) return
    setProfile(await window.zju['forms:saveProfile'](profile))
    setDirty(false)
  }

  const refresh = (): Promise<void> => window.zju['forms:sessions']().then(setSessions)

  // 订阅前先存一遍资料（首次预填的还没落盘），保证按眼前这份填
  const subscribe = (): void => {
    if (!url.trim() || !profile) return
    if (!Object.values(profile).some(Boolean)) return notify('先填个人信息')
    save()
      .then(() => window.zju['forms:open'](url.trim(), { autoSubmit, optional, ...(timed ? { at: new Date(at).toISOString() } : {}) }))
      .then(() => {
        setUrl('')
        return refresh()
      })
      .catch((err) => notify(errorText(err)))
  }

  const act = (run: () => Promise<unknown>): void => {
    run()
      .then(refresh)
      .catch((err) => notify(errorText(err)))
  }

  // 点一条：待填写的弹出填写，已提交的看答卷备份，需验证 / 需登录的显示问卷窗口
  const open = (s: FormSession): void => {
    if (s.status === 'asking' || s.status === 'submitted') show(s.id)
    else if (s.status === 'verify' || s.status === 'login') act(() => window.zju['forms:focus'](s.id))
  }

  return (
    <div className="forms-grid">
      <div className="forms-col">
        <Reveal i={1} flat className="panel forms-open">
          <SectionHead title="订阅问卷" />
          <div>
            <input
              className="field forms-input forms-url"
              placeholder="问卷地址"
              value={url}
              spellCheck={false}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && subscribe()}
            />
            <ul className="rows">
              <OptionRow label="开放">
                <Choice group="forms-when" className="opt" active={!timed} onClick={() => setTimed(false)}>
                  立即
                </Choice>
                <Choice group="forms-when" className="opt" active={timed} onClick={() => setTimed(true)}>
                  定时
                </Choice>
                {timed && <input className="field forms-input forms-at" type="datetime-local" step={1} value={at} onChange={(e) => setAt(e.target.value)} />}
              </OptionRow>
              <OptionRow label="提交">
                <Choice group="forms-submit" className="opt" active={autoSubmit} onClick={() => setAutoSubmit(true)}>
                  自动提交
                </Choice>
                <Choice group="forms-submit" className="opt" active={!autoSubmit} onClick={() => setAutoSubmit(false)}>
                  检查后提交
                </Choice>
              </OptionRow>
              <OptionRow label="选填题">
                <Choice group="forms-optional" className="opt" active={optional} onClick={() => setOptional(true)}>
                  展示
                </Choice>
                <Choice group="forms-optional" className="opt" active={!optional} onClick={() => setOptional(false)}>
                  不展示
                </Choice>
              </OptionRow>
            </ul>
            <div className="forms-go">
              <button className="btn btn-solid" disabled={!url.trim() || !profile} onClick={subscribe}>
                订阅
              </button>
            </div>
          </div>
        </Reveal>

        <Reveal i={2} flat className="panel forms-records">
          <SectionHead title="订阅" />
          {sessions.length === 0 ? (
            <p className="quiet forms-quiet">无</p>
          ) : (
            <ul className="rows">
              {sessions.map((s) => (
                <Record key={s.id} s={s} now={now} onOpen={() => open(s)} onRemove={() => act(() => window.zju['forms:close'](s.id))} />
              ))}
            </ul>
          )}
        </Reveal>
      </div>

      <Reveal i={3} flat className="panel forms-profile">
        <SectionHead
          title="个人信息"
          note={
            <button className={dirty ? 'btn btn-solid forms-save' : 'btn forms-save'} disabled={!dirty} onClick={() => void save().catch((e) => notify(errorText(e)))}>
              保存
            </button>
          }
        />
        {profile && (
          <div className="forms-fields">
            {TEXT_FIELDS.map((f) => (
              <label key={f.key} className="forms-field">
                <span className="forms-label">{LABEL[f.key]}</span>
                <input className="field forms-input" type={f.type ?? 'text'} spellCheck={false} value={profile[f.key]} onChange={(e) => set(f.key, e.target.value)} />
              </label>
            ))}
            <div className="forms-field forms-field-wide">
              <span className="forms-label">性别</span>
              <span className="forms-options">
                {GENDERS.map((g) => (
                  <Choice key={g} group="forms-gender" className="opt" active={profile.gender === g} onClick={() => set('gender', profile.gender === g ? '' : g)}>
                    {g}
                  </Choice>
                ))}
              </span>
            </div>
            <div className="forms-field forms-field-wide">
              <span className="forms-label">校区</span>
              <span className="forms-options">
                {CAMPUSES.map((c) => (
                  <Choice key={c} group="forms-campus" className="opt" active={profile.campus === c} onClick={() => set('campus', profile.campus === c ? '' : c)}>
                    {c}
                  </Choice>
                ))}
              </span>
            </div>
          </div>
        )}
      </Reveal>
    </div>
  )
}

function OptionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="row forms-option-row">
      <span className="forms-label">{label}</span>
      <span className="forms-options">{children}</span>
    </li>
  )
}

/** 一条订阅：开放剩余时间（开放后为时刻）、问卷标题、状态；右侧取消订阅 / 删除备份 */
function Record({ s, now, onOpen, onRemove }: { s: FormSession; now: number; onOpen: () => void; onRemove: () => void }) {
  const left = s.at ? Date.parse(s.at) - (now + s.offset) : 0
  const counting = s.status === 'waiting' && left > 0
  const clickable = s.status === 'asking' || s.status === 'submitted' || s.status === 'verify' || s.status === 'login'
  const hot = s.status === 'asking' || s.status === 'verify' || s.status === 'login' || s.status === 'error'
  const key = (e: KeyboardEvent): void => {
    if (clickable && (e.key === 'Enter' || e.key === ' ')) onOpen()
  }

  return (
    <li className="row forms-row" role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined} data-click={clickable || undefined} data-done={s.status === 'closed' || undefined} onClick={clickable ? onOpen : undefined} onKeyDown={key}>
      <span className="row-time" data-hot={counting || undefined}>
        {counting ? countdown(left) : when(s.submittedAt ?? s.openedAt)}
      </span>
      <span className="forms-row-main">
        <span className="row-title">{s.title}</span>
        {s.status === 'error' && s.message && <span className="forms-row-note">{s.message}</span>}
      </span>
      <span className="forms-status" data-s={s.status} data-hot={hot || undefined}>
        {s.status === 'waiting' && !counting ? '未开放' : STATUS[s.status]}
      </span>
      <button
        className="forms-x"
        aria-label={s.status === 'submitted' ? '删除备份' : '取消订阅'}
        title={s.status === 'submitted' ? '删除备份' : '取消订阅'}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  )
}
