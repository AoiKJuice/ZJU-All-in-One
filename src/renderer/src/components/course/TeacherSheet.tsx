import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ClsComment, ClsTeacher } from '@shared/xk'
import { Choice, Joined } from '@renderer/components/Type'
import { dur } from '@renderer/lib/motion'

const EASE = [0.22, 1, 0.36, 1] as const

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

// 查老师结果按 姓名|学院 缓存在内存里，同一位老师在列表里出现多次只查一次；查不到（未收录或网络不通）为 null
const teachers = new Map<string, Promise<ClsTeacher | null>>()

export function useTeacher(name: string, college: string): ClsTeacher | null | undefined {
  const key = `${name}|${college}`
  const [value, setValue] = useState<{ key: string; t: ClsTeacher | null } | undefined>(undefined)
  useEffect(() => {
    let active = true
    if (!teachers.has(key)) teachers.set(key, window.zju['cls:teacher'](name, college).catch(() => null))
    void teachers.get(key)!.then((t) => {
      if (active) setValue({ key, t })
    })
    return () => {
      active = false
    }
  }, [key, name, college])
  return value?.key === key ? value.t : undefined
}

// 侧页可以叠开（课程详情里点老师），Esc 只收起最上面的一层
const stack: symbol[] = []

/** 选课自己的侧页（右侧滑出）：Esc、点遮罩、「关闭」都能收起，安卓返回键经 Esc 收起 */
export function XkSheet({ open, onClose, actions, children }: { open: boolean; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const me = Symbol()
    stack.push(me)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && stack.at(-1) === me && !e.defaultPrevented) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(me), 1)
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="veil" className="sheet-veil" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside
            key="sheet"
            className="sheet xk-sheet"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: dur(0.6), ease: EASE }}
          >
            <span className="acts xk-sheet-acts">
              {actions}
              <button className="act" onClick={onClose}>
                关闭
              </button>
            </span>
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

/** 查老师侧页：评分、点名比例、各课平均绩点与学生评论（最热 / 最新） */
export function TeacherSheet({ teacher, onClose }: { teacher: { name: string; college: string } | null; onClose: () => void }) {
  return (
    <XkSheet open={teacher !== null} onClose={onClose} actions={teacher && <SiteLink name={teacher.name} college={teacher.college} />}>
      {teacher && <TeacherBody key={`${teacher.name}|${teacher.college}`} name={teacher.name} college={teacher.college} />}
    </XkSheet>
  )
}

function SiteLink({ name, college }: { name: string; college: string }) {
  const t = useTeacher(name, college)
  return t ? (
    <a className="act" href={t.url} target="_blank" rel="noreferrer">
      查老师
    </a>
  ) : null
}

function TeacherBody({ name, college }: { name: string; college: string }) {
  const t = useTeacher(name, college)
  const [sort, setSort] = useState<'rate' | 'time'>('rate')
  const [comments, setComments] = useState<{ sort: string; list: ClsComment[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!t) return
    let active = true
    setError(null)
    window.zju['cls:comments'](t.id, sort).then(
      (list) => active && setComments({ sort, list }),
      (e) => active && setError(errorText(e))
    )
    return () => {
      active = false
    }
  }, [t, sort])

  const list = comments?.sort === sort ? comments.list : null

  return (
    <>
      <h2 className="sheet-title">{name}</h2>
      {t === undefined ? (
        <p className="quiet">…</p>
      ) : t === null ? (
        <p className="quiet">无</p>
      ) : (
        <>
          <p className="sheet-meta">
            <Joined parts={[t.college, `${t.ratingCount} 人评分`, t.rollCall !== null && `${t.rollCall}% 认为点名`]} />
          </p>
          <div className="xk-score">
            <span className="xk-score-figure" data-high={(t.rating ?? 0) >= 8.5 || undefined}>
              {t.rating?.toFixed(1) ?? '—'}
            </span>
            {t.courses.length > 0 && (
              <ul className="xk-gpa">
                {t.courses.map((c) => (
                  <li key={c.name}>
                    <span className="xk-gpa-name">{c.name}</span>
                    <span className="xk-gpa-num">{c.gpa.toFixed(2)}</span>
                    <span className="xk-gpa-sample">{c.sample} 人</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="xk-sheet-tools">
            <Choice group="xk-comment-sort" className="small" active={sort === 'rate'} onClick={() => setSort('rate')}>
              最热
            </Choice>
            <Choice group="xk-comment-sort" className="small" active={sort === 'time'} onClick={() => setSort('time')}>
              最新
            </Choice>
          </div>
          <div className="sheet-body">
            {list === null ? (
              <p className="quiet">{error ?? '…'}</p>
            ) : list.length === 0 ? (
              <p className="quiet">无</p>
            ) : (
              <ul className="xk-comments">
                {list.map((c) => (
                  <li key={c.id}>
                    <p>{c.text}</p>
                    <span className="xk-comment-meta">
                      <Joined parts={[c.date, `${c.likes} 赞`]} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  )
}
