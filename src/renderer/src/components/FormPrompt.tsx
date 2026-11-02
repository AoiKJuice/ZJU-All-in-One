import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { FormAnswer, FormQuestion, FormSession } from '@shared/forms'
import { useApp } from '@renderer/store'
import { dur } from '@renderer/lib/motion'
import { Joined } from './Type'
import { promptOf, useForms } from './formsStore'
import './forms.css'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')
const pad = (n: number): string => String(n).padStart(2, '0')
const stamp = (iso: string): string => {
  const d = new Date(iso)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const KIND: Record<FormQuestion['kind'], string> = { text: '填空', textarea: '简答', radio: '单选', checkbox: '多选', other: '' }
const isEmpty =(v: FormAnswer | undefined): boolean => (Array.isArray(v) ? v.length === 0 : !v?.trim())

/** 问卷订阅的应用内弹窗（挂在 App 上，哪一页都会弹）：开放后补填 / 确认题目并提交，已提交的看答卷备份。每秒取一次订阅记录 */
export function FormPrompt() {
  const setSessions = useForms((s) => s.setSessions)
  const session = useForms(promptOf)

  useEffect(() => {
    let alive = true
    const tick = (): void => void window.zju['forms:sessions']().then((list) => alive && setSessions(list), () => {})
    tick()
    const timer = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [setSessions])

  const visible = session && (session.status === 'asking' || session.status === 'submitted') ? session : null
  return (
    <AnimatePresence>
      {visible && (
        <>
          <motion.div key="veil" className="sheet-veil !z-[55]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: dur(0.3) }} />
          <motion.section
            key={visible.id}
            className="forms-modal"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0, transitionEnd: { transform: 'none' } }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: dur(0.4), ease: [0.22, 1, 0.36, 1] }}
          >
            {visible.status === 'asking' ? <Answer key={visible.round} session={visible} /> : <Backup session={visible} />}
          </motion.section>
        </>
      )}
    </AnimatePresence>
  )
}

/** 补填 / 确认：每题给输入框或选项，提交按钮固定在弹窗底部 */
function Answer({ session }: { session: FormSession }) {
  const notify = useApp((s) => s.notify)
  const postpone = useForms((s) => s.postpone)
  const show = useForms((s) => s.show)
  const [answers, setAnswers] = useState<Record<string, FormAnswer>>(() => Object.fromEntries(session.questions.map((q) => [q.key, q.value])))
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') postpone(session)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [postpone, session])

  const set = (key: string, value: FormAnswer): void => setAnswers((a) => ({ ...a, [key]: value }))
  const missing = session.questions.filter((q) => q.required && q.kind !== 'other' && isEmpty(answers[q.key]))

  const submit = (): void => {
    setChecked(true)
    if (missing.length) return notify('还有必填题没填')
    setBusy(true)
    const given = Object.fromEntries(session.questions.filter((q) => q.kind !== 'other').map((q) => [q.key, answers[q.key] ?? '']))
    window.zju['forms:answer'](session.id, given)
      .then((next) => next.status !== 'asking' && show(null))
      .catch((e) => notify(errorText(e)))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <header className="forms-modal-head">
        <h2 className="section-title">{session.title}</h2>
        {session.message && <p className="forms-modal-message">{session.message}</p>}
      </header>
      <div className="forms-modal-body">
        {session.questions.length === 0 && <p className="quiet">无</p>}
        {session.questions.map((q) => (
          <Question key={q.key} q={q} value={answers[q.key]} error={checked && missing.some((m) => m.key === q.key)} onChange={(v) => set(q.key, v)} onWeb={() => void window.zju['forms:focus'](session.id).catch((e) => notify(errorText(e)))} />
        ))}
      </div>
      <footer className="forms-modal-foot">
        <button className="btn" onClick={() => postpone(session)}>
          稍后
        </button>
        <button className="btn btn-solid" disabled={busy} onClick={submit}>
          {busy ? '提交中' : '提交'}
        </button>
      </footer>
    </>
  )
}

function Question({ q, value, error, onChange, onWeb }: { q: FormQuestion; value: FormAnswer | undefined; error: boolean; onChange: (v: FormAnswer) => void; onWeb: () => void }) {
  const text = typeof value === 'string' ? value : ''
  const list = Array.isArray(value) ? value : value ? [value] : []
  return (
    <div className="forms-q" data-error={error || undefined}>
      <p className="forms-q-title">
        {q.title}
        {q.required && <span className="forms-q-star">*</span>}
        {KIND[q.kind] && <span className="forms-q-kind">{KIND[q.kind]}</span>}
      </p>
      {q.kind === 'text' && <input className="field forms-input" spellCheck={false} value={text} onChange={(e) => onChange(e.target.value)} />}
      {q.kind === 'textarea' && <textarea className="field forms-input forms-textarea" rows={3} value={text} onChange={(e) => onChange(e.target.value)} />}
      {(q.kind === 'radio' || q.kind === 'checkbox') && (
        <div className="forms-choices" role={q.kind === 'radio' ? 'radiogroup' : 'group'}>
          {q.options.map((o) => {
            const on = q.kind === 'radio' ? text === o : list.includes(o)
            const toggle = (): void => onChange(q.kind === 'radio' ? (on ? '' : o) : on ? list.filter((x) => x !== o) : [...list, o])
            return (
              <button key={o} className="forms-choice" role={q.kind} aria-checked={on} data-on={on || undefined} data-kind={q.kind} onClick={toggle}>
                <span className="forms-mark" aria-hidden>
                  {q.kind === 'checkbox' ? (
                    <svg viewBox="0 0 16 16">
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                  ) : (
                    <span className="forms-dot" />
                  )}
                </span>
                <span className="forms-choice-text">{o}</span>
              </button>
            )
          })}
        </div>
      )}
      {q.kind === 'other' && (
        <button className="btn" onClick={onWeb}>
          在网页中填写
        </button>
      )}
    </div>
  )
}

/** 已提交的答卷备份 */
function Backup({ session }: { session: FormSession }) {
  const show = useForms((s) => s.show)
  const notify = useApp((s) => s.notify)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') show(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show])

  return (
    <>
      <header className="forms-modal-head">
        <h2 className="section-title">{session.title}</h2>
        {session.submittedAt && (
          <p className="forms-meta">
            <Joined parts={[`${stamp(session.submittedAt)} 提交`]} />
          </p>
        )}
      </header>
      <div className="forms-modal-body">
        {session.backup.length === 0 ? (
          <p className="quiet">无</p>
        ) : (
          <dl className="forms-backup">
            {session.backup.map((b, i) => (
              <div key={i} className="forms-backup-row">
                <dt>{b.title}</dt>
                <dd>{b.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <footer className="forms-modal-foot">
        <button className="btn" onClick={() => void window.zju['forms:focus'](session.id).catch((e) => notify(errorText(e)))}>
          原问卷
        </button>
        <button className="btn btn-solid" onClick={() => show(null)}>
          关闭
        </button>
      </footer>
    </>
  )
}
