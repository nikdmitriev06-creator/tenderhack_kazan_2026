// Подписи уточняющего вопроса: служебные значения модуля (app/narrowing.py) — словами для человека.
import type { KtruState, Option } from '../../api/v1.ts'

/** Вариант «ни одна позиция не подходит» — честный отказ вместо выбора наугад. */
export const NOTHING_FITS = '__nothing__'
/** Вопрос-подтверждение позиции: в наименовании есть слова, которых нет у кандидатов. */
export const CONFIRM = 'Позиция КТРУ'
/** Вариант «у товара нет такой характеристики». */
const NONE = ''

export function questionTitle(characteristic: string): string {
  return characteristic === CONFIRM ? 'Подтвердите позицию КТРУ' : `Уточните «${characteristic}»`
}

export function optionLabel(state: KtruState, characteristic: string, o: Option): { text: string; hint: string | null } {
  if (o.value === NOTHING_FITS) return { text: 'Ничего не подходит', hint: null }
  if (characteristic === CONFIRM) {
    const position = state.candidates.find((c) => c.code === o.value)
    return { text: position?.name ?? o.value, hint: o.value }
  }
  return { text: o.value === NONE ? 'Нет такой характеристики' : o.value, hint: `останется ${o.remaining}, отсечёт ${o.cuts}` }
}
