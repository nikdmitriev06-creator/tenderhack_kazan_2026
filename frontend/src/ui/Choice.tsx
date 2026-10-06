import type { InputHTMLAttributes, ReactNode } from 'react'
import { cx } from '../lib/cx'

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }

export function Radio({ label, className, ...rest }: ChoiceProps) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2.5 text-sm text-ink', className)}>
      <input
        type="radio"
        className={cx(
          'size-4.5 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-line-strong bg-raised',
          'transition-colors duration-150 checked:border-accent-text',
          'checked:bg-[radial-gradient(circle,var(--color-accent-text)_40%,transparent_44%)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...rest}
      />
      <span>{label}</span>
    </label>
  )
}

export function Checkbox({ label, className, ...rest }: ChoiceProps) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2.5 text-sm text-ink', className)}>
      <input
        type="checkbox"
        className="size-4 shrink-0 cursor-pointer accent-(--color-accent-text) disabled:cursor-not-allowed disabled:opacity-50"
        {...rest}
      />
      <span>{label}</span>
    </label>
  )
}
