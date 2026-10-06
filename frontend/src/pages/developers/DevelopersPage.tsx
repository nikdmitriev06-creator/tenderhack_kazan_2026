import { useEffect, useState } from 'react'
import { PageBody, PageHeader } from '../../layout/Layout'
import { Panel, Tabs, type TabItem } from '../../ui'
import { answerReq, answerRes, autofillReq, autofillRes, checkReq, checkRes } from './examples'

type Method = { verb: 'GET' | 'POST'; path: string; what: string }

const METHODS: Method[] = [
  { verb: 'POST', path: '/api/v1/autofill', what: 'наименование и описание → кандидаты КТРУ, характеристики с источником в тексте, замечания, уточняющий вопрос' },
  { verb: 'POST', path: '/api/v1/autofill/{session_id}/answer', what: 'ответ на вопрос → сужение до конечного кода или шаги, если код не определить' },
  { verb: 'POST', path: '/api/v1/check', what: 'готовая карточка → замечания с обоснованием и ссылкой на правило модерации' },
  { verb: 'GET', path: '/api/v1/ktru/{code}', what: 'позиция справочника: характеристики, допустимые значения, единицы' },
  { verb: 'POST', path: '/api/v1/batch', what: 'файл xlsx или csv в очередь: тот же разбор для каждой строки' },
  { verb: 'GET', path: '/api/v1/batch/{job_id}', what: 'ход обработки и результат по строкам; …/result.xlsx: файл с результатом' },
  { verb: 'GET', path: '/api/v1/metrics', what: 'качество на золотом наборе: метрика, значение, выборка, способ расчёта' },
]

const FLOW = [
  { who: 'Портал', text: 'Поставщик вводит наименование и описание в форме «Создание СТЕ».' },
  { who: 'Модуль', text: 'POST /api/v1/autofill: кандидаты КТРУ, характеристики, замечания и вопрос, если позиций несколько.' },
  { who: 'Поставщик', text: 'Отвечает на вопрос (…/answer), принимает, правит или убирает каждое предложенное значение.' },
  { who: 'Модуль', text: 'POST /api/v1/check перед отправкой: что нарушает правила модерации и чем исправить.' },
  { who: 'Модератор', text: 'Видит заявку с теми же замечаниями модуля и принимает её или возвращает с готовым текстом.' },
]

const NOTES = [
  'Модуль ничего не пишет в данные портала: ответ содержит предложения, а решение по каждому полю принимает человек.',
  'Значение и единица попадают в ответ, только если они есть в перечне позиции справочника и в ОКЕИ; это проверяет код, а не модель.',
  'API без состояния. Сессия уточнения хранится час; на 404 «сессия заполнения не найдена или истекла» достаточно повторить /autofill.',
  'Ошибка приходит как JSON {"detail": "…"} с текстом для человека; 422 означает ошибки полей запроса.',
  'Поле degraded: ["llm"] значит, что характеристики извлечены только правилами; ["embeddings"] значит, что позиции искались без векторного индекса.',
  'Справочник подключается файлами (CATALOG_PATHS): под формат справочника организатора пишется загрузчик, контракт API не меняется.',
]

const PAIRS = [
  { id: 'autofill', label: 'Заполнение', req: autofillReq, res: autofillRes, path: 'POST /api/v1/autofill' },
  { id: 'answer', label: 'Ответ на вопрос', req: answerReq, res: answerRes, path: 'POST /api/v1/autofill/{session_id}/answer' },
  { id: 'check', label: 'Проверка', req: checkReq, res: checkRes, path: 'POST /api/v1/check' },
]

function Code({ title, children }: { title: string; children: string }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 text-[13px] text-muted">{title}</figcaption>
      <pre tabIndex={0} aria-label={title} className="max-h-[420px] overflow-auto rounded-(--radius-ui) border border-line bg-raised p-4 font-mono text-[12px] leading-relaxed text-ink">
        {children}
      </pre>
    </figure>
  )
}

export function DevelopersPage() {
  const [tab, setTab] = useState('autofill')
  useEffect(() => {
    document.title = 'API модуля: автозаполнение характеристик'
  }, [])
  const examples: TabItem[] = PAIRS.map((p) => ({
    id: p.id,
    label: p.label,
    content: (
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code title={`Запрос: ${p.path}`}>{p.req}</Code>
        <Code title="Ответ">{p.res}</Code>
      </div>
    ),
  }))
  return (
    <>
      <PageHeader
        title="API для Портала поставщиков"
        description="Как встроить модуль в форму «Создание СТЕ»: портал отправляет текст поставщика и показывает ответ модуля, решение остаётся за человеком."
      />
      <PageBody className="flex flex-col gap-6">
        <Panel title="Поток" description="BPMN-схема процесса с дорожками портала, модуля и модератора лежит по ссылке ниже.">
          <ol className="grid gap-4 md:grid-cols-5">
            {FLOW.map((s, i) => (
              <li key={i} className="relative flex flex-col gap-1 border-t-2 border-ink pt-3">
                <span className="text-xs tabular-nums text-muted">
                  {i + 1}. {s.who}
                </span>
                <span className="text-sm text-ink">{s.text}</span>
              </li>
            ))}
          </ol>
          <p className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
            <a href="/api/docs" className="font-medium text-link underline decoration-link/35 underline-offset-4">
              Интерактивная документация (Swagger)
            </a>
            <a href="/api/openapi.json" className="font-medium text-link underline decoration-link/35 underline-offset-4">
              Контракт OpenAPI
            </a>
            <a href="/bpmn/module.svg" className="font-medium text-link underline decoration-link/35 underline-offset-4">
              BPMN-схема
            </a>
          </p>
        </Panel>

        <Panel title="Методы" flush>
          <ul className="divide-y divide-line border-t border-line">
            {METHODS.map((m) => (
              <li key={m.verb + m.path} className="grid gap-1 px-5 py-3 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:gap-6">
                <code className="font-mono text-[13px] text-ink" translate="no">
                  <span className="text-muted">{m.verb}</span> {m.path}
                </code>
                <span className="text-sm text-muted">{m.what}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Пример запроса и ответа" description="Сняты с модуля на демо-справочнике; ответ укорочен.">
          <Tabs items={examples} value={tab} onChange={setTab} label="Примеры" />
        </Panel>

        <Panel title="Что важно при встраивании">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-ink marker:text-subtle">
            {NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Panel>
      </PageBody>
    </>
  )
}
