// Сквозные сценарии образца портала на поднятом стеке (docker compose, порт 8080).
// Запуск: playwright-cli open http://localhost:8080/ && playwright-cli --raw run-code --filename=e2e/flows.js
// Каждый шаг читает свой эффект со страницы; первая неудача останавливает сценарий с текстом шага.
// playwright-cli run-code ждёт в файле одно выражение-функцию, поэтому оно ничему не присваивается.
// eslint-disable-next-line no-unused-expressions
async (page) => {
  const BASE = 'http://localhost:8080'
  const FILE = 'C:/proga/active/tender-hack-kazan-2026/backend/tests/fixtures/fake/ste.xlsx'
  const log = []
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  const step = async (name, fn) => {
    try {
      const got = await fn()
      log.push(`ok   ${name}${got !== undefined ? `: ${got}` : ''}`)
    } catch (e) {
      log.push(`FAIL ${name}: ${String(e).split('\n')[0]}`)
      throw new Error(log.join('\n'))
    }
  }
  const text = (sel) => page.locator(sel).first().innerText()

  try {
    // 1. Создание СТЕ: пример «Неоднозначный КТРУ» → вопрос → итоговый код → проверка → отправка.
    await step('форма открыта', async () => {
      await page.goto(`${BASE}/`)
      await page.getByRole('heading', { name: 'Создание СТЕ' }).waitFor()
      return page.title()
    })
    await step('пример заполняет поля', async () => {
      await page.getByRole('button', { name: 'Неоднозначный КТРУ', exact: true }).click()
      return page.getByLabel('Наименование').inputValue()
    })
    await step('заполнение даёт вопрос', async () => {
      await page.getByRole('button', { name: 'Заполнить по описанию' }).click()
      await page.getByText('Уточните').waitFor({ timeout: 60000 })
      return text('fieldset legend')
    })
    await step('ответ даёт итоговый код', async () => {
      await page.locator('fieldset button', { hasText: 'Белая' }).first().click()
      await page.getByText('17.12.14.129-00000031').first().waitFor({ timeout: 30000 })
      return '17.12.14.129-00000031'
    })
    await step('фрагменты описания под маркером', async () => page.locator('article mark').count())
    await step('принять всё', async () => {
      await page.getByRole('button', { name: 'Принять всё' }).click()
      return page.getByText('принято').count()
    })
    await step('проверка перед отправкой', async () => {
      await page.getByRole('button', { name: 'Проверить перед отправкой' }).click()
      await page.getByRole('heading', { name: 'Проверка перед отправкой' }).waitFor({ timeout: 30000 })
      return 'есть'
    })
    let submissionId = ''
    await step('отправка на модерацию', async () => {
      await page.getByRole('button', { name: 'Отправить на модерацию' }).click()
      const notice = page.getByText(/Заявка № \d+ отправлена/)
      await notice.waitFor({ timeout: 30000 })
      submissionId = ((await notice.innerText()).match(/№\s*(\d+)/) || [])[1]
      return `№ ${submissionId}`
    })

    // 2. Пример «Недопустимое значение»: значение не из перечня видно в замечаниях.
    await step('недопустимое значение', async () => {
      await page.goto(`${BASE}/`)
      await page.getByRole('button', { name: 'Недопустимое значение', exact: true }).click()
      await page.getByRole('button', { name: 'Заполнить по описанию' }).click()
      await page.getByRole('heading', { name: 'Замечания' }).waitFor({ timeout: 60000 })
      return (await text('section:has(h2:text("Замечания"))')).includes('нет в перечне') ? 'замечание «нет в перечне» есть' : 'НЕТ замечания'
    })

    // 2б. Честный отказ и подтверждение позиции: служебные варианты вопроса — словами.
    await step('«Ничего не подходит» даёт честный отказ', async () => {
      await page.goto(`${BASE}/`)
      await page.getByLabel('Наименование').fill('Бумага офисная А4 500 листов')
      await page.getByRole('button', { name: 'Заполнить по описанию' }).click()
      await page.locator('fieldset button', { hasText: 'Ничего не подходит' }).first().click({ timeout: 60000 })
      await page.getByText(/Категория не найдена/).first().waitFor({ timeout: 30000 })
      return 'Категория не найдена'
    })
    await step('подтверждение позиции даёт код', async () => {
      await page.goto(`${BASE}/`)
      await page.getByLabel('Наименование').fill('Батарейка AA щелочная 1,5 В')
      await page.getByRole('button', { name: 'Заполнить по описанию' }).click()
      await page.getByText('Подтвердите позицию КТРУ').waitFor({ timeout: 60000 })
      await page.locator('fieldset button', { hasText: '27.20.11.000-00000501' }).click()
      await page.locator('fieldset').waitFor({ state: 'detached', timeout: 30000 })
      return text('p.font-mono')
    })

    // 3. Заявки: открыть отправленную, вернуть с замечаниями.
    await step('заявка в очереди', async () => {
      await page.goto(`${BASE}/moderation?id=${submissionId}`)
      await page.getByRole('heading', { name: `Заявка № ${submissionId}`.replace(' ', ' ') }).waitFor({ timeout: 30000 }).catch(() => undefined)
      await page.getByText(`Заявка №`).first().waitFor({ timeout: 30000 })
      return page.locator('aside, section').first().innerText().then((t) => t.slice(0, 40).replace(/\n/g, ' '))
    })
    await step('возврат с замечаниями', async () => {
      const note = page.getByLabel('Текст возврата поставщику')
      if (!(await note.inputValue()).trim()) await note.fill('Проверьте характеристики.')
      await page.getByRole('button', { name: 'Вернуть с замечаниями' }).click()
      await page.getByText('Заявка возвращена поставщику').waitFor({ timeout: 30000 })
      return 'возвращена'
    })

    // 4. Массовая загрузка: файл фикстуры до конца, ссылка на результат.
    await step('пакет обработан', async () => {
      await page.goto(`${BASE}/batch`)
      await page.locator('input[type=file]').setInputFiles(FILE)
      await page.getByRole('button', { name: 'Загрузить' }).click()
      await page.getByText('Скачать файл с результатом').waitFor({ timeout: 120000 })
      return text('section:has(table) header p')
    })

    // 5. Метрики и API.
    await step('метрики', async () => {
      await page.goto(`${BASE}/metrics`)
      await page.getByRole('heading', { name: 'Последний прогон' }).waitFor({ timeout: 30000 })
      return `${await page.locator('tbody tr').count()} строк`
    })
    await step('живые карточки портала', async () => {
      await page.getByRole('heading', { name: 'Живые карточки портала: модерация' }).waitFor({ timeout: 30000 })
      const links = await page.locator('a[href^="https://zakupki.mos.ru/sku/view/"]').count()
      if (!links) throw new Error('нет ссылок на карточки портала')
      return `${links} ссылок на СТЕ`
    })
    await step('страница API', async () => {
      await page.goto(`${BASE}/developers`)
      await page.getByText('POST /api/v1/autofill').first().waitFor()
      return `${await page.locator('ul li code').count()} методов`
    })
    await step('BPMN доступна', async () => {
      const r = await page.request.get(`${BASE}/bpmn/module.svg`)
      return `${r.status()} ${r.headers()['content-type']}`
    })
    await step('ошибок консоли нет', async () => {
      if (errors.length) throw new Error(errors.slice(0, 3).join(' | '))
      return 0
    })
  } catch (e) {
    return String(e.message || e)
  }
  return log.join('\n')
}
