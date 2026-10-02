import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CharacteristicOut, Issue } from '../../api/v1.ts'
import { acceptAll, applyFix, editValue, fieldLabel, highlightSegments, mergeRows, rowsFrom, setDecision, toCardIn } from './createModel.ts'

const char = (over: Partial<CharacteristicOut>): CharacteristicOut => ({
  name: 'Формат',
  value: 'A4',
  unit: null,
  source: null,
  status: 'filled',
  required: true,
  ...over,
})

const issue = (over: Partial<Issue>): Issue => ({
  field: 'characteristics.Формат',
  kind: 'typo',
  severity: 'warn',
  message: 'm',
  why: 'w',
  rule: 'r',
  fix: null,
  ...over,
})

test('фрагмент значения выделяется маркером, остальное — как есть', () => {
  assert.deepEqual(highlightSegments('Масса 80 г', [{ start: 6, end: 8, key: 'm' }]), [
    { text: 'Масса ', mark: false, key: null },
    { text: '80', mark: true, key: 'm' },
    { text: ' г', mark: false, key: null },
  ])
})

test('пересекающийся фрагмент не ломает текст: остаётся первый', () => {
  const segs = highlightSegments('абвгдеёжз', [
    { start: 0, end: 5, key: 'a' },
    { start: 3, end: 8, key: 'b' },
  ])
  assert.equal(segs.map((s) => s.text).join(''), 'абвгдеёжз')
  assert.deepEqual(segs.filter((s) => s.mark).map((s) => s.key), ['a'])
})

test('соседние фрагменты — два отдельных выделения', () => {
  const segs = highlightSegments('A4B5', [
    { start: 0, end: 2, key: 'a' },
    { start: 2, end: 4, key: 'b' },
  ])
  assert.deepEqual(segs, [
    { text: 'A4', mark: true, key: 'a' },
    { text: 'B5', mark: true, key: 'b' },
  ])
})

test('фрагмент за границей текста отбрасывается', () => {
  assert.deepEqual(highlightSegments('abc', [{ start: 5, end: 9, key: 'x' }]), [{ text: 'abc', mark: false, key: null }])
})

test('исправление значения принимает строку с новым значением', () => {
  const rows = rowsFrom([char({ name: 'Интенсивность цвета', value: 'Медимум', status: 'conflict' })])
  const fixed = applyFix(rows, issue({ field: 'characteristics.Интенсивность цвета', fix: { value: 'Медиум' } }))
  assert.equal(fixed[0].edited, 'Медиум')
  assert.equal(fixed[0].decision, 'accepted')
})

test('исправление имени выносит единицу в поле', () => {
  const rows = rowsFrom([char({ name: 'Толщина, мкм', value: '104' })])
  const fixed = applyFix(rows, issue({ field: 'characteristics.Толщина, мкм', fix: { name: 'Толщина', unit: 'мкм' } }))
  assert.equal(fixed[0].name, 'Толщина')
  assert.equal(fixed[0].unit, 'мкм')
})

test('принять всё не трогает конфликты и пустые', () => {
  const rows = acceptAll(
    rowsFrom([
      char({ name: 'a' }),
      char({ name: 'b', status: 'conflict' }),
      char({ name: 'c', value: null, status: 'not_found' }),
    ]),
  )
  assert.deepEqual(
    rows.map((r) => r.decision),
    ['accepted', 'pending', 'pending'],
  )
})

test('карточка для проверки: без убранных и пустых, с правками', () => {
  let rows = rowsFrom([char({ name: 'a', value: '1' }), char({ name: 'b', value: '2' }), char({ name: 'c', value: null })])
  rows = setDecision(rows, 'b', 'removed')
  rows = editValue(rows, 'a', '10')
  const card = toCardIn('Бумага', 'текст', rows, 'K-1')
  assert.deepEqual(card, {
    name: 'Бумага',
    description: 'текст',
    ktru_code: 'K-1',
    characteristics: [{ name: 'a', value: '10', unit: null }],
  })
})

test('карточка для проверки: только принятые строки, предложения модуля не входят', () => {
  let rows = rowsFrom([char({ name: 'a', value: '1' }), char({ name: 'b', value: '2' })])
  rows = setDecision(rows, 'b', 'accepted')
  assert.deepEqual(
    toCardIn('Бумага', '', rows, null).characteristics.map((c) => c.name),
    ['b'],
  )
})

test('ответ на вопрос не сбрасывает решения по строкам', () => {
  let prev = rowsFrom([char({ name: 'a', value: '1' }), char({ name: 'b', value: '2' }), char({ name: 'c', value: '3' }), char({ name: 'e', value: '7' })])
  prev = setDecision(prev, 'a', 'accepted')
  prev = editValue(prev, 'b', '5')
  prev = setDecision(prev, 'c', 'removed')
  prev = setDecision(prev, 'e', 'accepted')
  const next = mergeRows(prev, [
    char({ name: 'a', value: '1' }),
    char({ name: 'b', value: '2' }),
    char({ name: 'c', value: '3' }),
    char({ name: 'd', value: '4' }),
    char({ name: 'e', value: '8', method: 'answer' }),
  ])
  assert.deepEqual(
    next.map((r) => [r.name, r.decision, r.edited, r.value]),
    [
      ['a', 'accepted', null, '1'],
      ['b', 'accepted', '5', '2'],
      ['c', 'removed', null, '3'],
      ['d', 'pending', null, '4'],
      ['e', 'pending', null, '8'],
    ],
  )
})

test('поле кода КТРУ подписано словами', () => {
  assert.equal(fieldLabel('ktru_code'), 'Код КТРУ')
  assert.equal(fieldLabel('characteristics.Формат'), 'Формат')
})
