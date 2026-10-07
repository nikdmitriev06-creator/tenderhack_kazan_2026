import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bareQuantities, quantityAdvice } from './bareNumber.ts'

test('число без единицы даёт рекомендацию', () => {
  assert.deepEqual(bareQuantities('Бумага 500'), ['500'])
  assert.match(quantityAdvice('Бумага 500') ?? '', /500 штук/)
  assert.match(quantityAdvice('Бумага 500') ?? '', /Рекомендация|лучше указать/)
  assert.equal(quantityAdvice('Бумага 500')?.includes('ошиб'), false)
})

test('число с единицей, стандартом, моделью или датой не предупреждает', () => {
  const silent = [
    'Бумага 500 штук',
    'Бумага 500 листов',
    'Кабель 10 м',
    'Труба 25 мм',
    'Вес 20 кг',
    '2 кг',
    '2026 год',
    '2026 г.',
    'ГОСТ 12345',
    'ГОСТ 12345-2016',
    'ГОСТ Р 51545',
    'Артикул 12345',
    'арт. 7788',
    'Модель XR-500',
    'модель 500',
    'Бумага A4',
    'код 17.12.14.129-00000031',
    '01.10.2026',
    '50%',
    '2,5 кг',
    '2.5 м',
    '80 г/м2',
    '10-20 мм',
    '1 000 штук',
    '500шт',
    '25мм',
    '1920x1080',
    '№ 15',
  ]
  for (const text of silent) {
    assert.deepEqual(bareQuantities(text), [], text)
    assert.equal(quantityAdvice(text), null, text)
  }
})

test('текст без чисел молчит, несколько голых чисел собираются в одну рекомендацию', () => {
  assert.deepEqual(bareQuantities('Бумага офисная'), [])
  assert.deepEqual(bareQuantities('Бумага 500, плотность 80'), ['500', '80'])
  assert.match(quantityAdvice('Бумага 500 и ещё 80') ?? '', /числа/)
  assert.deepEqual(bareQuantities('Бумага 500 и кабель 10 м'), ['500'])
})

test('десятичная запятая и точка не дробят число с единицей', () => {
  assert.deepEqual(bareQuantities('Масса 10,5'), ['10,5'])
  assert.deepEqual(bareQuantities('Масса 10.5 г'), [])
})
