import type { Issue } from '../../api/v1.ts'
import { fieldLabel } from '../create/createModel.ts'

/** Текст возврата поставщику: блокирующие замечания модуля по номерам; модератор его правит. */
export function returnNote(issues: Issue[]): string {
  return issues
    .filter((i) => i.severity === 'block')
    .map((i, n) => `${n + 1}. ${fieldLabel(i.field)}: ${i.message}`)
    .join('\n')
}

/** Номер заявки из адреса «/moderation?id=12»; иначе null. */
export function selectedId(search: string): number | null {
  const raw = new URLSearchParams(search).get('id')
  return raw && /^\d+$/.test(raw) ? Number(raw) : null
}
