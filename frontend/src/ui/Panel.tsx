import type { ReactNode } from 'react'
import { cx } from '../lib/cx'

type PanelProps = {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  id?: string
  /** Без внутренних отступов: для таблиц во всю ширину панели. */
  flush?: boolean
}

/** Блок экрана: поверхность surface с тонкой рамкой. */
export function Panel({ title, description, actions, children, className, id, flush = false }: PanelProps) {
  const hasHeader = Boolean(title || actions)
  return (
    <section id={id} className={cx('overflow-hidden rounded-(--radius-panel) border border-line bg-surface', className)}>
      {hasHeader && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-[15px] font-semibold tracking-tight text-balance text-ink">{title}</h2>}
            {description && <p className="mt-0.5 max-w-[65ch] text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(!flush && 'p-5', flush && hasHeader && 'pt-3')}>{children}</div>
    </section>
  )
}
