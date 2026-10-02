/*
 * Данные прототипа: результат примера «Недопустимое значение» с живого стенда, 02.10.2026.
 * Когда экран переедет на API, их заменит ответ /api/v1/autofill.
 */

export const BRAND = { name: 'Stencil' }

/** Цвет портала zakupki.mos.ru, снят с живых страниц. */
export const PORTAL_BLUE = '#264b82'
export const MARK = '#ffe98f'

export const SAMPLE = {
  name: 'Бумага офисная Туринский ЦБЗ цветная А4 500л',
  description: ['Интенсивность цвета: Белый', 'Масса бумаги площадью 1 м2, г 80', 'Количество листов в пачке А4 500'],
  ktru: {
    code: '17.12.14.129-00000017',
    name: 'Бумага для офисной техники цветная',
  },
}

export type Segment = { text: string; mark: boolean }

/** Текст по кускам: найденные значения помечены, остальное как есть. */
export function segments(text: string, marks: string[]): Segment[] {
  const out: Segment[] = []
  let rest = text
  while (rest) {
    const hits = marks.map((m) => ({ m, i: rest.indexOf(m) })).filter((h) => h.i >= 0)
    if (!hits.length) {
      out.push({ text: rest, mark: false })
      break
    }
    const first = hits.reduce((a, b) => (b.i < a.i ? b : a))
    if (first.i > 0) out.push({ text: rest.slice(0, first.i), mark: false })
    out.push({ text: first.m, mark: true })
    rest = rest.slice(first.i + first.m.length)
  }
  return out
}
