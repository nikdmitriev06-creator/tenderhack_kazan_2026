import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { CREATE_DRAFT_KEY, saveCreateDraft, type CreateDraft } from './createDraft.ts'
import { CreatePage } from './CreatePage.tsx'

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

const submittedDraft = (): CreateDraft => ({
  name: 'Бумага А4 80',
  description: 'уже отправлено',
  phase: 'result',
  out: {
    session_id: 's',
    ktru: { candidates: [], remaining: 0, final_code: '17.12.14.129-TEST0001', question: null, steps: [] },
    characteristics: [],
    issues: [],
    degraded: [],
  },
  rows: [],
  submitted: {
    id: 41,
    status: 'pending',
    created_at: '2026-10-08T00:00:00Z',
    card: { name: 'Бумага А4 80', description: 'уже отправлено', characteristics: [] },
    accepted: [],
  },
  check: null,
})

test('черновик наименования остаётся после ухода со страницы', () => {
  const first = render(<CreatePage />)
  fireEvent.change(screen.getByRole('textbox', { name: /Наименование/ }), { target: { value: 'Бумага А4 80 500' } })
  fireEvent.change(screen.getByRole('textbox', { name: /Описание/ }), { target: { value: 'пачка для принтера' } })
  first.unmount()

  render(<CreatePage />)
  assert.equal((screen.getByRole('textbox', { name: /Наименование/ }) as HTMLInputElement).value, 'Бумага А4 80 500')
  assert.equal((screen.getByRole('textbox', { name: /Описание/ }) as HTMLTextAreaElement).value, 'пачка для принтера')
})

test('после заявки новый товар открывает пустую форму и не возвращает отправленный', () => {
  saveCreateDraft(submittedDraft())
  render(<CreatePage />)
  assert.match(screen.getByRole('status').textContent ?? '', /Заявка № 41/)
  fireEvent.click(screen.getByRole('button', { name: 'Добавить новый товар' }))
  assert.equal(screen.queryByRole('status'), null)
  assert.equal((screen.getByRole('textbox', { name: /Наименование/ }) as HTMLInputElement).value, '')
  const raw = sessionStorage.getItem(CREATE_DRAFT_KEY)
  assert.equal(raw === null || !raw.includes('Бумага А4 80'), true)
  assert.equal(raw === null || !raw.includes('"id":41'), true)
})
