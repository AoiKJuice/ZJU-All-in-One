import { useEffect, useState, type ReactNode } from 'react'
import type { FormField, FormProfile, FormSession, FormStatus } from '@shared/forms'
import { useApp } from '@renderer/store'
import { AutoHeight, Choice, Joined, Reveal, SectionHead } from '@renderer/components/Type'
import './forms.css'

const LABEL: Record<FormField, string> = {
  studentId: '学号',
  name: '姓名',
  gender: '性别',
  className: '班级',
  major: '专业',
  college: '学院',
  grade: '年级',
  campus: '校区',
  phone: '手机',
  email: '邮箱',
  qq: 'QQ',
  wechat: '微信',
  dorm: '宿舍',
  majorClass: '专业班级',
  collegeMajor: '学院专业'
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
  filled: '已填好',
  attention: '待补填',
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

const clock = (iso: string): string => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local 的值（本地时刻）；默认给下一个整点 */
function nextHour(): string {
  const d = new Date(Date.now() + 3600_000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00:00`
}

/** 工具「问卷填写」：左边打开问卷与本次的记录（状态、倒计时、填了哪些、哪些没认出），右边是填写用的个人信息 */
export function FormFill() {
  const notify = useApp((s) => s.notify)
  const [profile, setProfile] = useState<FormProfile | null>(null)
  const [dirty, setDirty] = useState(false)
  const [url, setUrl] = useState('')
  const [timed, setTimed] = useState(false)
  const [at, setAt] = useState(nextHour)
  const [autoSubmit, setAutoSubmit] = useState(false)
  const [sessions, setSessions] = useState<FormSession[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    void window.zju['forms:profile']().then(setProfile, (e) => notify(errorText(e)))
  }, [notify])

  // 窗口里的填写进度在主进程，开着工具页时每秒取一次；倒计时按秒走
  useEffect(() => {
    let alive = true
    const tick = (): void => {
      setNow(Date.now())
      void window.zju['forms:sessions']().then((list) => alive && setSessions(list), () => {})
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
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

  // 打开前先存一遍资料（首次预填的还没落盘），保证窗口里按眼前这份填
  const submit = (): void => {
    if (!url.trim() || !profile) return
    if (!Object.values(profile).some(Boolean)) {
      notify('先填个人信息')
      return
    }
    save()
      .then(() => window.zju['forms:open'](url.trim(), { autoSubmit, ...(timed ? { at: new Date(at).toISOString() } : {}) }))
      .then((session) => {
        setSessions((list) => [session, ...list.filter((s) => s.id !== session.id)])
        setOpen(session.id)
        setUrl('')
      })
      .catch((err) => notify(errorText(err)))
  }

  const act = (run: () => Promise<unknown>): void => {
    run()
      .then(() => window.zju['forms:sessions']().then(setSessions))
      .catch((err) => notify(errorText(err)))
  }

  return (
    <div className="forms-grid">
      <div className="forms-col">
        <Reveal i={1} flat className="panel forms-open">
          <SectionHead title="打开问卷" />
          <div>
            <input
              className="field forms-input forms-url"
              placeholder="问卷地址"
              value={url}
              spellCheck={false}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
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
                <Choice group="forms-submit" className="opt" active={!autoSubmit} onClick={() => setAutoSubmit(false)}>
                  我来提交
                </Choice>
                <Choice group="forms-submit" className="opt" active={autoSubmit} onClick={() => setAutoSubmit(true)}>
                  自动提交
                </Choice>
              </OptionRow>
            </ul>
            <div className="forms-go">
              <button className="btn btn-solid" disabled={!url.trim() || !profile} onClick={submit}>
                打开
              </button>
            </div>
          </div>
        </Reveal>

        <Reveal i={2} flat className="panel forms-records">
          <SectionHead title="记录" />
          {sessions.length === 0 ? (
            <p className="quiet forms-quiet">无</p>
          ) : (
            <ul className="rows">
              {sessions.map((s) => (
                <Record
                  key={s.id}
                  s={s}
                  now={now}
                  open={open === s.id}
                  onToggle={() => setOpen(open === s.id ? null : s.id)}
                  onFocus={() => act(() => window.zju['forms:focus'](s.id))}
                  onRefill={() => act(() => save().then(() => window.zju['forms:refill'](s.id)))}
                  onClose={() => act(() => window.zju['forms:close'](s.id))}
                />
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

/** 一条记录：时刻（定时的为倒计时）、问卷标题、状态；点开看填了哪些、哪些没认出，以及窗口操作 */
function Record({
  s,
  now,
  open,
  onToggle,
  onFocus,
  onRefill,
  onClose
}: {
  s: FormSession
  now: number
  open: boolean
  onToggle: () => void
  onFocus: () => void
  onRefill: () => void
  onClose: () => void
}) {
  const left = s.at ? Date.parse(s.at) - (now + s.offset) : 0
  const counting = s.status === 'waiting' && left > 0
  const alive = s.status !== 'closed'
  const fields = [...new Set(s.filled.map((f) => f.field))]

  return (
    <li className="forms-record" data-open={open || undefined} data-closed={!alive || undefined}>
      <button className="row forms-row" onClick={onToggle}>
        <span className="row-time" data-hot={counting || undefined}>
          {counting ? countdown(left) : clock(s.at && s.status === 'waiting' ? s.at : s.openedAt)}
        </span>
        <span className="row-title">{s.title}</span>
        <span className="forms-status" data-s={s.status}>
          {s.status === 'waiting' && !counting ? '未开放' : STATUS[s.status]}
        </span>
      </button>
      <AutoHeight>
        {open && (
          <div className="forms-detail">
            {s.at && (
              <p className="forms-meta">
                <Joined parts={[`${new Date(s.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} 开放`, s.autoSubmit && '自动提交']} />
              </p>
            )}
            {fields.length > 0 && (
              <div className="forms-line">
                <span className="forms-label">已填</span>
                <span className="forms-tags">
                  {fields.map((f) => (
                    <span key={f} className="forms-tag" title={s.filled.filter((x) => x.field === f).map((x) => x.title).join('\n')}>
                      {LABEL[f]}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {s.lacking.length > 0 && (
              <div className="forms-line">
                <span className="forms-label">缺资料</span>
                <span className="forms-tags">
                  {s.lacking.map((f) => (
                    <span key={f} className="forms-tag forms-tag-lack">
                      {LABEL[f]}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {s.missed.length > 0 && (
              <div className="forms-line">
                <span className="forms-label">未认出</span>
                <ul className="forms-missed">
                  {s.missed.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            {s.message && <p className="forms-message">{s.message}</p>}
            <div className="forms-actions">
              {alive && (
                <button className="btn btn-solid" onClick={onFocus}>
                  前往窗口
                </button>
              )}
              {alive && s.status !== 'waiting' && s.status !== 'submitted' && (
                <button className="btn" onClick={onRefill}>
                  重新填写
                </button>
              )}
              <button className="btn" onClick={onClose}>
                {alive ? '关闭窗口' : '移除'}
              </button>
            </div>
          </div>
        )}
      </AutoHeight>
    </li>
  )
}
