import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import type { BatchState } from '../../api/v1.ts'
import { BatchPage } from './BatchPage.tsx'
import { reloadBatchSessions, resetBatchSessions } from './batchStore.ts'

type Job = BatchState

const jobs = new Map<string, Job | { error: string; status: number }>()

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  jobs.clear()
  resetBatchSessions()
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (init?.method === 'POST' && url.endsWith('/api/v1/batch')) {
      const body = init.body as FormData
      const file = body.get('file') as File
      if (file.name.startsWith('bad')) return json({ detail: 'файл не прочитан' }, 400)
      const id = `job-${jobs.size + 1}`
      const state: Job = {
        job_id: id,
        status: 'running',
        filename: file.name,
        total: 1,
        processed: 0,
        rows: [{ row: 1, name: `строка ${file.name}`, status: 'ready', ktru_code: null, filled: 0, issues: [] }],
      }
      jobs.set(id, state)
      return json({ job_id: id, status_url: `/api/v1/batch/${id}` })
    }
    const match = url.match(/\/api\/v1\/batch\/([^/]+)$/)
    if (match) {
      const found = jobs.get(decodeURIComponent(match[1]))
      if (!found) return json({ detail: 'пакет не найден' }, 404)
      if ('error' in found) return json({ detail: found.error }, found.status)
      return json(found)
    }
    return json({ detail: 'нет' }, 404)
  }
})

afterEach(() => {
  cleanup()
  resetBatchSessions()
})

function pick(name: string) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  const chosen = new File(['a,b'], name, { type: 'text/csv' })
  fireEvent.change(input, { target: { files: [chosen] } })
}

test('файл остаётся после размонтирования и не мешает второму', async () => {
  const first = render(<BatchPage />)
  pick('a.xlsx')
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }))
  await waitFor(() => {
    assert.ok(screen.getByRole('tab', { name: /a\.xlsx/ }))
    assert.ok(screen.getByText('строка a.xlsx'))
  })

  first.unmount()
  render(<BatchPage />)
  assert.ok(screen.getByRole('tab', { name: /a\.xlsx/ }))
  assert.ok(screen.getByText('строка a.xlsx'))

  fireEvent.click(screen.getByRole('button', { name: 'Добавить файл' }))
  pick('b.csv')
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }))
  await waitFor(() => {
    assert.ok(screen.getByRole('tab', { name: /b\.csv/ }))
    assert.ok(screen.getByText('строка b.csv'))
  })

  fireEvent.click(screen.getByRole('tab', { name: /a\.xlsx/ }))
  assert.ok(screen.getByText('строка a.xlsx'))
  assert.equal(screen.queryByText('строка b.csv'), null)

  fireEvent.click(screen.getByRole('tab', { name: /b\.csv/ }))
  assert.ok(screen.getByText('строка b.csv'))
  assert.equal(screen.queryByText('строка a.xlsx'), null)
})

test('ошибка одного файла не стирает другой', async () => {
  render(<BatchPage />)
  pick('a.xlsx')
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }))
  await waitFor(() => screen.getByText('строка a.xlsx'))

  fireEvent.click(screen.getByRole('button', { name: 'Добавить файл' }))
  pick('bad.csv')
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }))
  await waitFor(() => screen.getByText('файл не прочитан'))

  fireEvent.click(screen.getByRole('tab', { name: /a\.xlsx/ }))
  assert.ok(screen.getByText('строка a.xlsx'))
  assert.equal(screen.queryByText('файл не прочитан'), null)
  assert.ok(screen.getByRole('tab', { name: /bad\.csv/ }))
})

test('обновление вкладки поднимает принятые пакеты и дочитывает состояние', async () => {
  const first = render(<BatchPage />)
  pick('a.xlsx')
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }))
  await waitFor(() => screen.getByText('строка a.xlsx'))
  const saved = jobs.get('job-1') as Job
  saved.status = 'done'
  saved.processed = 1

  first.unmount()
  reloadBatchSessions()
  render(<BatchPage />)
  await waitFor(() => screen.getByText('Скачать файл с результатом'))
  assert.ok(screen.getByRole('tab', { name: /a\.xlsx/ }))
})
