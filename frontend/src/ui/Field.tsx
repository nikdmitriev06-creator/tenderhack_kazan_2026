import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cx } from '../lib/cx'

const CONTROL =
  'w-full rounded-(--radius-ui) border bg-raised px-3 text-sm text-ink placeholder:text-subtle ' +
  'transition-[border-color,box-shadow] duration-150 ' +
  'focus:border-accent-text focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/25 ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

function controlClass(invalid: boolean, extra?: string) {
  return cx(CONTROL, invalid ? 'border-danger' : 'border-line hover:border-line-strong', extra)
}

type FieldProps = {
  label: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
  /** Получает id поля и id подсказки, чтобы связать их с подписью. */
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
}

/** Подпись над полем, подсказка и ошибка под ним. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const describedBy = error || hint ? hintId : undefined
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={hintId} className="text-xs text-danger">{error}</p>
      ) : (
        hint && <p id={hintId} className="text-xs text-muted">{hint}</p>
      )}
    </div>
  )
}

type Invalid = { invalid?: boolean }

export function Input({ invalid = false, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & Invalid) {
  return <input aria-invalid={invalid || undefined} className={controlClass(invalid, cx('h-9', className))} {...rest} />
}

export function Textarea({ invalid = false, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & Invalid) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={controlClass(invalid, cx('min-h-24 resize-y py-2.5 leading-relaxed', className))}
      {...rest}
    />
  )
}

export function Select({ invalid = false, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & Invalid) {
  return (
    <select aria-invalid={invalid || undefined} className={controlClass(invalid, cx('h-9 pr-8', className))} {...rest}>
      {children}
    </select>
  )
}
