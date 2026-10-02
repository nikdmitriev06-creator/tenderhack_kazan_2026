import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Issue } from '../../api/v1.ts'
import { returnNote, selectedId } from './moderationModel.ts'

const issue = (over: Partial<Issue>): Issue => ({
  field: 'characteristics.Интенсивность цвета',
  kind: 'not_in_list',
  severity: 'block',
  message: 'Значения «Белый» нет в перечне позиции.',
  why: 'w',
  rule: 'r',
  fix: null,
  ...over,
})

test('текст возврата собирается из блокирующих замечаний, по номерам', () => {
  const note = returnNote([issue({}), issue({ severity: 'warn', message: 'не блокирует' }), issue({ field: 'name', message: 'В наименовании «500л».' })])
  assert.equal(note, '1. Интенсивность цвета: Значения «Белый» нет в перечне позиции.\n2. Наименование: В наименовании «500л».')
})

test('без блокирующих замечаний текст пустой', () => {
  assert.equal(returnNote([issue({ severity: 'warn' })]), '')
})

test('номер заявки из адреса', () => {
  assert.equal(selectedId('?id=12'), 12)
  assert.equal(selectedId('?id=abc'), null)
  assert.equal(selectedId(''), null)
})
