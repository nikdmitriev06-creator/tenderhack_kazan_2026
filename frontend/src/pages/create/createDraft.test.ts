import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CREATE_DRAFT_KEY, draftIsEmpty, emptyCreateDraft, loadCreateDraft, saveCreateDraft, type CreateDraft } from './createDraft.ts'

function memory(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  }
}

test('черновик переживает повторное чтение', () => {
  const box = memory()
  const draft: CreateDraft = {
    ...emptyCreateDraft(),
    name: 'Бумага А4',
    description: '80 г/м², 500 листов',
    phase: 'edit',
  }
  saveCreateDraft(draft, box)
  assert.deepEqual(loadCreateDraft(box)?.name, 'Бумага А4')
  assert.equal(loadCreateDraft(box)?.description, draft.description)
})

test('пустой черновик не остаётся в хранилище', () => {
  const box = memory()
  saveCreateDraft({ ...emptyCreateDraft(), name: 'черновик' }, box)
  saveCreateDraft(null, box)
  assert.equal(box.getItem(CREATE_DRAFT_KEY), null)
  assert.equal(draftIsEmpty(emptyCreateDraft()), true)
})

test('новый товар не возвращает отправленную заявку', () => {
  const box = memory()
  const submitted: CreateDraft = {
    ...emptyCreateDraft(),
    name: 'Первый',
    phase: 'result',
    submitted: {
      id: 1,
      status: 'pending',
      created_at: '2026-10-08T00:00:00Z',
      card: { name: 'Первый', description: '', characteristics: [] },
      accepted: [],
    },
  }
  saveCreateDraft(submitted, box)
  saveCreateDraft(null, box)
  const fresh = emptyCreateDraft()
  saveCreateDraft(fresh, box)
  assert.equal(loadCreateDraft(box), null)
  const next: CreateDraft = { ...emptyCreateDraft(), name: 'Второй' }
  saveCreateDraft(next, box)
  const loaded = loadCreateDraft(box)
  assert.equal(loaded?.name, 'Второй')
  assert.equal(loaded?.submitted, null)
  assert.notEqual(loaded?.name, 'Первый')
})
