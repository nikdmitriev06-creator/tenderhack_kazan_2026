import type { BatchRowResult, BatchState } from '../../api/v1.ts'

type Status = BatchRowResult['status']

/** Статус строки словом: так же он записан в файле с результатом (app/batch.py, STATUS_TEXT). */
export const STATUS_TEXT: Record<Status, string> = {
  ready: 'готово',
  needs_answer: 'нужен ответ',
  needs_fix: 'нужно исправить',
  not_found: 'нет в справочнике',
  skipped: 'пустая строка',
  failed: 'сбой',
}

export function summarize(state: BatchState): Record<Status, number> {
  const counts: Record<Status, number> = { ready: 0, needs_answer: 0, needs_fix: 0, not_found: 0, skipped: 0, failed: 0 }
  for (const r of state.rows) counts[r.status] += 1
  return counts
}

export function isFinished(state: BatchState): boolean {
  return state.status === 'done' || state.status === 'failed'
}

const JOB_STATUS: Record<BatchState['status'], string> = {
  queued: 'в очереди',
  running: 'обрабатываем',
  done: 'готово',
  failed: 'сбой',
}

/** Короткий статус файла в списке. У каждого файла свой, от выбранного не зависит. */
export function sessionStatusText(session: {
  uploading: boolean
  missing: boolean
  error: string | null
  jobId: string | null
  filename: string
  state: BatchState | null
}): string {
  if (session.uploading) return 'загружаем'
  if (session.missing) return 'не найден'
  if (session.error && !session.state) return 'ошибка'
  if (session.state) return JOB_STATUS[session.state.status]
  if (session.jobId) return 'обновляем'
  if (session.filename) return 'выбран'
  return 'новый'
}
