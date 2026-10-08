// Черновик карточки поставщика в sessionStorage вкладки. Заявка на сервере не меняется:
// после отправки «Добавить новый товар» начинает другой черновик.
import type { CheckOut, Submission, AutofillOut } from '../../api/v1.ts'
import type { Row } from './createModel.ts'

export const CREATE_DRAFT_KEY = 'create:draft'

export type DraftPhase = 'edit' | 'result'

export type CreateDraft = {
  name: string
  description: string
  phase: DraftPhase
  out: AutofillOut | null
  rows: Row[] | null
  submitted: Submission | null
  check: CheckOut | null
}

export function emptyCreateDraft(): CreateDraft {
  return {
    name: '',
    description: '',
    phase: 'edit',
    out: null,
    rows: null,
    submitted: null,
    check: null,
  }
}

export function draftIsEmpty(draft: CreateDraft): boolean {
  return (
    draft.name.trim() === '' &&
    draft.description.trim() === '' &&
    draft.out === null &&
    draft.submitted === null &&
    (draft.rows === null || draft.rows.length === 0)
  )
}

function storageOf(storage?: Storage): Storage | undefined {
  if (storage) return storage
  try {
    return globalThis.window?.sessionStorage ?? globalThis.sessionStorage
  } catch {
    return undefined
  }
}

export function loadCreateDraft(storage?: Storage): CreateDraft | null {
  try {
    const raw = storageOf(storage)?.getItem(CREATE_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CreateDraft>
    if (!parsed || typeof parsed.name !== 'string' || typeof parsed.description !== 'string') return null
    const phase = parsed.phase === 'result' ? 'result' : 'edit'
    return {
      name: parsed.name,
      description: parsed.description,
      phase,
      out: parsed.out ?? null,
      rows: Array.isArray(parsed.rows) ? parsed.rows : null,
      submitted: parsed.submitted ?? null,
      check: parsed.check ?? null,
    }
  } catch {
    return null
  }
}

export function saveCreateDraft(draft: CreateDraft | null, storage?: Storage): void {
  try {
    const box = storageOf(storage)
    if (!box) return
    if (draft === null || draftIsEmpty(draft)) box.removeItem(CREATE_DRAFT_KEY)
    else box.setItem(CREATE_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // вкладка без sessionStorage: черновик живёт, пока открыта страница
  }
}
