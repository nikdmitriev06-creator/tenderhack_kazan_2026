import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { cx } from '../../lib/cx'
import { NBSP } from '../../lib/format'
import { Input, Skeleton } from '../../ui'
import { AllowedValues } from './AllowedValues.tsx'
import { outsideRange, rangeLabel } from './allowedValues.ts'
import { currentValue, issuesForCharacteristic, type Row } from './createModel.ts'
import type { Issue } from '../../api/v1.ts'

type Actions = {
  onAccept: (name: string) => void
  onRemove: (name: string) => void
  onRestore: (name: string) => void
  onEdit: (name: string, value: string) => void
}

/** Блок «Характеристики»: предложения модуля, решение по каждой строке — за человеком. */
export function CharacteristicsBlock({
  rows,
  loading,
  hover,
  onHover,
  degradedLlm,
  locked,
  issues = [],
  ...actions
}: {
  rows: Row[] | null
  loading: boolean
  hover: string | null
  onHover: (key: string | null) => void
  degradedLlm: boolean
  locked: boolean
  issues?: Issue[]
} & Actions) {
  if (loading)
    return (
      <div className="flex flex-col gap-3 px-5 py-4" aria-busy="true">
        {[0, 1, 2, 3, 4].map((n) => (
          <Skeleton key={n} className="h-4 w-full" />
        ))}
      </div>
    )
  if (!rows) return <p className="px-5 py-4 text-sm text-muted">Появятся после заполнения. Каждое значение будет связано с фрагментом описания.</p>
  if (rows.length === 0) return <p className="px-5 py-4 text-sm text-muted">Позиция не подобрана, заполнять нечего.</p>
  return (
    <CharacteristicsList rows={rows} hover={hover} onHover={onHover} degradedLlm={degradedLlm} locked={locked} issues={issues} {...actions} />
  )
}

function CharacteristicsList({
  rows,
  hover,
  onHover,
  degradedLlm,
  locked,
  issues,
  ...actions
}: {
  rows: Row[]
  hover: string | null
  onHover: (key: string | null) => void
  degradedLlm: boolean
  locked: boolean
  issues: Issue[]
} & Actions) {
  const names = locked ? '' : rows.map((r) => r.name).join('\0')
  const [openName, setOpenName] = useState<string | null>(null)
  const [openScope, setOpenScope] = useState(names)
  if (openScope !== names) {
    setOpenScope(names)
    if (openName !== null) setOpenName(null)
  }
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (openName == null) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpenName(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenName(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openName])

  return (
    <>
      {degradedLlm && (
        <p className="border-b border-line px-5 py-2.5 text-[13px] text-warning">
          Часть характеристик не извлечена автоматически: модель недоступна. Заполните их вручную.
        </p>
      )}
      <ul>
        {rows.map((r, i) => (
          <CharRow
            key={r.name}
            row={r}
            index={i}
            active={hover === r.name}
            onHover={onHover}
            locked={locked}
            issues={issuesForCharacteristic(issues, r.name)}
            open={openName === r.name}
            onToggle={() => setOpenName((cur) => (cur === r.name ? null : r.name))}
            anchorRef={anchorRef}
            panelRef={panelRef}
            {...actions}
          />
        ))}
      </ul>
      <p className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3 text-xs text-muted">
        <span>
          <span className="marker px-1 text-ink">маркер</span> найдено в описании
        </span>
        <span>
          <span className="text-pencil line-through">красным</span> приведено к справочнику
        </span>
      </p>
    </>
  )
}

function CharRow({
  row,
  index,
  active,
  onHover,
  locked,
  issues,
  open,
  onToggle,
  anchorRef,
  panelRef,
  onAccept,
  onRemove,
  onRestore,
  onEdit,
}: {
  row: Row
  index: number
  active: boolean
  onHover: (k: string | null) => void
  locked: boolean
  issues: Issue[]
  open: boolean
  onToggle: () => void
  anchorRef: RefObject<HTMLDivElement | null>
  panelRef: RefObject<HTMLDivElement | null>
} & Actions) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const errorId = useId()
  const removed = row.decision === 'removed'
  const shown = currentValue(row)
  const boundsLabel = rangeLabel(row.range, row.unit)
  const draftOutside = outsideRange(draft, row.range)
  return (
    <li
      onMouseEnter={() => row.source && onHover(row.name)}
      onMouseLeave={() => onHover(null)}
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
      className={cx('rise border-b border-line px-5 py-2.5 transition-colors', active && 'bg-raised')}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4">
        <p className={cx('min-w-0 text-[13px]', removed ? 'text-subtle line-through' : 'text-muted')}>
          {row.name}
          {row.required && !removed && <span className="ml-1 text-xs text-subtle">обязательная</span>}
        </p>
        <div className="flex max-w-[min(100%,20rem)] min-w-0 items-baseline justify-end gap-3 text-right text-sm break-words tabular-nums text-ink">
          {!editing && <Value row={row} />}
          {!editing && !locked && !removed && (
            <AllowedValues
              name={row.name}
              values={row.values}
              range={row.range}
              unit={row.unit}
              current={shown}
              open={open}
              onToggle={onToggle}
              onSelect={(value) => {
                onEdit(row.name, value)
                onToggle()
              }}
              anchorRef={anchorRef}
              panelRef={panelRef}
            />
          )}
        </div>
      </div>
      {row.note && row.status === 'conflict' && <p className="mt-0.5 text-xs text-pencil">{row.note}</p>}
      {issues.map((issue) => (
        <p key={`${issue.kind}-${issue.message}`} role="alert" className="mt-1 text-xs text-pencil">
          {issue.message} {issue.why}
        </p>
      ))}
      {row.method === 'llm' && !removed && <p className="mt-0.5 text-xs text-subtle">найдено моделью: проверьте</p>}
      {editing ? (
        <form
          className="mt-2 flex flex-col items-stretch gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            const next = draft.trim()
            if (!next || outsideRange(next, row.range)) return
            onEdit(row.name, next)
            setEditing(false)
          }}
        >
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Значение «${row.name}»`}
              aria-describedby={draftOutside ? errorId : undefined}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              invalid={draftOutside}
              className="h-8"
            />
            <button type="submit" className="text-[13px] font-medium text-link underline underline-offset-4">
              Сохранить
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-[13px] text-muted underline underline-offset-4">
              Отмена
            </button>
          </div>
          {draftOutside && boundsLabel && (
            <p id={errorId} role="alert" className="text-xs text-pencil">
              Вне диапазона {boundsLabel}. Укажите значение в диапазоне.
            </p>
          )}
        </form>
      ) : (
        !locked && (
          <div className="mt-1 flex flex-wrap justify-end gap-x-3 text-[13px]">
            {removed ? (
              <TextAction onClick={() => onRestore(row.name)}>Вернуть</TextAction>
            ) : (
              <>
                {row.decision === 'accepted' ? (
                  <span className="text-success">принято</span>
                ) : (
                  currentValue(row) !== null && row.status !== 'conflict' && <TextAction onClick={() => onAccept(row.name)}>Принять</TextAction>
                )}
                <TextAction
                  onClick={() => {
                    setDraft(currentValue(row) ?? '')
                    setEditing(true)
                  }}
                >
                  {currentValue(row) === null ? 'Указать' : 'Изменить'}
                </TextAction>
                <TextAction onClick={() => onRemove(row.name)}>Убрать</TextAction>
              </>
            )}
          </div>
        )
      )}
    </li>
  )
}

function TextAction({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className="text-muted underline decoration-line-strong/60 underline-offset-4 hover:text-ink">
      {children}
    </button>
  )
}

function Value({ row }: { row: Row }) {
  const unit = row.unit ? `${NBSP}${row.unit}` : ''
  const value = currentValue(row)
  if (row.edited !== null) return <span>{row.edited}{unit}</span>
  if (value === null) return <span className="text-subtle">не найдено</span>
  if (row.status === 'conflict') return <span className="text-pencil">{value}{unit}</span>
  if (row.status === 'normalized' && row.normalized_from)
    return (
      <>
        <del className="mr-2 text-xs text-pencil decoration-pencil/60">{row.normalized_from}</del>
        <span className={row.source ? 'marker px-0.5' : ''}>
          {value}
          {unit}
        </span>
      </>
    )
  return (
    <span className={row.source ? 'marker px-0.5' : ''}>
      {value}
      {unit}
    </span>
  )
}
