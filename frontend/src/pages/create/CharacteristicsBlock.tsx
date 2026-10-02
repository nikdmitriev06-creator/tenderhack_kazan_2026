import { useState } from 'react'
import { cx } from '../../lib/cx'
import { NBSP } from '../../lib/format'
import { Input, Skeleton } from '../../ui'
import { currentValue, type Row } from './createModel.ts'

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
  ...actions
}: {
  rows: Row[] | null
  loading: boolean
  hover: string | null
  onHover: (key: string | null) => void
  degradedLlm: boolean
  locked: boolean
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
    <>
      {degradedLlm && (
        <p className="border-b border-line px-5 py-2.5 text-[13px] text-warning">
          Часть характеристик не извлечена автоматически: модель недоступна. Заполните их вручную.
        </p>
      )}
      <ul>
        {rows.map((r, i) => (
          <CharRow key={r.name} row={r} index={i} active={hover === r.name} onHover={onHover} locked={locked} {...actions} />
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
  onAccept,
  onRemove,
  onRestore,
  onEdit,
}: { row: Row; index: number; active: boolean; onHover: (k: string | null) => void; locked: boolean } & Actions) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const removed = row.decision === 'removed'
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
        <div className="text-right text-sm tabular-nums text-ink">{!editing && <Value row={row} />}</div>
      </div>
      {row.note && row.status === 'conflict' && <p className="mt-0.5 text-xs text-pencil">{row.note}</p>}
      {row.method === 'llm' && !removed && <p className="mt-0.5 text-xs text-subtle">найдено моделью: проверьте</p>}
      {editing ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (draft.trim()) onEdit(row.name, draft.trim())
            setEditing(false)
          }}
        >
          <Input aria-label={`Значение «${row.name}»`} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus className="h-8" />
          <button type="submit" className="text-[13px] font-medium text-link underline underline-offset-4">
            Сохранить
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-[13px] text-muted underline underline-offset-4">
            Отмена
          </button>
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
