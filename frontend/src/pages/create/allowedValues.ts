// Ограничения характеристики из ответа API: перечень и диапазон выбранной позиции.

export type AllowedRange = { min?: number | null; max?: number | null }

export type Box = { top: number; right: number; bottom: number; left: number; width: number; height: number }

/** Уникальные непустые значения в исходном порядке. Пустой или битый перечень — пустой список. */
export function allowedOptions(values: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || value.trim() === '' || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/** Диапазон с хотя бы одной границей. Перепутанные границы и пустой объект — не диапазон. */
export function allowedRange(range: AllowedRange | null | undefined): { min: number | null; max: number | null } | null {
  if (!range || typeof range !== 'object') return null
  const min = typeof range.min === 'number' && Number.isFinite(range.min) ? range.min : null
  const max = typeof range.max === 'number' && Number.isFinite(range.max) ? range.max : null
  if (min == null && max == null) return null
  if (min != null && max != null && min > max) return null
  return { min, max }
}

export function hasConstraints(values: readonly string[] | null | undefined, range: AllowedRange | null | undefined): boolean {
  return allowedOptions(values).length > 0 || allowedRange(range) !== null
}

function formatBound(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',')
}

/** «90–175 %», «от 90 %» или «до 175 %». Нет диапазона — null. */
export function rangeLabel(range: AllowedRange | null | undefined, unit?: string | null): string | null {
  const bounds = allowedRange(range)
  if (!bounds) return null
  const unitPart = unit ? ` ${unit}` : ''
  if (bounds.min != null && bounds.max != null) return `${formatBound(bounds.min)}–${formatBound(bounds.max)}${unitPart}`
  if (bounds.min != null) return `от ${formatBound(bounds.min)}${unitPart}`
  if (bounds.max == null) return null
  return `до ${formatBound(bounds.max)}${unitPart}`
}

/** Число как его вводят в поле: «90,5» и «90.5». Текст, который не число, — null. */
export function parseLooseNumber(raw: string): number | null {
  const text = raw.trim().replace(/\s+/g, '').replace(',', '.')
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/**
 * Явное число вне диапазона. Текст, который не число, не считается выходом за диапазон:
 * ручной ввод корзины («>=80 ... <90») по-прежнему сохраняется.
 */
export function outsideRange(raw: string, range: AllowedRange | null | undefined): boolean {
  const bounds = allowedRange(range)
  if (!bounds) return false
  const n = parseLooseNumber(raw)
  if (n == null) return false
  if (bounds.min != null && n < bounds.min) return true
  if (bounds.max != null && n > bounds.max) return true
  return false
}

export function isSelectedValue(current: string | null, option: string): boolean {
  return current != null && current.trim() === option.trim()
}

/** Панель рядом с кнопкой, внутри окна. Снизу не помещается — открывается вверх. */
export function popoverPosition(
  anchor: Pick<Box, 'top' | 'right' | 'bottom' | 'left'>,
  panel: Pick<Box, 'width' | 'height'>,
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const margin = 8
  const gap = 4
  const width = Math.min(panel.width, Math.max(0, viewport.width - margin * 2))
  let left = anchor.right - width
  left = Math.max(margin, Math.min(left, viewport.width - width - margin))
  let top = anchor.bottom + gap
  const below = top + panel.height <= viewport.height - margin
  const above = anchor.top - gap - panel.height
  if (!below && above >= margin) top = above
  else top = Math.max(margin, Math.min(top, Math.max(margin, viewport.height - panel.height - margin)))
  return { top, left }
}
