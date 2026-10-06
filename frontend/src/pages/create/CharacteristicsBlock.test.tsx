import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { useState } from 'react'
import { acceptAll, editValue, type Row } from './createModel.ts'
import { CharacteristicsBlock } from './CharacteristicsBlock.tsx'

afterEach(() => cleanup())

function row(over: Partial<Row> & Pick<Row, 'name'>): Row {
  return {
    value: null,
    unit: null,
    source: null,
    status: 'not_found',
    required: false,
    decision: 'pending',
    edited: null,
    values: [],
    range: null,
    ...over,
  }
}

function click(el: Element) {
  fireEvent.pointerDown(el)
  fireEvent.click(el)
}

function Harness({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial)
  return (
    <>
      <button type="button" onClick={() => setRows((prev) => acceptAll(prev))}>
        Принять всё
      </button>
      <CharacteristicsBlock
        rows={rows}
        loading={false}
        hover={null}
        onHover={() => {}}
        degradedLlm={false}
        locked={false}
        onAccept={(name) => setRows((prev) => prev.map((r) => (r.name === name ? { ...r, decision: 'accepted' } : r)))}
        onRemove={() => {}}
        onRestore={() => {}}
        onEdit={(name, value) => setRows((prev) => editValue(prev, name, value))}
      />
    </>
  )
}

const format = () => row({ name: 'Формат', required: true, values: ['A3', 'A4', 'A5'] })

test('кнопка допустимых значений есть только при ограничениях', () => {
  render(<Harness initial={[format(), row({ name: 'Комментарий' })]} />)
  assert.ok(screen.getByRole('button', { name: 'Допустимые значения «Формат»' }))
  assert.equal(screen.queryByRole('button', { name: /«Комментарий»/ }), null)
  assert.equal(screen.getAllByRole('button', { name: 'Указать' }).length, 2)
})

test('клик открывает перечень, повторный клик закрывает', () => {
  render(<Harness initial={[format()]} />)
  const button = screen.getByRole('button', { name: 'Допустимые значения «Формат»' })
  click(button)
  assert.ok(screen.getByRole('dialog', { name: 'Допустимые значения «Формат»' }))
  assert.deepEqual(
    screen.getAllByRole('option').map((el) => el.textContent?.replace('✓', '').trim()),
    ['A3', 'A4', 'A5'],
  )
  click(button)
  assert.equal(screen.queryByRole('dialog'), null)
})

test('выбор значения сразу подставляет его и закрывает панель', () => {
  render(<Harness initial={[format()]} />)
  click(screen.getByRole('button', { name: 'Допустимые значения «Формат»' }))
  click(screen.getByRole('option', { name: 'A4' }))
  assert.equal(screen.queryByRole('dialog'), null)
  assert.match(screen.getByRole('listitem').textContent ?? '', /A4/)
  assert.match(screen.getByRole('listitem').textContent ?? '', /принято/)
})

test('открытие панели не затирает уже выбранное значение', () => {
  render(<Harness initial={[row({ name: 'Формат', value: 'A4', status: 'filled', values: ['A3', 'A4', 'A5'] })]} />)
  click(screen.getByRole('button', { name: 'Допустимые значения «Формат»' }))
  assert.equal(screen.getByRole('option', { name: /A4/ }).getAttribute('aria-selected'), 'true')
  assert.equal(screen.getByRole('option', { name: 'A3' }).getAttribute('aria-selected'), 'false')
  assert.equal(screen.queryByText('принято'), null)
  const card = screen.getAllByRole('listitem').find((el) => el.className.includes('rise'))
  if (!card) throw new Error('строка характеристики не найдена')
  assert.match(card.textContent ?? '', /A4/)
})

test('клик снаружи закрывает панель', () => {
  render(<Harness initial={[format()]} />)
  click(screen.getByRole('button', { name: 'Допустимые значения «Формат»' }))
  fireEvent.pointerDown(document.body)
  assert.equal(screen.queryByRole('dialog'), null)
})

test('клик внутри панели не закрывает её', () => {
  render(<Harness initial={[format()]} />)
  click(screen.getByRole('button', { name: 'Допустимые значения «Формат»' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.pointerDown(dialog)
  fireEvent.click(screen.getByText('Допустимые значения'))
  assert.ok(screen.getByRole('dialog'))
  assert.equal(screen.queryByText('принято'), null)
})

test('Escape закрывает панель', () => {
  render(<Harness initial={[format()]} />)
  click(screen.getByRole('button', { name: 'Допустимые значения «Формат»' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  assert.equal(screen.queryByRole('dialog'), null)
})

test('другая характеристика закрывает прежнюю панель и открывает свою', () => {
  render(
    <Harness
      initial={[format(), row({ name: 'Класс', values: ['A', 'B', 'C'] })]}
    />,
  )
  click(screen.getByRole('button', { name: 'Допустимые значения «Формат»' }))
  click(screen.getByRole('button', { name: 'Допустимые значения «Класс»' }))
  assert.equal(screen.queryAllByRole('dialog').length, 1)
  assert.ok(screen.getByRole('dialog', { name: 'Допустимые значения «Класс»' }))
  assert.equal(screen.queryByRole('option', { name: 'A4' }), null)
  assert.ok(screen.getByRole('option', { name: 'B' }))
})

test('клик по другой характеристике не оставляет старую панель', () => {
  render(<Harness initial={[format(), row({ name: 'Класс', value: 'B', status: 'filled' })]} />)
  click(screen.getByRole('button', { name: 'Допустимые значения «Формат»' }))
  click(screen.getByRole('button', { name: 'Изменить' }))
  assert.equal(screen.queryByRole('dialog'), null)
  assert.ok(screen.getByRole('textbox', { name: 'Значение «Класс»' }))
})

test('ручное редактирование по-прежнему сохраняет значение', () => {
  render(<Harness initial={[row({ name: 'Комментарий' })]} />)
  click(screen.getByRole('button', { name: 'Указать' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Значение «Комментарий»' }), { target: { value: 'своё' } })
  click(screen.getByRole('button', { name: 'Сохранить' }))
  assert.match(screen.getByRole('listitem').textContent ?? '', /своё/)
  assert.match(screen.getByRole('listitem').textContent ?? '', /принято/)
})

test('число вне диапазона не сохраняется, число внутри — сохраняется', () => {
  render(<Harness initial={[row({ name: 'Белизна', unit: '%', range: { min: 90, max: 175 } })]} />)
  click(screen.getByRole('button', { name: 'Допустимый диапазон «Белизна»' }))
  const dialog = screen.getByRole('dialog')
  assert.match(dialog.textContent ?? '', /90–175 %/)
  assert.match(dialog.textContent ?? '', /Укажите значение в диапазоне/)
  assert.equal(screen.queryAllByRole('option').length, 0)
  fireEvent.pointerDown(document.body)
  click(screen.getByRole('button', { name: 'Указать' }))
  const input = screen.getByRole('textbox', { name: 'Значение «Белизна»' })
  fireEvent.change(input, { target: { value: '200' } })
  click(screen.getByRole('button', { name: 'Сохранить' }))
  assert.match(screen.getByRole('alert').textContent ?? '', /90–175 %/)
  assert.equal(screen.queryByText('принято'), null)
  fireEvent.change(input, { target: { value: '160' } })
  click(screen.getByRole('button', { name: 'Сохранить' }))
  assert.match(screen.getByRole('listitem').textContent ?? '', /160/)
  assert.match(screen.getByRole('listitem').textContent ?? '', /принято/)
})

test('принять всё принимает заполненные и не трогает пустые', () => {
  render(
    <Harness
      initial={[
        format(),
        row({ name: 'Класс', value: 'B', status: 'filled', values: ['A', 'B', 'C'] }),
      ]}
    />,
  )
  click(screen.getByRole('button', { name: 'Принять всё' }))
  assert.equal(screen.getAllByText('принято').length, 1)
  click(screen.getByRole('button', { name: 'Допустимые значения «Формат»' }))
  click(screen.getByRole('option', { name: 'A5' }))
  assert.equal(screen.getAllByText('принято').length, 2)
  assert.match(screen.getAllByRole('listitem')[0].textContent ?? '', /A5/)
  assert.match(screen.getAllByRole('listitem')[1].textContent ?? '', /B/)
})

test('длинный перечень прокручивается и не дублирует значения', () => {
  const values = ['A4', 'A4', ...Array.from({ length: 24 }, (_, i) => `Длинное допустимое значение номер ${i + 1} для переноса строки`)]
  render(<Harness initial={[row({ name: 'Формат', values })]} />)
  click(screen.getByRole('button', { name: 'Допустимые значения «Формат»' }))
  const dialog = screen.getByRole('dialog')
  assert.match(dialog.className, /overflow-y-auto/)
  assert.match(dialog.className, /max-h-72/)
  const options = screen.getAllByRole('option')
  assert.equal(options.length, 25)
  assert.equal(options.filter((el) => el.textContent?.includes('A4')).length, 1)
  assert.match(options[1].className, /break-words/)
})

test('несколько характеристик выбираются независимо', () => {
  render(
    <Harness
      initial={[format(), row({ name: 'Класс', values: ['A', 'B', 'C'] })]}
    />,
  )
  click(screen.getByRole('button', { name: 'Допустимые значения «Формат»' }))
  click(screen.getByRole('option', { name: 'A3' }))
  click(screen.getByRole('button', { name: 'Допустимые значения «Класс»' }))
  click(screen.getByRole('option', { name: 'C' }))
  const items = screen.getAllByRole('listitem').map((el) => el.textContent ?? '')
  assert.match(items[0], /A3/)
  assert.doesNotMatch(items[0], /C/)
  assert.match(items[1], /C/)
  assert.doesNotMatch(items[1], /A3/)
})

test('слушатель документа один и снимается', () => {
  let live = 0
  const origAdd = document.addEventListener.bind(document)
  const origRemove = document.removeEventListener.bind(document)
  document.addEventListener = ((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
    if (type === 'pointerdown') live += 1
    origAdd(type, listener, options)
  }) as typeof document.addEventListener
  document.removeEventListener = ((type: string, listener: EventListener, options?: boolean | EventListenerOptions) => {
    if (type === 'pointerdown') live -= 1
    origRemove(type, listener, options)
  }) as typeof document.removeEventListener
  try {
    const view = render(<Harness initial={[format()]} />)
    const button = screen.getByRole('button', { name: 'Допустимые значения «Формат»' })
    click(button)
    assert.equal(live, 1)
    click(button)
    assert.equal(live, 0)
    click(button)
    assert.equal(live, 1)
    view.unmount()
    assert.equal(live, 0)
  } finally {
    document.addEventListener = origAdd as typeof document.addEventListener
    document.removeEventListener = origRemove as typeof document.removeEventListener
  }
})
