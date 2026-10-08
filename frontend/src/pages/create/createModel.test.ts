import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CharacteristicOut, Issue } from '../../api/v1.ts'
import { acceptAll, applyFix, editValue, fieldLabel, fillEmptyFromKtru, highlightSegments, issuesForCharacteristic, ktruFillMessage, mergeRows, moderationBlock, rowsFrom, setDecision, toCardIn } from './createModel.ts'

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

test('выбор допустимого значения принимается как ручной ввод и не мешает принять всё', () => {
  let rows = rowsFrom([
    char({ name: 'Формат', value: null, status: 'not_found', values: ['A3', 'A4', 'A5'] }),
    char({ name: 'Класс', value: 'B', values: ['A', 'B', 'C'] }),
    char({ name: 'Белизна', value: null, status: 'not_found', unit: '%', range: { min: 90, max: 175 } }),
  ])
  rows = editValue(rows, 'Формат', 'A4')
  assert.equal(rows[0].edited, 'A4')
  assert.equal(rows[0].decision, 'accepted')
  assert.deepEqual(rows[0].values, ['A3', 'A4', 'A5'])
  assert.deepEqual(rows[2].range, { min: 90, max: 175 })
  rows = acceptAll(rows)
  assert.deepEqual(
    rows.map((r) => r.decision),
    ['accepted', 'accepted', 'pending'],
  )
  assert.deepEqual(
    toCardIn('Бумага', '', rows, null).characteristics.map((c) => [c.name, c.value]),
    [
      ['Формат', 'A4'],
      ['Класс', 'B'],
    ],
  )
})

test('заполнение по КТРУ ставит только единственное значение и только в пустую строку', () => {
  const rows = rowsFrom([
    char({ name: 'Цветность', value: null, status: 'not_found', values: ['Белая'] }),
    char({ name: 'Формат', value: null, status: 'not_found', values: ['A3', 'A4'] }),
    char({ name: 'Белизна', value: null, status: 'not_found', unit: '%', range: { min: 90, max: 175 } }),
    char({ name: 'Класс', value: 'B', status: 'filled' }),
  ])
  const edited = editValue(rows, 'Класс', 'C')
  const removed = setDecision(
    rowsFrom([char({ name: 'Плотность', value: null, status: 'not_found', values: ['80'] })]),
    'Плотность',
    'removed',
  )
  const result = fillEmptyFromKtru(
    [...edited, ...removed],
    [
      { name: 'цветность', values: ['Белая', 'Белая'] },
      { name: 'Формат', values: ['A3', 'A4'] },
      { name: 'Белизна', values: [] },
      { name: 'Класс', values: ['A'] },
      { name: 'Плотность', values: ['80'], unit: 'г/м2' },
      { name: 'Лишняя', values: ['да'] },
    ],
  )
  assert.equal(result.rows[0].edited, 'Белая')
  assert.equal(result.rows[0].decision, 'pending')
  assert.equal(result.rows[1].edited, null)
  assert.equal(result.rows[2].edited, null)
  assert.equal(result.rows[3].edited, 'C')
  assert.equal(result.rows[4].decision, 'removed')
  assert.equal(result.rows[4].edited, null)
  assert.equal(result.filled, 1)
  assert.equal(result.kept, 2)
  assert.equal(result.ambiguous, 2)
  assert.equal(result.unmapped, 1)
  assert.match(ktruFillMessage(result, false), /Заполнены пустые характеристики: 1/)
  assert.match(ktruFillMessage(result, false), /не изменены/)
  assert.equal(ktruFillMessage(result, true), 'У этой позиции КТРУ нет характеристик для заполнения.')
})

test('повторное заполнение не затирает значение, уже подставленное из КТРУ', () => {
  const once = fillEmptyFromKtru(rowsFrom([char({ name: 'Цветность', value: null, status: 'not_found' })]), [
    { name: 'Цветность', values: ['Белая'] },
  ])
  const twice = fillEmptyFromKtru(once.rows, [{ name: 'Цветность', values: ['Серая'] }])
  assert.equal(twice.rows[0].edited, 'Белая')
  assert.equal(twice.filled, 0)
  assert.equal(twice.kept, 1)
})

const ready = { issues: [], verdict: 'ready' as const }

test('отправка закрыта без КТРУ и пока сверка не свежая', () => {
  assert.match(moderationBlock(null, ready, true) ?? '', /не определена/)
  assert.match(moderationBlock('17.12', null, false) ?? '', /Сверяем/)
  assert.equal(moderationBlock('17.12', ready, true), null)
})

test('противоречие КТРУ называется, исправление его снимает, второе остаётся', () => {
  const format = {
    field: 'characteristics.Формат',
    kind: 'not_in_list' as const,
    severity: 'block' as const,
    message: 'Значение «Формат» противоречит КТРУ. Сейчас: «A5». Ожидается: A4.',
    why: 'ожидается A4',
    rule: 'r',
    fix: null,
  }
  const color = { ...format, field: 'characteristics.Цвет', message: 'Значение «Цвет» противоречит КТРУ.' }
  const both = { issues: [format, color], verdict: 'needs_fix' as const }
  assert.match(moderationBlock('17.12', both, true) ?? '', /Несколько/)
  const left = { issues: [color], verdict: 'needs_fix' as const }
  assert.match(moderationBlock('17.12', left, true) ?? '', /Цвет/)
  assert.equal(moderationBlock('17.12', ready, true), null)
  assert.deepEqual(issuesForCharacteristic(both.issues, 'Формат'), [format])
  assert.deepEqual(issuesForCharacteristic([color], 'Формат'), [])
})

test('неизвестный код КТРУ не считается успешной сверкой', () => {
  const unknown = {
    issues: [
      {
        field: 'ktru_code',
        kind: 'not_in_list' as const,
        severity: 'warn' as const,
        message: 'Кода КТРУ нет в справочнике модуля.',
        why: 'без позиции',
        rule: 'r',
        fix: null,
      },
    ],
    verdict: 'ready' as const,
  }
  assert.match(moderationBlock('00', unknown, true) ?? '', /нет в справочнике/)
})
