import { useEffect, useId, useRef, type ReactNode } from 'react'
import { IconX } from '@tabler/icons-react'

type DialogProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}

/** Модальное окно на нативном <dialog>: фокус, Esc и затемнение даёт браузер. */
export function Dialog({ open, onClose, title, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        // Клик по затемнению вокруг окна закрывает его.
        if (event.target === ref.current) onClose()
      }}
      aria-labelledby={titleId}
      className="m-auto w-[min(560px,calc(100vw-32px))] overscroll-contain rounded-(--radius-panel) border border-line bg-surface p-0 text-ink shadow-[0_20px_60px_rgb(23_25_28/0.18)] backdrop:bg-ink/30"
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
        <h2 id={titleId} className="text-base font-semibold tracking-tight">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="-mt-1 -mr-1 flex size-8 items-center justify-center rounded-(--radius-ui) text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          <IconX className="size-4.5" />
        </button>
      </div>
      <div className="px-5 pb-5 text-sm">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-raised px-5 py-3">{footer}</div>}
    </dialog>
  )
}
