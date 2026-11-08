import type { ReactNode } from 'react'

/** 细线图标按钮：24×24、线宽 1.8、圆头；悬停浅底主题色，aria-label / title 即文字说明 */
export function IconButton({ label, onClick, className, disabled, children }: { label: string; onClick: () => void; className?: string; disabled?: boolean; children: ReactNode }) {
  return (
    <button className={`icon-btn${className ? ` ${className}` : ''}`} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}

export function CloseButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <IconButton label="关闭" onClick={onClick} className={className}>
      <path d="M7 7l10 10M17 7L7 17" />
    </IconButton>
  )
}
