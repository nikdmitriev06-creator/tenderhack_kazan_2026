import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BatchRowResult, BatchState } from '../../api/v1.ts'
import { STATUS_TEXT, isFinished, sessionStatusText, summarize } from './batchView.ts'

const row = (status: BatchRowResult['status'], n: number): BatchRowResult => ({
  row: n,
  name: `строка ${n}`,
  status,
  ktru_code: null,
  filled: 0,
  issues: [],
})

const state = (rows: BatchRowResult[], status: BatchState['status'] = 'done'): BatchState => ({
  job_id: 'j',
  status,
  filename: 'f.xlsx',
  total: rows.length,
  processed: rows.length,
  rows,
})

test('сводка считает строки по статусам', () => {
  const s = summarize(state([row('ready', 1), row('ready', 2), row('needs_answer', 3), row('needs_fix', 4), row('skipped', 5), row('failed', 6), row('not_found', 7)]))
  assert.deepEqual(s, { ready: 2, needs_answer: 1, needs_fix: 1, not_found: 1, skipped: 1, failed: 1 })
})

test('у каждого статуса есть слово для человека', () => {
  for (const key of ['ready', 'needs_answer', 'needs_fix', 'not_found', 'skipped', 'failed'] as const) assert.ok(STATUS_TEXT[key]?.length > 0)
})

test('статус файла не зависит от того, выбран ли он', () => {
  const base = { uploading: false, missing: false, error: null, jobId: 'j', filename: 'a.xlsx', state: state([row('ready', 1)], 'running') }
  assert.equal(sessionStatusText(base), 'обрабатываем')
  assert.equal(sessionStatusText({ ...base, state: state([], 'done') }), 'готово')
  assert.equal(sessionStatusText({ ...base, state: null, uploading: true, jobId: null }), 'загружаем')
  assert.equal(sessionStatusText({ ...base, state: null, jobId: null, filename: '', error: 'сеть' }), 'ошибка')
  assert.equal(sessionStatusText({ ...base, state: state([], 'done'), missing: true }), 'не найден')
})

test('опрос останавливается на done и failed', () => {
  assert.equal(isFinished(state([], 'running')), false)
  assert.equal(isFinished(state([], 'queued')), false)
  assert.equal(isFinished(state([], 'done')), true)
  assert.equal(isFinished(state([], 'failed')), true)
})
