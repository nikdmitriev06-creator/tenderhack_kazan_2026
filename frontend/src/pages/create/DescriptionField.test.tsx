import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { useState } from 'react'
import { DescriptionField } from './DescriptionField.tsx'

afterEach(() => cleanup())

function Harness({ onSubmit = () => {} }: { onSubmit?: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <DescriptionField
        editing
        name={name}
        description={description}
        onName={setName}
        onDescription={setDescription}
        onSubmit={onSubmit}
        marks={[]}
        hover={null}
        onHover={() => {}}
        busy={false}
      />
      <button type="submit">Отправить</button>
    </form>
  )
}

test('уход из поля с голым числом показывает рекомендацию и не блокирует отправку', () => {
  let submitted = 0
  render(<Harness onSubmit={() => (submitted += 1)} />)
  const name = screen.getByRole('textbox', { name: /Наименование/ })
  fireEvent.change(name, { target: { value: 'Бумага 500' } })
  fireEvent.blur(name)
  assert.match(screen.getByRole('status').textContent ?? '', /500 штук/)
  assert.equal(name.hasAttribute('aria-invalid'), false)
  fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  assert.equal(submitted, 1)
})

test('число с единицей рекомендацию не показывает', () => {
  render(<Harness />)
  const name = screen.getByRole('textbox', { name: /Наименование/ })
  fireEvent.change(name, { target: { value: 'Бумага 500 штук' } })
  fireEvent.blur(name)
  assert.equal(screen.queryByRole('status'), null)
})

test('повторный уход из поля с тем же текстом не показывает рекомендацию снова', () => {
  render(<Harness />)
  const name = screen.getByRole('textbox', { name: /Наименование/ })
  fireEvent.change(name, { target: { value: 'Бумага 500' } })
  fireEvent.blur(name)
  fireEvent.pointerDown(document.body)
  assert.equal(screen.queryByRole('status'), null)
  fireEvent.blur(name)
  assert.equal(screen.queryByRole('status'), null)
})

test('клик по рекомендации не закрывает её, клик снаружи закрывает', () => {
  render(<Harness />)
  const description = screen.getByRole('textbox', { name: 'Описание' })
  fireEvent.change(description, { target: { value: 'Кабель 10' } })
  fireEvent.blur(description)
  const note = screen.getByRole('status')
  fireEvent.pointerDown(note)
  assert.ok(screen.getByRole('status'))
  fireEvent.pointerDown(document.body)
  assert.equal(screen.queryByRole('status'), null)
})
