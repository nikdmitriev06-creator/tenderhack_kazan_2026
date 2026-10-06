import type { ReactNode } from 'react'
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconInfoCircle } from '@tabler/icons-react'
import { cx } from '../lib/cx'

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

const BADGE: Record<Tone, string> = {
  neutral: 'border-transparent bg-raised text-muted',
  accent: 'border-transparent bg-mark text-ink',
  success: 'border-transparent bg-success-soft text-success',
  warning: 'border-transparent bg-warning-soft text-warning',
  danger: 'border-transparent bg-danger-soft text-danger',
}

/** Короткий статус. Цвет всегда дублируется текстом. */
export function Badge({ tone = 'neutral', children, mono = false }: { tone?: Tone; children: ReactNode; mono?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex h-5 items-center whitespace-nowrap rounded-[3px] border px-1.5 text-xs font-medium',
        mono && 'font-mono text-[11px]',
        BADGE[tone],
      )}
    >
      {children}
    </span>
  )
}

const NOTICE: Record<Tone, { box: string; icon: ReactNode }> = {
  neutral: { box: 'border-line bg-raised', icon: <IconInfoCircle className="text-muted" /> },
  accent: { box: 'border-line bg-surface', icon: <IconInfoCircle className="text-ink" /> },
  success: { box: 'border-success/30 bg-success-soft', icon: <IconCircleCheck className="text-success" /> },
  warning: { box: 'border-warning/30 bg-warning-soft', icon: <IconAlertTriangle className="text-warning" /> },
  danger: { box: 'border-danger/35 bg-danger-soft', icon: <IconCircleX className="text-danger" /> },
}

type NoticeProps = { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode; className?: string }

/** Сообщение в потоке страницы. */
export function Notice({ tone = 'accent', title, children, action, className }: NoticeProps) {
  const { box, icon } = NOTICE[tone]
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('flex items-start gap-3 rounded-(--radius-panel) border px-4 py-3', box, className)}
    >
      <span className="mt-0.5 shrink-0 [&>svg]:size-[18px]" aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-semibold text-ink">{title}</p>}
        {children && <div className={cx('text-sm text-muted', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}

/** Заглушка на время загрузки. Форму задаёт className, чтобы она совпадала с итоговой разметкой. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx('block rounded-(--radius-ui) bg-raised motion-safe:animate-pulse', className)} />
}

type EmptyStateProps = { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }

export function EmptyState({ icon, title, children, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-(--radius-panel) border border-dashed border-line-strong/60 px-6 py-8">
      {icon && <span className="text-subtle [&>svg]:size-7" aria-hidden="true">{icon}</span>}
      <div>
        <p className="text-[15px] font-semibold text-ink">{title}</p>
        {children && <p className="mt-1 max-w-[65ch] text-sm text-muted">{children}</p>}
      </div>
      {action}
    </div>
  )
}
