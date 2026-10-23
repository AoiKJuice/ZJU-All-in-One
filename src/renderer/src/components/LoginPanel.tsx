import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useApp } from '@renderer/store'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^.*Error: /, '')

/** 刊头"登录"下展开：学号 + 密码程序内登录（密码加密保存，过期自动重登）；网页登录兜底验证码等情况 */
export function LoginPanel() {
  const open = useApp((s) => s.loginOpen)
  const setOpen = useApp((s) => s.setLoginOpen)

  return <AnimatePresence>{open && <Form onClose={() => setOpen(false)} />}</AnimatePresence>
}

function Form({ onClose }: { onClose: () => void }) {
  const login = useApp((s) => s.login)
  const busy = useApp((s) => s.authBusy)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // 点面板外关闭；刊头的"登录"按钮自己切换开合
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!box.current?.contains(target) && !target.closest('[data-login-toggle]')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const run = async (account?: { username: string; password: string }): Promise<void> => {
    setError(null)
    try {
      await login(account)
    } catch (e) {
      setError(errorText(e))
    }
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (username.trim() && password) void run({ username: username.trim(), password })
  }

  return (
    <motion.form
      ref={box}
      className="login-panel"
      onSubmit={submit}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <input
        className="field login-field"
        autoFocus
        placeholder="学号"
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        className="field login-field"
        type="password"
        placeholder="密码"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="login-error">{error}</p>}
      <div className="acts mt-4">
        <button type="submit" className="act" disabled={busy || !username.trim() || !password}>
          {busy ? '登录中' : '登录'}
        </button>
        <span className="flex-1" />
        <button type="button" className="act" disabled={busy} onClick={() => void run()}>
          网页登录
        </button>
      </div>
    </motion.form>
  )
}
