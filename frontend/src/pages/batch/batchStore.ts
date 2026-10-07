import { useSyncExternalStore } from 'react'
import { ApiError } from '../../api/http.ts'
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
  selectSession,
  toStored,
  type BatchModel,
  type StoredBatches,
} from './batchSessions.ts'

const STORAGE_KEY = 'batch:sessions'

const listeners = new Set<() => void>()

/** sessionStorage вкладки. В тестах jsdom он лежит на window, не на globalThis. */
function browserStorage(): Storage | undefined {
  try {
    const fromWindow = globalThis.window?.sessionStorage
    if (fromWindow) return fromWindow
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

let snapshot: BatchModel = readStorage()

function readStorage(): BatchModel {
  try {
    const raw = browserStorage()?.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_BATCHES
    const parsed = JSON.parse(raw) as StoredBatches
    if (!parsed || !Array.isArray(parsed.items)) return EMPTY_BATCHES
    const items = parsed.items.filter((item) => item && typeof item.id === 'string' && typeof item.jobId === 'string')
    return fromStored({ selectedId: typeof parsed.selectedId === 'string' ? parsed.selectedId : null, items })
  } catch {
    return EMPTY_BATCHES
  }
}

function writeStorage(model: BatchModel) {
  try {
    const stored = toStored(model)
    const storage = browserStorage()
    if (!storage) return
    if (stored.items.length === 0) storage.removeItem(STORAGE_KEY)
    else storage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // вкладка без sessionStorage: список всё равно живёт в памяти до перезагрузки
  }
}

function commit(next: BatchModel) {
  snapshot = next
  writeStorage(next)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getBatchSnapshot(): BatchModel {
  return snapshot
}

export function useBatchSessions(): BatchModel {
  return useSyncExternalStore(subscribe, getBatchSnapshot, getBatchSnapshot)
}

export function addBatchDraft() {
  commit(addDraft(snapshot))
}

export function selectBatch(id: string) {
  commit(selectSession(snapshot, id))
}

export function pickBatchFile(id: string | null, file: File) {
  if (id && snapshot.sessions.some((s) => s.id === id && !s.jobId)) commit(attachFile(snapshot, id, file))
  else commit(beginWithFile(snapshot, file))
}

export async function uploadBatchSession(id: string, send: (file: File) => Promise<{ job_id: string }>) {
  const current = snapshot.sessions.find((s) => s.id === id)
  if (!current?.file || current.jobId || current.uploading) return
  commit(markUploading(snapshot, id))
  try {
    const accepted = await send(current.file)
    commit(acceptJob(getBatchSnapshot(), id, accepted.job_id))
  } catch (e) {
    const message = e instanceof ApiError ? e.detail : 'не удалось загрузить файл'
    commit(failUpload(getBatchSnapshot(), id, message))
  }
}

export function applyBatchJobState(jobId: string, state: Parameters<typeof applyJobState>[2]) {
  commit(applyJobState(getBatchSnapshot(), jobId, state))
}

export function noteBatchJobFailure(jobId: string, error: string, terminal: boolean) {
  commit(noteJobFailure(getBatchSnapshot(), jobId, error, terminal))
}

/** Сбросить память и прочитать список пакетов вкладки заново. Нужно после обновления страницы и в тестах. */
export function reloadBatchSessions() {
  snapshot = readStorage()
  for (const listener of listeners) listener()
}

export function resetBatchSessions() {
  try {
    browserStorage()?.removeItem(STORAGE_KEY)
  } catch {
    // нет хранилища
  }
  snapshot = EMPTY_BATCHES
  for (const listener of listeners) listener()
}
