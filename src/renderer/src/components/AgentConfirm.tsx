import { AnimatePresence, motion } from 'motion/react'
import type { ConfirmRequest } from '@shared/types'
import { useApp } from '@renderer/store'
import { Joined, OutlineWord } from './Type'

const ACTION: Record<ConfirmRequest['action'], { title: string; ok: string }> = {
  submit: { title: '提交作业', ok: '提交' },
  retract: { title: '撤回提交', ok: '撤回' }
}

/** 本地 Agent 经 MCP 发起的提交 / 撤回：应用内确认，文件可点开预览；排队逐个处理 */
export function AgentConfirm() {
  const request = useApp((s) => s.confirms[0])
  const answer = useApp((s) => s.answerConfirm)
  const openPreview = useApp((s) => s.openPreview)

  return (
    <AnimatePresence>
      {request && (
        <>
          <motion.div key="veil" className="sheet-veil !z-[55]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.section
            key={request.id}
            className="confirm"
            initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none', transform: 'none' } }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <OutlineWord text="Agent" />
            <h2 className="section-title">{ACTION[request.action].title}</h2>
            <p className="quiet !py-2">
              <Joined parts={[request.courseName, request.title]} />
            </p>
            {request.files.length > 0 && (
              <ul className="rows mt-2 border-t border-[var(--rule)]">
                {request.files.map((f) =>
                  'path' in f ? (
                    <li key={f.path} className="row !grid-cols-[minmax(0,1fr)_auto] !py-1.5">
                      <button className="truncate text-left text-[0.9375rem] hover:text-[var(--shu)]" onClick={() => openPreview(f.path)}>
                        {f.name}
                      </button>
                      <span className="row-end">预览</span>
                    </li>
                  ) : (
                    <li key={f.url || f.name} className="row !grid-cols-[minmax(0,1fr)] !py-1.5">
                      <span className="truncate text-[0.9375rem]">{f.name}</span>
                    </li>
                  )
                )}
              </ul>
            )}
            {request.comment && <p className="mt-4 whitespace-pre-wrap text-[0.9375rem] text-[var(--ink-2)]">{request.comment}</p>}
            <div className="acts mt-6 justify-end">
              <button className="act" onClick={() => answer(request.id, false)}>
                取消
              </button>
              <button className="act !text-[var(--shu)]" onClick={() => answer(request.id, true)}>
                {ACTION[request.action].ok}
              </button>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  )
}
