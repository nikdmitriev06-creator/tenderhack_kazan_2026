import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BatchState } from '../../api/v1.ts'
import {
  acceptJob,
  addDraft,
  applyJobState,
  attachFile,
  beginWithFile,
  EMPTY_BATCHES,
  failUpload,
  fromStored,
  markUploading,
  noteJobFailure,
  pollJobIds,
  selectSession,
  toStored,
} from './batchSessions.ts'

function file(name: string): File {
  return new File(['x'], name)
}

function job(id: string, status: BatchState['status'], filename: string): BatchState {
  return { job_id: id, status, filename, total: 1, processed: status === 'done' ? 1 : 0, rows: [] }
}

test('файлы независимы: ошибка и прогресс не перетекают', () => {
  let model = beginWithFile(EMPTY_BATCHES, file('a.xlsx'))
  const a = model.selectedId as string
  model = markUploading(model, a)
  model = acceptJob(model, a, 'job-a')
  model = addDraft(model)
  const b = model.selectedId as string
  assert.notEqual(a, b)
  model = attachFile(model, b, file('b.csv'))
  model = acceptJob(model, b, 'job-b')

  model = applyJobState(model, 'job-a', job('job-a', 'running', 'a.xlsx'))
  model = noteJobFailure(model, 'job-b', 'файл не прочитан', true)

  const left = model.sessions.find((s) => s.id === a)
  const right = model.sessions.find((s) => s.id === b)
  assert.equal(left?.state?.status, 'running')
  assert.equal(left?.error, null)
  assert.equal(left?.missing, false)
  assert.equal(right?.state, null)
  assert.equal(right?.error, 'файл не прочитан')
  assert.equal(right?.missing, true)

  model = selectSession(model, a)
  assert.equal(model.selectedId, a)
  assert.equal(model.sessions.find((s) => s.id === b)?.error, 'файл не прочитан')
  assert.equal(model.sessions.find((s) => s.id === a)?.state?.status, 'running')
})

test('новый файл не заменяет уже принятый', () => {
  let model = beginWithFile(EMPTY_BATCHES, file('a.xlsx'))
  const a = model.selectedId as string
  model = acceptJob(model, a, 'job-a')
  model = applyJobState(model, 'job-a', job('job-a', 'done', 'a.xlsx'))
  model = addDraft(model)
  model = attachFile(model, model.selectedId as string, file('b.csv'))
  assert.equal(model.sessions.length, 2)
  assert.equal(model.sessions[0].jobId, 'job-a')
  assert.equal(model.sessions[0].state?.status, 'done')
  assert.equal(model.sessions[1].filename, 'b.csv')
  assert.equal(model.sessions[1].jobId, null)
})

test('повторный выбор файла не создаёт второй черновик и не трогает чужой пакет', () => {
  let model = beginWithFile(EMPTY_BATCHES, file('a.xlsx'))
  const a = model.selectedId as string
  model = acceptJob(model, a, 'job-a')
  model = addDraft(model)
  const b = model.selectedId as string
  model = attachFile(model, b, file('b.csv'))
  model = attachFile(model, b, file('c.csv'))
  model = attachFile(model, a, file('подмена.xlsx'))
  assert.equal(model.sessions.length, 2)
  assert.equal(model.sessions.find((s) => s.id === b)?.filename, 'c.csv')
  assert.equal(model.sessions.find((s) => s.id === a)?.jobId, 'job-a')
  assert.equal(model.sessions.find((s) => s.id === a)?.filename, 'a.xlsx')
})

test('сбой загрузки остаётся на своём файле', () => {
  let model = beginWithFile(EMPTY_BATCHES, file('a.xlsx'))
  const a = model.selectedId as string
  model = acceptJob(model, a, 'job-a')
  model = applyJobState(model, 'job-a', job('job-a', 'done', 'a.xlsx'))
  model = addDraft(model)
  const b = model.selectedId as string
  model = attachFile(model, b, file('b.csv'))
  model = markUploading(model, b)
  model = failUpload(model, b, 'сервис недоступен')
  assert.equal(model.sessions.find((s) => s.id === a)?.state?.status, 'done')
  assert.equal(model.sessions.find((s) => s.id === a)?.error, null)
  assert.equal(model.sessions.find((s) => s.id === b)?.uploading, false)
  assert.equal(model.sessions.find((s) => s.id === b)?.error, 'сервис недоступен')
  assert.equal(model.sessions.find((s) => s.id === b)?.file?.name, 'b.csv')
})

test('опрос идёт только по незавершённым пакетам', () => {
  let model = beginWithFile(EMPTY_BATCHES, file('a.xlsx'))
  const a = model.selectedId as string
  model = acceptJob(model, a, 'job-a')
  model = applyJobState(model, 'job-a', job('job-a', 'done', 'a.xlsx'))
  model = addDraft(model)
  const b = model.selectedId as string
  model = attachFile(model, b, file('b.csv'))
  model = acceptJob(model, b, 'job-b')
  model = applyJobState(model, 'job-b', job('job-b', 'running', 'b.csv'))
  model = addDraft(model)
  assert.deepEqual(pollJobIds(model.sessions), ['job-b'])
})

test('в хранилище вкладки попадают только принятые пакеты, без файла и строк', () => {
  let model = beginWithFile(EMPTY_BATCHES, file('a.xlsx'))
  const a = model.selectedId as string
  model = acceptJob(model, a, 'job-a')
  model = applyJobState(model, 'job-a', job('job-a', 'running', 'a.xlsx'))
  model = addDraft(model)
  model = attachFile(model, model.selectedId as string, file('черновик.csv'))
  const stored = toStored(model)
  assert.deepEqual(stored.items, [{ id: a, jobId: 'job-a', filename: 'a.xlsx' }])
  assert.equal(stored.selectedId, a)

  const restored = fromStored(stored)
  assert.equal(restored.sessions.length, 1)
  assert.equal(restored.sessions[0].file, null)
  assert.equal(restored.sessions[0].state, null)
  assert.equal(restored.sessions[0].jobId, 'job-a')
  assert.equal(restored.selectedId, a)
})

test('ответ чужого job_id ничего не меняет', () => {
  let model = beginWithFile(EMPTY_BATCHES, file('a.xlsx'))
  const a = model.selectedId as string
  model = acceptJob(model, a, 'job-a')
  const before = model.sessions[0]
  model = applyJobState(model, 'job-нет', job('job-нет', 'done', 'чужой.xlsx'))
  assert.equal(model.sessions[0], before)
})
