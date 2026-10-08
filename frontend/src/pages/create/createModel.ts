// Состояние формы «Создание СТЕ» без React: решения по строкам, исправления, карточка для проверки.
import type { CardIn, CharacteristicOut, CheckOut, Issue } from '../../api/v1.ts'

/** pending — предложено модулем, accepted — принято человеком, removed — убрано. */
export type Decision = 'pending' | 'accepted' | 'removed'
export type Row = CharacteristicOut & { decision: Decision; edited: string | null }
export type Segment = { text: string; mark: boolean; key: string | null }

export function rowsFrom(chars: CharacteristicOut[]): Row[] {
  return chars.map((c) => ({ ...c, decision: 'pending', edited: null }))
}

/**
 * Новый ответ модуля (после уточняющего вопроса) поверх решений человека: принятое, исправленное
 * и убранное остаётся; строка с новым предложенным значением снова ждёт решения.
 */
export function mergeRows(prev: Row[], chars: CharacteristicOut[]): Row[] {
  const before = new Map(prev.map((r) => [r.name, r]))
  return chars.map((c) => {
    const old = before.get(c.name)
    if (old && (old.edited !== null || old.value === c.value)) return { ...c, decision: old.decision, edited: old.edited }
    return { ...c, decision: 'pending', edited: null }
  })
}

export const currentValue = (r: Row): string | null => r.edited ?? r.value

/** Текст с выделенными фрагментами; пересекающийся фрагмент пропускается, чтобы текст не дублировался. */
export function highlightSegments(text: string, spans: { start: number; end: number; key: string }[]): Segment[] {
  const sorted = spans
    .filter((s) => s.start >= 0 && s.end <= text.length && s.start < s.end)
    .sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Segment[] = []
  let at = 0
  for (const s of sorted) {
    if (s.start < at) continue
    if (s.start > at) out.push({ text: text.slice(at, s.start), mark: false, key: null })
    out.push({ text: text.slice(s.start, s.end), mark: true, key: s.key })
    at = s.end
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at), mark: false, key: null })
  return out
}

const update = (rows: Row[], name: string, patch: Partial<Row>): Row[] =>
  rows.map((r) => (r.name === name ? { ...r, ...patch } : r))

export function acceptAll(rows: Row[]): Row[] {
  return rows.map((r) =>
    r.decision === 'pending' && currentValue(r) !== null && r.status !== 'conflict' ? { ...r, decision: 'accepted' } : r,
  )
}

export function setDecision(rows: Row[], name: string, decision: Decision): Row[] {
  return update(rows, name, { decision })
}

export function editValue(rows: Row[], name: string, value: string): Row[] {
  return update(rows, name, { edited: value, decision: 'accepted' })
}

/** Ключ сравнения имён характеристик: регистр, ё→е, лишние пробелы и точка в конце. */
export function foldName(text: string): string {
  return text.trim().replace(/\.+$/u, '').replace(/\s+/gu, ' ').toLowerCase().replaceAll('ё', 'е')
}

export type KtruSpecLike = {
  name: string
  unit?: string | null
  values?: readonly string[] | null
}

export type KtruFillResult = {
  rows: Row[]
  filled: number
  kept: number
  ambiguous: number
  unmapped: number
}

function uniqueSpecValues(values: readonly string[] | null | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values ?? []) {
    const value = raw.trim()
    if (!value) continue
    const key = foldName(value)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/**
 * Подставляет в пустые строки единственное значение из спецификации КТРУ.
 * Уже введённое, принятое извлечение и убранные строки не меняются.
 * Несколько вариантов или только диапазон — строка остаётся пустой: одно значение выбрать нельзя.
 */
export function fillEmptyFromKtru(rows: Row[], specs: readonly KtruSpecLike[]): KtruFillResult {
  const byName = new Map<string, KtruSpecLike>()
  for (const spec of specs) {
    const key = foldName(spec.name)
    if (key && !byName.has(key)) byName.set(key, spec)
  }
  const used = new Set<string>()
  let filled = 0
  let kept = 0
  let ambiguous = 0
  const next = rows.map((row) => {
    const key = foldName(row.name)
    const spec = byName.get(key)
    if (spec) used.add(key)
    const hasValue = (currentValue(row)?.trim() ?? '') !== ''
    if (hasValue || row.decision === 'removed') {
      kept += 1
      return row
    }
    const only = spec ? uniqueSpecValues(spec.values) : []
    if (!spec || only.length !== 1) {
      ambiguous += 1
      return row
    }
    filled += 1
    return { ...row, edited: only[0], unit: row.unit ?? spec.unit ?? null }
  })
  let unmapped = 0
  for (const key of byName.keys()) {
    if (!used.has(key)) unmapped += 1
  }
  return { rows: next, filled, kept, ambiguous, unmapped }
}

/** Текст под кнопкой: что заполнилось и что сознательно не трогали. */
export function ktruFillMessage(result: KtruFillResult, catalogEmpty: boolean): string {
  if (catalogEmpty) return 'У этой позиции КТРУ нет характеристик для заполнения.'
  if (result.filled === 0 && result.unmapped > 0 && result.ambiguous === 0 && result.kept === 0) {
    return 'Характеристики позиции не совпали со строками карточки. Текущие значения не изменены.'
  }
  if (result.filled === 0 && result.ambiguous === 0) {
    return 'Пустых характеристик нет: уже введённые значения не изменены.'
  }
  if (result.filled === 0) {
    return 'В справочнике нет однозначного значения для пустых строк. Укажите их вручную — уже введённое сохранено.'
  }
  const parts = [`Заполнены пустые характеристики: ${result.filled}.`]
  if (result.kept > 0) parts.push('Уже введённые значения не изменены.')
  if (result.ambiguous > 0) parts.push('Остальные нельзя выбрать однозначно — укажите их вручную.')
  return parts.join(' ')
}

/** Применяет исправление из замечания к строке характеристики (поле characteristics.<имя>). */
export function applyFix(rows: Row[], issue: Issue): Row[] {
  const fix = issue.fix
  if (!fix || !issue.field.startsWith('characteristics.')) return rows
  const name = issue.field.slice('characteristics.'.length)
  return rows.map((r) => {
    if (r.name !== name) return r
    const next: Row = { ...r, decision: 'accepted' }
    if (fix.value) next.edited = fix.value
    if (fix.name) next.name = fix.name
    if (fix.unit) next.unit = fix.unit
    return next
  })
}

export function toCardIn(name: string, description: string, rows: Row[], ktruCode: string | null): CardIn {
  return {
    name,
    description,
    ktru_code: ktruCode,
    characteristics: rows
      .filter((r) => r.decision === 'accepted' && currentValue(r) !== null)
      .map((r) => ({ name: r.name, value: currentValue(r) ?? '', unit: r.unit ?? null })),
  }
}

/** Ключ, под которым «Массовая загрузка» передаёт строку в форму. */
export const PREFILL_KEY = 'create:prefill'

/**
 * Почему заявку нельзя отправить. null — сверка с КТРУ прошла.
 * `fresh` ложь, пока ответ `/check` ещё не пришёл на текущие значения.
 */
export function moderationBlock(ktruCode: string | null, check: CheckOut | null, fresh: boolean): string | null {
  if (!ktruCode) {
    return 'Позиция КТРУ не определена. Сверить характеристики нельзя, отправка на модерацию недоступна.'
  }
  const blocks = (check?.issues ?? []).filter((issue) => issue.severity === 'block')
  const unknown = check?.issues.find((issue) => issue.field === 'ktru_code')
  if (!fresh || !check) {
    if (blocks.length > 0) return blocks.map((issue) => issue.message).join(' ')
    return 'Сверяем характеристики с позицией КТРУ…'
  }
  if (unknown) return `${unknown.message} ${unknown.why}`.trim()
  if (blocks.length === 1) return `${blocks[0].message} ${blocks[0].why}`.trim()
  if (blocks.length > 1) return `Несколько характеристик противоречат КТРУ (${blocks.length}). Исправьте отмеченные строки.`
  if (check.verdict !== 'ready') return 'Карточка не готова к отправке на модерацию.'
  return null
}

export function issuesForCharacteristic(issues: readonly Issue[], name: string): Issue[] {
  const field = `characteristics.${name}`
  return issues.filter((issue) => issue.field === field && issue.severity === 'block')
}

const FIELD_PREFIX = 'characteristics.'

/** Подпись поля замечания: «characteristics.Формат» → «Формат». */
export function fieldLabel(field: string): string {
  if (field === 'name') return 'Наименование'
  if (field === 'description') return 'Описание'
  if (field === 'characteristics') return 'Характеристики'
  if (field === 'ktru_code') return 'Код КТРУ'
  return field.startsWith(FIELD_PREFIX) ? field.slice(FIELD_PREFIX.length) : field
}
