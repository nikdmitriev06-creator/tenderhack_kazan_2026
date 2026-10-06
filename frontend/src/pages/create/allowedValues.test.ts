import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowedOptions, allowedRange, hasConstraints, isSelectedValue, outsideRange, popoverPosition, rangeLabel } from './allowedValues.ts'

test('перечень без дублей и пустых строк, порядок сохраняется', () => {
  assert.deepEqual(allowedOptions(['A4', 'A4', ' ', 'A3', 'A5', 'A3']), ['A4', 'A3', 'A5'])
  assert.deepEqual(allowedOptions(undefined), [])
  assert.deepEqual(allowedOptions(null), [])
})

test('диапазон читается, пустой и перепутанный — нет', () => {
  assert.deepEqual(allowedRange({ min: 90, max: 175 }), { min: 90, max: 175 })
  assert.equal(allowedRange({ min: null, max: null }), null)
  assert.equal(allowedRange(undefined), null)
  assert.equal(allowedRange({ min: 10, max: 1 }), null)
  assert.deepEqual(allowedRange({ max: 120 }), { min: null, max: 120 })
})

test('подписи диапазона', () => {
  assert.equal(rangeLabel({ min: 90, max: 175 }, '%'), '90–175 %')
  assert.equal(rangeLabel({ min: 8 }, 'мкм'), 'от 8 мкм')
  assert.equal(rangeLabel({ max: 120 }, 'мкм'), 'до 120 мкм')
  assert.equal(rangeLabel(null, '%'), null)
})

test('число вне диапазона отклоняется, произвольный текст — нет', () => {
  const range = { min: 90, max: 175 }
  assert.equal(outsideRange('89', range), true)
  assert.equal(outsideRange('176', range), true)
  assert.equal(outsideRange('90', range), false)
  assert.equal(outsideRange('175', range), false)
  assert.equal(outsideRange('90,5', range), false)
  assert.equal(outsideRange('>=80 ... <90', range), false)
  assert.equal(outsideRange('', range), false)
  assert.equal(outsideRange('200', null), false)
})

test('ограничений нет — подсказку не показываем', () => {
  assert.equal(hasConstraints([], null), false)
  assert.equal(hasConstraints(undefined, { min: null, max: null }), false)
  assert.equal(hasConstraints(['A4'], null), true)
  assert.equal(hasConstraints([], { min: 90, max: 175 }), true)
})

test('текущее значение совпадает с пунктом только целиком', () => {
  assert.equal(isSelectedValue('A4', 'A4'), true)
  assert.equal(isSelectedValue(' A4 ', 'A4'), true)
  assert.equal(isSelectedValue(null, 'A4'), false)
  assert.equal(isSelectedValue('A3', 'A4'), false)
})

test('панель ставится у правого края кнопки и не вылезает за окно', () => {
  const viewport = { width: 400, height: 300 }
  const below = popoverPosition({ top: 20, right: 200, bottom: 40, left: 120 }, { width: 320, height: 80 }, viewport)
  assert.equal(below.left, 8)
  assert.equal(below.top, 44)
  const above = popoverPosition({ top: 250, right: 200, bottom: 270, left: 120 }, { width: 160, height: 80 }, viewport)
  assert.equal(above.top, 166)
  assert.equal(above.left, 40)
})
