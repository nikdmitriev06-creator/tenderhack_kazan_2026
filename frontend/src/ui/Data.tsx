import type { ReactNode } from 'react'
import { IconCheck, IconX } from '@tabler/icons-react'
import { cx } from '../lib/cx'

export type Column<Row> = {
  key: string
  header: string
  render: (row: Row) => ReactNode
  align?: 'left' | 'right'
  className?: string
}

type TableProps<Row> = {
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  /** Строка с ошибкой подсвечивается danger-soft. */
  rowTone?: (row: Row) => 'danger' | undefined
  caption?: string
}

export function Table<Row>({ columns, rows, rowKey, rowTone, caption }: TableProps<Row>) {
  return (
    // Уже 576px по ширине контейнера строки становятся карточками: подпись поля берётся из заголовка колонки.
    <div className="@container">
      <table className="w-full border-collapse text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="@max-xl:sr-only">
          <tr className="border-y border-line bg-raised/60">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cx('px-5 py-2.5 text-xs font-medium text-muted', col.align === 'right' && 'text-right', col.className)}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tone = rowTone?.(row)
            return (
              <tr
                key={rowKey(row)}
                className={cx(
                  'border-b border-line transition-colors last:border-b-0 hover:bg-raised/50 @max-xl:block @max-xl:px-5 @max-xl:py-3',
                  tone === 'danger' && 'bg-danger-soft hover:bg-danger-soft',
                )}
              >
                {columns.map((col, index) => (
                  <td
                    key={col.key}
                    data-label={index > 0 ? col.header : undefined}
                    className={cx(
                      'px-5 py-3 align-top',
                      col.align === 'right' && 'text-right font-mono text-[13px] tabular-nums',
                      col.className,
                      '@max-xl:w-auto @max-xl:px-0',
                      index === 0
                        ? '@max-xl:block @max-xl:pt-0 @max-xl:pb-2 @max-xl:text-left'
                        : '@max-xl:flex @max-xl:items-baseline @max-xl:justify-between @max-xl:gap-4 @max-xl:py-1 @max-xl:text-right ' +
                            '@max-xl:before:shrink-0 @max-xl:before:font-sans @max-xl:before:text-xs @max-xl:before:text-muted ' +
                            '@max-xl:before:content-[attr(data-label)]',
                    )}
                  >
                    {index === 0 ? col.render(row) : <span className="min-w-0 break-words">{col.render(row)}</span>}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export type DefinitionItem = { term: string; value: ReactNode }

/** «Параметр → значение» с пунктиром-выноской. */
export function DefinitionList({ items, className }: { items: DefinitionItem[]; className?: string }) {
  return (
    <dl className={cx('flex flex-col gap-2.5', className)}>
      {items.map((item) => (
        <div key={item.term} className="flex items-baseline gap-2">
          <dt className="shrink-0 text-sm text-muted">{item.term}</dt>
          <span className="min-w-6 flex-1 translate-y-[-3px] border-b border-dotted border-line-strong/70" aria-hidden="true" />
          <dd className="max-w-[60%] text-right text-sm font-medium break-words text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export type StepState = 'todo' | 'active' | 'done' | 'error'
export type Step = { id: string; label: string; state: StepState; hint?: string }

const STEP_MARK: Record<StepState, string> = {
  todo: 'border-line-strong text-muted',
  active: 'border-accent-text text-accent-text',
  done: 'border-success bg-success text-surface',
  error: 'border-danger bg-danger text-surface',
}

const STEP_TEXT: Record<StepState, string> = {
  todo: 'не начат',
  active: 'идёт',
  done: 'пройден',
  error: 'ошибка',
}

/**
 * Путь или этапы процесса. Состояние каждого шага читается и цветом, и текстом для скринридера.
 * В строку шаги встают по ширине своего контейнера, а не окна: в узкой панели они идут столбцом.
 */
export function Steps({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <div className="@container">
      <ol aria-label={label} className="flex flex-col gap-3 @xl:flex-row @xl:items-center @xl:gap-0">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="flex items-center gap-2.5 @xl:after:mx-3 @xl:after:h-px @xl:after:w-8 @xl:after:bg-line-strong @xl:last:after:hidden"
          >
            <span
              className={cx(
                'flex size-6 shrink-0 items-center justify-center rounded-[calc(var(--radius-ui)*0.75)] border font-mono text-[11px] font-semibold [&>svg]:size-3.5',
                STEP_MARK[step.state],
                step.state === 'active' && 'motion-safe:animate-pulse',
              )}
              aria-hidden="true"
            >
              {step.state === 'done' ? <IconCheck stroke={3} /> : step.state === 'error' ? <IconX stroke={3} /> : index + 1}
            </span>
            <span className="flex flex-col leading-tight">
              <span className={cx('text-sm font-medium', step.state === 'todo' ? 'text-muted' : 'text-ink')}>
                {step.label}
                <span className="sr-only">: {STEP_TEXT[step.state]}</span>
              </span>
              {step.hint && <span className="font-mono text-[11px] text-subtle">{step.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
