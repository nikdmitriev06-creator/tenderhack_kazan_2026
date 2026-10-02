import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../lib/cx'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  // Акцентная — одна на экран, только главное действие (DESIGN.md).
  primary: 'border-transparent bg-accent text-on-accent hover:bg-accent/85',
  secondary: 'border-line-strong/50 bg-surface text-ink hover:border-ink',
  ghost: 'border-transparent bg-transparent text-muted hover:bg-raised hover:text-ink',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-3 text-[13px]',
  md: 'h-9 gap-2 px-3.5 text-sm',
  lg: 'h-11 gap-2 px-5 text-[15px]',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  /** Сочетание клавиш справа от подписи, например «Ctrl K». */
  kbd?: string
  /** Блокирует кнопку и показывает loadingText вместо подписи. */
  loading?: boolean
  loadingText?: string
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  kbd,
  loading = false,
  loadingText,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-(--radius-ui) border font-medium',
        'transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon && <span className="-ml-0.5 flex items-center [&>svg]:size-4" aria-hidden="true">{icon}</span>}
      {loading && loadingText ? loadingText : children}
      {kbd && <Kbd className="ml-1">{kbd}</Kbd>}
    </button>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-5 items-center rounded-[calc(var(--radius-ui)*0.6)] border border-current/25 px-1.5 font-mono text-[11px] font-medium',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
