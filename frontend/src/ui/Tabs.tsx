import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../lib/cx'

export type TabItem = { id: string; label: string; count?: number; content: ReactNode }

type TabsProps = {
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  label: string
  className?: string
  /** Классы списка вкладок, например выравнивание по сетке страницы. */
  listClassName?: string
}

/** Вкладки с подчёркиванием акцентом; стрелки влево и вправо переключают. */
export function Tabs({ items, value, onChange, label, className, listClassName }: TabsProps) {
  const baseId = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const active = items.find((item) => item.id === value) ?? items[0]

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const index = items.findIndex((item) => item.id === active.id)
    const next = (index + step + items.length) % items.length
    onChange(items[next].id)
    refs.current[next]?.focus()
  }

  return (
    <div className={className}>
      <div className="border-b border-line">
        <div
          role="tablist"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={cx('flex gap-x-6 overflow-x-auto px-4 md:px-6', listClassName)}
        >
          {items.map((item, index) => {
            const selected = item.id === active.id
            return (
              <button
                key={item.id}
                ref={(node) => {
                  refs.current[index] = node
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${item.id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${item.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(item.id)}
                className={cx(
                  'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap py-3 text-sm font-medium transition-colors duration-150',
                  'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:transition-colors',
                  selected ? 'text-ink after:bg-accent-text' : 'text-muted after:bg-transparent hover:text-ink',
                )}
              >
                {item.label}
                {item.count !== undefined && (
                  <span className="rounded-full bg-raised px-1.5 font-mono text-[11px] tabular-nums text-muted">{item.count}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${active.id}`}
        aria-labelledby={`${baseId}-tab-${active.id}`}
        tabIndex={0}
        className="focus-visible:outline-offset-[-2px]"
      >
        {active.content}
      </div>
    </div>
  )
}
