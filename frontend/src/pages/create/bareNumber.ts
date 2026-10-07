// Рекомендация, не проверка: число в наименовании или описании без единицы рядом.
// Ложные срабатывания дороже пропуска — коды, стандарты, модели и размеры с единицей молчат.

const UNIT_WORDS = new Set([
  'мм',
  'миллиметр',
  'миллиметра',
  'миллиметров',
  'см',
  'сантиметр',
  'сантиметра',
  'сантиметров',
  'мкм',
  'микрон',
  'микрона',
  'микрометр',
  'км',
  'километр',
  'километра',
  'километров',
  'м',
  'метр',
  'метра',
  'метров',
  'кг',
  'килограмм',
  'килограмма',
  'килограммов',
  'мг',
  'миллиграмм',
  'г',
  'гр',
  'грамм',
  'грамма',
  'граммов',
  'т',
  'тонна',
  'тонны',
  'тонн',
  'мл',
  'миллилитр',
  'миллилитра',
  'миллилитров',
  'л',
  'литр',
  'литра',
  'литров',
  'шт',
  'штука',
  'штуки',
  'штук',
  'лист',
  'листа',
  'листов',
  'пач',
  'пачка',
  'пачки',
  'пачек',
  'уп',
  'упак',
  'упаковка',
  'упаковки',
  'упаковок',
  'рул',
  'рулон',
  'рулона',
  'рулонов',
  'пар',
  'пара',
  'пары',
  'компл',
  'комплект',
  'комплекта',
  'комплектов',
  '%',
  'процент',
  'процента',
  'процентов',
  'м2',
  'м3',
  'г/м2',
  'г/м²',
  'год',
  'года',
  'году',
  'годах',
  'лет',
  'вольт',
  'вольта',
  'вольтов',
  'вт',
  'ватт',
  'квт',
  'киловатт',
])

const MARKERS = new Set([
  'гост',
  'госта',
  'госту',
  'ост',
  'ту',
  'iso',
  'din',
  'en',
  'сто',
  'артикул',
  'арт',
  'модель',
  'мод',
  'sku',
  'код',
  'серия',
  'маркировка',
  'номер',
  'no',
  '№',
  '#',
])

const NUMBER_RE = /\d+(?:[.,]\d+)?/gu

function isUnitToken(token: string): boolean {
  if (token === 'В') return true
  const normalized = token
    .replace(/\.+$/u, '')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replaceAll('²', '2')
    .replaceAll('³', '3')
  return UNIT_WORDS.has(normalized)
}

function wordsBefore(text: string, index: number): string[] {
  return text.slice(0, index).match(/[\p{L}\d№#]+/gu) ?? []
}

function introducedByMarker(text: string, index: number): boolean {
  const words = wordsBefore(text, index)
  const last = words.at(-1)
  if (!last) return false
  if (MARKERS.has(last.toLowerCase().replace(/\.$/u, ''))) return true
  const prev = words.at(-2)
  return Boolean(last.length === 1 && prev && MARKERS.has(prev.toLowerCase().replace(/\.$/u, '')))
}

function dottedCluster(text: string, start: number, end: number): { code: boolean; end: number } {
  let a = start
  let b = end
  while (a > 0 && /[\d.]/u.test(text[a - 1] ?? '')) a -= 1
  while (b < text.length && /[\d.]/u.test(text[b] ?? '')) b += 1
  const cluster = text.slice(a, b)
  return { code: (cluster.match(/\./gu) ?? []).length >= 2, end: b }
}

function modelAffix(text: string, start: number, end: number): boolean {
  const prev = text[start - 1]
  if (prev && /\p{L}/u.test(prev)) return true
  if ((prev === '-' || prev === '–' || prev === '—') && text[start - 2] && /\p{L}/u.test(text[start - 2])) return true
  const next = text[end]
  if (next === '-' || next === '–' || next === '—') {
    const after = text[end + 1]
    if (after && /\p{L}/u.test(after)) return true
  }
  if (next && /\p{L}/u.test(next)) {
    const suffix = /^[\p{L}μµ%²³]+/u.exec(text.slice(end))?.[0] ?? ''
    if (!suffix || !isUnitToken(suffix)) return true
  }
  if ((prev === '/' && /\d/u.test(text[start - 2] ?? '')) || (next === '/' && /\d/u.test(text[end + 1] ?? ''))) return true
  return false
}

function dimension(text: string, start: number, end: number): boolean {
  return /[xх×*]\s*$/iu.test(text.slice(0, start)) || /^\s*[xх×*]\s*\d/iu.test(text.slice(end))
}

/** Хвост кода вроде «17.12.14.129-00000031» и длинный артикул без единицы. */
function articleNumber(text: string, start: number, raw: string): boolean {
  const digits = raw.replace(/\D/gu, '')
  if (digits.length >= 6) return true
  const prev = text[start - 1]
  if (prev !== '-' && prev !== '–' && prev !== '—') return false
  let head = start - 1
  while (head > 0 && /[\d.]/u.test(text[head - 1] ?? '')) head -= 1
  const prefix = text.slice(head, start - 1)
  return (prefix.match(/\./gu) ?? []).length >= 2 || prefix.replace(/\D/gu, '').length >= 4
}

function extendCompound(text: string, end: number): number {
  let cursor = end
  const range = /^\s*[-–—]\s*\d+(?:[.,]\d+)?/u.exec(text.slice(cursor))
  if (range) cursor += range[0].length
  for (let n = 0; n < 2; n += 1) {
    const thousands = /^(?:[ \t\u00a0])(\d{3})(?!\d)/u.exec(text.slice(cursor))
    if (!thousands) break
    cursor += thousands[0].length
  }
  return cursor
}

function hasUnitAfter(text: string, from: number): boolean {
  const tail = text.slice(from).replace(/^[\s,;:.»"'()\-–—]+/u, '')
  const tokens = tail.split(/[\s,;:()«»"'./]+/u).filter(Boolean).slice(0, 3)
  return tokens.some((token) => isUnitToken(token))
}

/** Числа, рядом с которыми не видно единицы, кода, стандарта или модели. */
export function bareQuantities(text: string): string[] {
  const found: string[] = []
  let covered = 0
  for (const match of text.matchAll(NUMBER_RE)) {
    const raw = match[0]
    const start = match.index ?? 0
    if (start < covered) continue
    const end = start + raw.length
    const dotted = dottedCluster(text, start, end)
    if (dotted.code) {
      covered = dotted.end
      continue
    }
    const compoundEnd = extendCompound(text, end)
    const skip =
      modelAffix(text, start, end) ||
      dimension(text, start, end) ||
      articleNumber(text, start, raw) ||
      introducedByMarker(text, start) ||
      hasUnitAfter(text, compoundEnd)
    covered = compoundEnd
    if (!skip) found.push(raw)
  }
  return found
}

/** Текст рекомендации или null, если предупреждать не о чем. */
export function quantityAdvice(text: string): string | null {
  const bare = bareQuantities(text)
  if (bare.length === 0) return null
  const subject = bare.length > 1 ? 'числа' : 'число'
  return `Для более точной обработки лучше указать, что означает ${subject}, например: «${bare[0]} штук».`
}
