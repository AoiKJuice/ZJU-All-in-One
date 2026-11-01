import { useEffect, useState } from 'react'

interface Props<T extends string> {
  label: string
  formats: readonly T[]
  onPick: (format: T) => void
}

/** 一个文字按钮，点开后在下方弹出格式菜单（样式同右键菜单），点别处关闭 */
export function FormatMenu<T extends string>({ label, formats, onPick }: Props<T>) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!at) return
    const close = (): void => setAt(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [at])

  return (
    <>
      <button
        className="act"
        data-on={at ? true : undefined}
        onClick={(e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          // 靠右的按钮让菜单向左展开，不超出窗口
          setAt(at ? null : { x: Math.min(r.left, window.innerWidth - 112), y: r.bottom + 6 })
        }}
      >
        {label}
      </button>
      {at && (
        <ul className="context-menu" style={{ left: at.x, top: at.y }} onClick={(e) => e.stopPropagation()}>
          {formats.map((f) => (
            <li key={f}>
              <button
                onClick={() => {
                  setAt(null)
                  onPick(f)
                }}
              >
                {f.toUpperCase()}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
