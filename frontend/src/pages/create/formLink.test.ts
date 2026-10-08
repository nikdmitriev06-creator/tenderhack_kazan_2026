import assert from 'node:assert/strict'
import { test } from 'node:test'
import { characteristicsHref, readFormTarget } from './formLink.ts'

test('ссылка открывает характеристики и сохраняет строку пакета', () => {
  const href = characteristicsHref({ name: 'Бумага А4', ktru: '17.12', job: 'job-1', row: 4 })
  const target = readFormTarget(href.slice(href.indexOf('?')))
  assert.equal(target?.name, 'Бумага А4')
  assert.equal(target?.ktru, '17.12')
  assert.equal(target?.job, 'job-1')
  assert.equal(target?.row, '4')
  assert.ok(href.endsWith('#characteristics'))
})

test('описание и спецсимволы в наименовании доезжают в адрес', () => {
  const href = characteristicsHref({ name: 'Бумага 80 г/м2 & А4', description: 'пачка; белая' })
  const target = readFormTarget(href.slice(href.indexOf('?')))
  assert.equal(target?.name, 'Бумага 80 г/м2 & А4')
  assert.equal(target?.description, 'пачка; белая')
})

test('адрес без секции характеристик формой не читается', () => {
  assert.equal(readFormTarget(''), null)
  assert.equal(readFormTarget('?name=Бумага'), null)
  assert.equal(readFormTarget('?section=characteristics'), null)
})
