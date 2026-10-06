import { useEffect, useId, useLayoutEffect, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../../lib/cx'
import {
  allowedOptions,
  allowedRange,
  isSelectedValue,
  popoverPosition,
  rangeLabel,
  type AllowedRange,
} from './allowedValues.ts'

type Props = {
  name: string
  values: readonly string[] | null | undefined
  range: AllowedRange | null | undefined
  unit: string | null
  current: string | null
  open: boolean
  onToggle: () => void
  onSelect: (value: string) => void
  anchorRef: RefObject<HTMLDivElement | null>
  panelRef: RefObject<HTMLDivElement | null>
}

/** Кнопка «варианты» или «диапазон» и панель допустимых значений этой характеристики. */
export function AllowedValues({ name, values, range, unit, current, open, onToggle, onSelect, anchorRef, panelRef }: Props) {
  const panelId = useId()
  const options = allowedOptions(values)
  const bounds = allowedRange(range)
  const rangeKey = bounds ? `${bounds.min ?? ''}:${bounds.max ?? ''}` : ''
  const label = options.length > 0 ? `Допустимые значения «${name}»` : `Допустимый диапазон «${name}»`
  const caption = options.length > 0 ? 'варианты' : 'диапазон'

  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const anchor = anchorRef.current
    if (!panel || !anchor) return
    // Нативный слушатель, не React: панель в портале, и всплытие до document надо оборвать до обработчика «снаружи».
    const stop = (event: Event) => event.stopPropagation()
    panel.addEventListener('pointerdown', stop)
    const place = () => {
      const pos = popoverPosition(anchor.getBoundingClientRect(), { width: panel.offsetWidth, height: panel.offsetHeight }, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
      panel.style.top = `${pos.top}px`
      panel.style.left = `${pos.left}px`
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      panel.removeEventListener('pointerdown', stop)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef, panelRef, options.length, rangeKey])

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const option = panel?.querySelector<HTMLElement>('[role="option"]')
    ;(option ?? panel)?.focus()
  }, [open, panelRef])

  if (!bounds && options.length === 0) return null

  return (
    <div ref={open ? anchorRef : undefined} className="shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        aria-label={label}
        title={label}
        onClick={onToggle}
        className="text-[13px] text-muted underline decoration-line-strong/60 underline-offset-4 hover:text-ink"
      >
        {caption}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            onPointerDown={(event) => event.stopPropagation()}
            className="fixed z-30 m-0 max-h-72 w-[min(20rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-(--radius-panel) border border-line bg-surface p-0 text-left shadow-[0_12px_32px_-16px_rgb(23_25_28/0.28)]"
          >
            {options.length > 0 && (
              <div>
                <p className="px-3 pt-2.5 pb-1 text-xs text-muted">Допустимые значения</p>
                <ul role="listbox" aria-label={label} className="pb-1">
                  {options.map((option) => {
                    const selected = isSelectedValue(current, option)
                    return (
                      <li key={option}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => onSelect(option)}
                          className={cx(
                            'flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm break-words text-ink',
                            'hover:bg-raised focus-visible:bg-raised focus-visible:outline-none',
                          )}
                        >
                          <span className="min-w-0 flex-1">{option}</span>
                          {selected && (
                            <span className="shrink-0 text-ink" aria-hidden="true">
                              ✓
                            </span>
                          )}
                          {selected && <span className="sr-only">, выбрано</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {bounds && (
              <div className={cx('px-3 py-2.5', options.length > 0 && 'border-t border-line')}>
                <p className="text-xs text-muted">Допустимый диапазон</p>
                <p className="mt-0.5 text-sm text-ink tabular-nums">{rangeLabel(bounds, unit)}</p>
                <p className="mt-1 text-xs text-muted">Укажите значение в диапазоне.</p>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
