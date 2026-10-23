import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Assignment, AssignmentDetail, PickedFile } from '@shared/types'
import { useApp } from '@renderer/store'
import { clock, dotDate, relativeTo } from '@renderer/lib/format'

const EASE = [0.22, 1, 0.36, 1] as const

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

/** 学校返回的说明 HTML：去掉脚本、样式与事件属性后再渲染 */
function clean(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, iframe, object').forEach((n) => n.remove())
  doc.querySelectorAll('*').forEach((n) => {
    for (const a of [...n.attributes]) {
      if (a.name.startsWith('on') || a.name === 'style' || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name)
    }
  })
  return doc.body.innerHTML
}

const size = (n: number): string => (n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`)

/** 作业侧页：说明、已提交记录、应用内提交（homework 类型），其余类型只给原页面链接 */
export function AssignmentSheet() {
  const { assignment, openAssignment, refresh } = useApp()
  return (
    <AnimatePresence>
      {assignment && (
        <>
          <motion.div
            key="veil"
            className="sheet-veil"
            onClick={() => openAssignment(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            key="sheet"
            className="sheet"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <Body key={assignment.id} a={assignment} onSubmitted={refresh} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

// 作业以 prop 传入而非从 store 读：关闭时 store 先清空，退场动画期间这里仍要渲染原来的作业
function Body({ a, onSubmitted }: { a: Assignment; onSubmitted: () => void }) {
  const openAssignment = useApp((s) => s.openAssignment)
  const [detail, setDetail] = useState<AssignmentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [files, setFiles] = useState<PickedFile[]>([])
  const [armed, setArmed] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')

  const load = (): void => {
    window.zju['homework:detail'](a.id).then(setDetail, (e) => setError(errorText(e)))
  }
  useEffect(load, [a.id])

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  const pick = async (): Promise<void> => {
    const picked = await window.zju['homework:pick']()
    setFiles((f) => [...f, ...picked.filter((p) => !f.some((x) => x.path === p.path))])
  }

  // 提交需两次点击："提交" → "确认提交"
  const submit = async (): Promise<void> => {
    if (!armed) return setArmed(true)
    setArmed(false)
    setState('sending')
    setError(null)
    try {
      await window.zju['homework:submit'](a.id, comment.trim(), files)
      setState('sent')
      setComment('')
      setFiles([])
      load()
      onSubmitted()
    } catch (e) {
      setError(errorText(e))
      setState('idle')
    }
  }

  const canSubmit = a.type === 'homework'
  const empty = !comment.trim() && files.length === 0

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="section-title !tracking-[0.06em]">{a.title}</h2>
        <button className="act shrink-0" onClick={() => openAssignment(null)}>
          关闭
        </button>
      </div>
      <p className="quiet !py-2">
        {a.courseName}　·　{dotDate(a.deadline)} {clock(a.deadline)}　·　{relativeTo(a.deadline)}
        {a.url && (
          <a className="act ml-4" href={a.url} target="_blank" rel="noreferrer">
            原页面 ↗
          </a>
        )}
      </p>

      <div className="sheet-body mt-4 border-t border-[var(--rule)] pt-5">
        {!detail ? (
          <p className="quiet">{error ?? '…'}</p>
        ) : (
          <>
            {detail.descriptionHtml && <div className="rich" dangerouslySetInnerHTML={{ __html: clean(detail.descriptionHtml) }} />}
            {detail.attachments.length > 0 && (
              <ul className="rows mt-4">
                {detail.attachments.map((f) => (
                  <li key={f.url}>
                    <a className="row !grid-cols-1 !py-2" href={f.url} target="_blank" rel="noreferrer">
                      <span className="row-title !text-base">{f.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {detail.submissions.length > 0 && (
              <div className="mt-8">
                <h3 className="section-note">已提交</h3>
                <ul className="rows">
                  {detail.submissions.map((s) => (
                    <li key={s.id} className="row !grid-cols-[6.5em_minmax(0,1fr)] !py-2">
                      <span className="row-time">
                        {dotDate(s.submittedAt)} {clock(s.submittedAt)}
                      </span>
                      <span className="text-[0.9375rem]">{[s.comment, ...s.files.map((f) => f.name)].filter(Boolean).join('　·　')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {canSubmit && (
        <div className="mt-4">
          <textarea className="field" placeholder="留言" value={comment} onChange={(e) => setComment(e.target.value)} />
          {files.length > 0 && (
            <ul className="rows">
              {files.map((f) => (
                <li key={f.path} className="row !grid-cols-[minmax(0,1fr)_auto_auto] !py-1.5">
                  <span className="truncate text-[0.9375rem]">{f.name}</span>
                  <span className="row-end">{size(f.size)}</span>
                  <button className="act" onClick={() => setFiles((x) => x.filter((y) => y.path !== f.path))}>
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="acts mt-4 justify-end">
            {error && detail && <span className="mr-auto text-sm text-[var(--shu)]">{error}</span>}
            {state === 'sent' && <span className="mr-auto text-sm text-[var(--ink-3)]">已提交</span>}
            <button className="act" onClick={pick} disabled={state === 'sending'}>
              添加文件
            </button>
            <button className="act !text-[var(--shu)]" onClick={submit} disabled={empty || state === 'sending'}>
              {state === 'sending' ? '提交中' : armed ? '确认提交' : '提交'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
