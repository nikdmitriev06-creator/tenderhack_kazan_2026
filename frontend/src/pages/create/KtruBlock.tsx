import type { KtruState } from '../../api/v1.ts'
import { cx } from '../../lib/cx'
import { plural } from '../../lib/format'
import { Skeleton } from '../../ui'
import { CONFIRM, optionLabel, questionTitle } from './ktruView.ts'

/** Блок «Категория КТРУ»: сколько позиций осталось, уточняющий вопрос или итоговый код. */
export function KtruBlock({
  state,
  loading,
  answering,
  onAnswer,
}: {
  state: KtruState | null
  loading: boolean
  answering: boolean
  onAnswer: (characteristic: string, value: string) => void
}) {
  if (loading)
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  if (!state) return <p className="text-sm text-muted">Подберём позицию по характеристикам из описания, а не только по наименованию.</p>

  const final = state.final_code ? state.candidates.find((c) => c.code === state.final_code) : null
  const question = state.question
  const confirm = question?.characteristic === CONFIRM
  return (
    <div className="flex flex-col gap-4">
      {final && (
        <div className="rise">
          <p className="font-mono text-[19px] font-medium tracking-tight" translate="no">
            {final.code}
          </p>
          <p className="mt-0.5 text-sm text-ink">{final.name}</p>
          {final.why.length > 0 && <p className="mt-1.5 text-[13px] text-muted">Совпало: {final.why.join(', ')}</p>}
        </div>
      )}

      {!final && state.remaining > 1 && (
        <p className="text-sm text-ink">
          Подходят <b className="font-semibold tabular-nums">{state.remaining}</b> {plural(state.remaining, 'позиция', 'позиции', 'позиций')}.
        </p>
      )}

      {question && (
        <fieldset className="rise" disabled={answering}>
          <legend className="text-sm font-medium text-ink">{questionTitle(question.characteristic)}</legend>
          <ul className="mt-2 divide-y divide-line rounded-(--radius-ui) border border-line">
            {question.options.map((o) => {
              const label = optionLabel(state, question.characteristic, o)
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => onAnswer(question.characteristic, o.value)}
                    className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-raised focus-visible:bg-raised disabled:opacity-60"
                  >
                    <span className="text-ink">{label.text}</span>
                    {label.hint && (
                      <span className={cx('shrink-0 text-xs text-muted', confirm ? 'font-mono' : 'tabular-nums')} translate={confirm ? 'no' : undefined}>
                        {label.hint}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </fieldset>
      )}

      {state.steps.map((s) => (
        <p key={s} className="text-sm text-warning">
          {s}
        </p>
      ))}

      {!final && !confirm && state.candidates.length > 0 && (
        <ul className="divide-y divide-line border-t border-line" aria-label="Подходящие позиции">
          {state.candidates.slice(0, 5).map((c) => (
            <li key={c.code} className="py-2">
              <span className="font-mono text-[13px]" translate="no">
                {c.code}
              </span>
              <p className="text-[13px] text-muted">{c.name}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
