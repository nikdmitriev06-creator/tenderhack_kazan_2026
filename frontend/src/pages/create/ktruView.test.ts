import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { KtruState } from '../../api/v1.ts'
import { CONFIRM, NOTHING_FITS, optionLabel, questionTitle } from './ktruView.ts'

const state = (over: Partial<KtruState>): KtruState => ({
  candidates: [{ code: 'K-1', name: 'Батарейка щелочная', score: 1, why: [] }],
  remaining: 1,
  question: null,
  final_code: null,
  steps: [],
  ...over,
})

test('вариант «ничего не подходит» назван словами, а не служебным значением', () => {
  const s = state({})
  assert.deepEqual(optionLabel(s, CONFIRM, { value: NOTHING_FITS, remaining: 0, cuts: 1 }), { text: 'Ничего не подходит', hint: null })
  assert.deepEqual(optionLabel(s, 'Цвет', { value: NOTHING_FITS, remaining: 0, cuts: 3 }), { text: 'Ничего не подходит', hint: null })
})

test('вопрос подтверждения показывает название позиции и код', () => {
  const s = state({ question: { characteristic: CONFIRM, options: [] } })
  assert.equal(questionTitle(CONFIRM), 'Подтвердите позицию КТРУ')
  assert.deepEqual(optionLabel(s, CONFIRM, { value: 'K-1', remaining: 1, cuts: 0 }), { text: 'Батарейка щелочная', hint: 'K-1' })
})

test('обычный вариант: значение и сколько позиций останется', () => {
  const s = state({})
  assert.equal(questionTitle('Цвет'), 'Уточните «Цвет»')
  assert.deepEqual(optionLabel(s, 'Цвет', { value: 'Белый', remaining: 2, cuts: 1 }), { text: 'Белый', hint: 'останется 2, отсечёт 1' })
  assert.deepEqual(optionLabel(s, 'Цвет', { value: '', remaining: 1, cuts: 2 }), { text: 'Нет такой характеристики', hint: 'останется 1, отсечёт 2' })
})
