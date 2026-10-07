import type { BatchState } from '../../api/v1.ts'
import { isFinished } from './batchView.ts'

/** Один загруженный файл. `id` стабилен; `jobId` — идентификатор пакета на сервере, когда загрузка принята. */
export type BatchSession = {
  id: string
  jobId: string | null
  filename: string
  file: File | null
  state: BatchState | null
  error: string | null
  uploading: boolean
  /** 404: пакет истёк или не найден, опрашивать больше не нужно. */
  missing: boolean
}

export type BatchModel = {
  sessions: BatchSession[]
  selectedId: string | null
}

export const EMPTY_BATCHES: BatchModel = { sessions: [], selectedId: null }

export function sessionById(model: BatchModel, id: string | null): BatchSession | null {
  if (!id) return null
  return model.sessions.find((s) => s.id === id) ?? null
}

function draft(file: File | null): BatchSession {
  return {
    id: crypto.randomUUID(),
    jobId: null,
    filename: file?.name ?? '',
    file,
    state: null,
    error: null,
    uploading: false,
    missing: false,
  }
}

/** «Добавить файл»: новый черновик становится выбранным, остальные не меняются. */
export function addDraft(model: BatchModel): BatchModel {
  const session = draft(null)
  return { sessions: [...model.sessions, session], selectedId: session.id }
}

/** Первый выбранный файл, когда списка ещё нет. */
export function beginWithFile(model: BatchModel, file: File): BatchModel {
  const session = draft(file)
  return { sessions: [...model.sessions, session], selectedId: session.id }
}

/** Подмена файла только у черновика. Уже принятый пакет не перезаписывается. */
export function attachFile(model: BatchModel, id: string, file: File): BatchModel {
  return {
    ...model,
    sessions: model.sessions.map((s) =>
      s.id === id && !s.jobId && !s.uploading ? { ...s, file, filename: file.name, error: null } : s,
    ),
  }
}

export function selectSession(model: BatchModel, id: string): BatchModel {
  if (!model.sessions.some((s) => s.id === id)) return model
  return { ...model, selectedId: id }
}

export function markUploading(model: BatchModel, id: string): BatchModel {
  return {
    ...model,
    sessions: model.sessions.map((s) => (s.id === id && s.file && !s.jobId ? { ...s, uploading: true, error: null } : s)),
  }
}

export function acceptJob(model: BatchModel, id: string, jobId: string): BatchModel {
  return {
    ...model,
    sessions: model.sessions.map((s) =>
      s.id === id ? { ...s, jobId, uploading: false, error: null, file: null, missing: false } : s,
    ),
  }
}

export function failUpload(model: BatchModel, id: string, error: string): BatchModel {
  return {
    ...model,
    sessions: model.sessions.map((s) => (s.id === id ? { ...s, uploading: false, error } : s)),
  }
}

function mapJob(model: BatchModel, jobId: string, update: (s: BatchSession) => BatchSession): BatchModel {
  return {
    ...model,
    sessions: model.sessions.map((s) => (s.jobId === jobId ? update(s) : s)),
  }
}

/** Ответ опроса пишется только в сессию с этим job_id. Выбор и остальные файлы не трогаем. */
export function applyJobState(model: BatchModel, jobId: string, state: BatchState): BatchModel {
  return mapJob(model, jobId, (s) => ({
    ...s,
    state,
    error: null,
    missing: false,
    filename: s.filename || state.filename,
  }))
}

export function noteJobFailure(model: BatchModel, jobId: string, error: string, terminal: boolean): BatchModel {
  return mapJob(model, jobId, (s) => ({
    ...s,
    error: s.state && !terminal ? s.error : error,
    missing: terminal || s.missing,
  }))
}

export function pollJobIds(sessions: BatchSession[]): string[] {
  const ids = sessions.flatMap((s) => {
    if (!s.jobId || s.missing) return []
    if (s.state && isFinished(s.state)) return []
    return [s.jobId]
  })
  return [...new Set(ids)].sort()
}

type StoredItem = { id: string; jobId: string; filename: string }

export type StoredBatches = { selectedId: string | null; items: StoredItem[] }

/** В хранилище вкладки — только принятые пакеты: File и строки результата живут в памяти и на сервере. */
export function toStored(model: BatchModel): StoredBatches {
  const items = model.sessions.flatMap((s) => (s.jobId ? [{ id: s.id, jobId: s.jobId, filename: s.filename }] : []))
  const selectedId = items.some((i) => i.id === model.selectedId) ? model.selectedId : (items[0]?.id ?? null)
  return { selectedId, items }
}

export function fromStored(stored: StoredBatches): BatchModel {
  const sessions: BatchSession[] = stored.items.map((item) => ({
    id: item.id,
    jobId: item.jobId,
    filename: item.filename,
    file: null,
    state: null,
    error: null,
    uploading: false,
    missing: false,
  }))
  const selectedId = sessions.some((s) => s.id === stored.selectedId) ? stored.selectedId : (sessions[0]?.id ?? null)
  return { sessions, selectedId }
}
