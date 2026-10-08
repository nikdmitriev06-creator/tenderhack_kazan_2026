import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import App from '../../App.tsx'
import type { AutofillOut } from '../../api/v1.ts'
import { saveCreateDraft, type CreateDraft } from './createDraft.ts'
import { CreatePage } from './CreatePage.tsx'
import type { Row } from './createModel.ts'

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

const autofill: AutofillOut = {
  session_id: 's',
  ktru: { candidates: [], remaining: 0, final_code: '17.12.14.129-00000102', question: null, steps: [] },
  characteristics: [
    { name: 'Формат', value: 'A4', unit: null, source: null, status: 'filled', required: true, values: ['A4'], range: null },
  ],
  issues: [],
  degraded: [],
}

const row = (value: string): Row => ({
  name: 'Формат',
  value,
  unit: null,
  source: null,
  status: 'filled',
  required: true,
  values: ['A4', 'A3'],
  range: null,
  decision: 'accepted',
  edited: null,
})

const block = {
  field: 'characteristics.Формат',
  kind: 'not_in_list' as const,
  severity: 'block' as const,
  message: 'Значение «Формат» противоречит КТРУ. Сейчас: «A5». Ожидается: A4.',
  why: 'в перечне A3, A4',
  rule: 'r',
  fix: null,
}

test('прямой адрес открывает характеристики этой строки', async () => {
  window.history.replaceState(null, '', '/?section=characteristics&name=Бумага%20А4&job=job-9&row=3#characteristics')
  let fills = 0
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/v1/autofill') && init?.method === 'POST') {
      fills += 1
      const body = JSON.parse(String(init.body)) as { name: string }
      assert.equal(body.name, 'Бумага А4')
      return json(autofill)
    }
    if (url.endsWith('/api/v1/check')) return json({ issues: [], verdict: 'ready' })
    return json({ detail: 'нет' }, 404)
  }
  render(<CreatePage />)
  assert.ok(document.getElementById('characteristics'))
  await waitFor(() => screen.getByText('Формат'))
  assert.ok(screen.getAllByText('Бумага А4').length > 0)
  assert.equal(fills, 1)
})

test('обновление страницы характеристик не запрашивает заполнение заново', async () => {
  window.history.replaceState(null, '', '/?section=characteristics&name=Бумага%20А4&job=job-9&row=3#characteristics')
  const draft: CreateDraft = {
    name: 'Бумага А4',
    description: '',
    phase: 'result',
    out: autofill,
    rows: [row('A4')],
    submitted: null,
    check: { issues: [], verdict: 'ready' },
  }
  saveCreateDraft(draft)
  let fills = 0
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/api/v1/autofill')) {
      fills += 1
      return json(autofill)
    }
    if (url.endsWith('/api/v1/check')) return json({ issues: [], verdict: 'ready' })
    return json({ detail: 'нет' }, 404)
  }
  const first = render(<CreatePage />)
  assert.equal(fills, 0)
  assert.ok(document.getElementById('characteristics'))
  assert.ok(screen.getByText('A4'))
  first.unmount()
  render(<CreatePage />)
  assert.equal(fills, 0)
  assert.ok(screen.getByText('A4'))
  assert.ok(document.getElementById('characteristics'))
})

test('назад и вперёд возвращают ту же карточку', async () => {
  window.history.replaceState(null, '', '/batch')
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/v1/autofill') && init?.method === 'POST') return json(autofill)
    if (url.endsWith('/api/v1/check')) return json({ issues: [], verdict: 'ready' })
    return json({ detail: 'нет' }, 404)
  }
  render(<App />)
  assert.ok(screen.getByRole('heading', { name: 'Массовая загрузка' }))
  const href = '/?section=characteristics&name=Бумага%20А4&job=job-9&row=3#characteristics'
  window.history.pushState(null, '', href)
  window.dispatchEvent(new PopStateEvent('popstate'))
  await screen.findByText('Формат')
  assert.ok(screen.getAllByText('Бумага А4').length > 0)
  window.history.pushState(null, '', '/batch')
  window.dispatchEvent(new PopStateEvent('popstate'))
  await screen.findByRole('heading', { name: 'Массовая загрузка' })
  window.history.pushState(null, '', href)
  window.dispatchEvent(new PopStateEvent('popstate'))
  await screen.findByText('Формат')
  assert.match(window.location.search, /job=job-9/)
  assert.match(window.location.search, /row=3/)
  assert.ok(document.getElementById('characteristics'))
})

test('противоречие КТРУ держит отправку, исправление её открывает', async () => {
  const draft: CreateDraft = {
    name: 'Бумага А4',
    description: '',
    phase: 'result',
    out: autofill,
    rows: [{ ...row('A5'), value: 'A5' }],
    submitted: null,
    check: null,
  }
  saveCreateDraft(draft)
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (!url.endsWith('/api/v1/check')) return json({ detail: 'нет' }, 404)
    const card = JSON.parse(String(init?.body)) as { characteristics: { value: string }[] }
    const value = card.characteristics[0]?.value
    if (value === 'A4') return json({ issues: [], verdict: 'ready' })
    return json({ issues: [block], verdict: 'needs_fix' })
  }
  render(<CreatePage />)
  const alert = await screen.findByRole('alert')
  assert.match(alert.textContent ?? '', /A5/)
  assert.match(alert.textContent ?? '', /A4/)
  const submit = screen.getByRole('button', { name: 'Отправить на модерацию' })
  assert.equal(submit.hasAttribute('disabled'), true)
  fireEvent.click(screen.getByRole('button', { name: 'Изменить' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Значение «Формат»' }), { target: { value: 'A4' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => assert.equal(screen.queryByRole('alert'), null))
  await waitFor(() =>
    assert.equal(screen.getByRole('button', { name: 'Отправить на модерацию' }).hasAttribute('disabled'), false),
  )
})

test('отказ модерации с сервера показывается на форме', async () => {
  const draft: CreateDraft = {
    name: 'Бумага А4',
    description: '',
    phase: 'result',
    out: autofill,
    rows: [row('A4')],
    submitted: null,
    check: { issues: [], verdict: 'ready' },
  }
  saveCreateDraft(draft)
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/v1/check')) return json({ issues: [], verdict: 'ready' })
    if (url.endsWith('/api/demo/submissions') && init?.method === 'POST') {
      return json(
        { detail: 'Заявка не отправлена: характеристики противоречат КТРУ. «Формат»: сейчас «A5». Ожидается: A4.' },
        422,
      )
    }
    return json({ detail: 'нет' }, 404)
  }
  render(<CreatePage />)
  const submit = await screen.findByRole('button', { name: 'Отправить на модерацию' })
  await waitFor(() => assert.equal(submit.hasAttribute('disabled'), false))
  fireEvent.click(submit)
  await screen.findByText(/противоречат КТРУ/)
})
