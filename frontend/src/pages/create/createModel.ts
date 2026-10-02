// Состояние формы «Создание СТЕ» без React: решения по строкам, исправления, карточка для проверки.
import type { CardIn, CharacteristicOut, Issue } from '../../api/v1.ts'

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

const FIELD_PREFIX = 'characteristics.'

/** Подпись поля замечания: «characteristics.Формат» → «Формат». */
export function fieldLabel(field: string): string {
  if (field === 'name') return 'Наименование'
  if (field === 'description') return 'Описание'
  if (field === 'characteristics') return 'Характеристики'
  if (field === 'ktru_code') return 'Код КТРУ'
  return field.startsWith(FIELD_PREFIX) ? field.slice(FIELD_PREFIX.length) : field
}
