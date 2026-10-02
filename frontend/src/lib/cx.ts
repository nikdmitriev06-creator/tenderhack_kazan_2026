/** Склеивает классы, пропуская пустые значения: cx('a', flag && 'b'). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
