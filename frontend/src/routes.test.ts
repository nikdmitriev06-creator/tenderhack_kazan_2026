import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NAV_GROUPS, resolveRoute } from './routes.ts'

test('корень — форма создания СТЕ', () => {
  assert.equal(resolveRoute('/'), 'create')
})

test('хвостовой слэш не меняет экран', () => {
  assert.equal(resolveRoute('/batch/'), 'batch')
  assert.equal(resolveRoute('/moderation/'), 'moderation')
})

test('каждый экран кейса открывается своим путём', () => {
  assert.equal(resolveRoute('/batch'), 'batch')
  assert.equal(resolveRoute('/moderation'), 'moderation')
  assert.equal(resolveRoute('/metrics'), 'metrics')
  assert.equal(resolveRoute('/developers'), 'developers')
})

test('служебной страницы состояния больше нет', () => {
  assert.equal(resolveRoute('/status'), 'not-found')
})

test('витрина компонентов открывается по прямой ссылке', () => {
  assert.equal(resolveRoute('/ui'), 'ui')
})

test('неизвестный путь — not-found, а не форма', () => {
  assert.equal(resolveRoute('/nope'), 'not-found')
})

test('в навигации нет витрины и состояния', () => {
  const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))
  assert.ok(!hrefs.includes('/ui'))
  assert.ok(!hrefs.includes('/status'))
})

test('навигация сгруппирована по ролям: поставщик и модератор', () => {
  const roles = NAV_GROUPS.map((g) => g.role)
  assert.deepEqual(roles, ['Поставщик', 'Модератор'])
  assert.deepEqual(
    NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
    ['/', '/batch', '/moderation'],
  )
})
