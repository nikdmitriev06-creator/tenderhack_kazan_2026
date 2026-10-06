import { useEffect, useState } from 'react'
import { ApiError, api, type AuditExample, type AuditRule, type MetricRow, type MetricsOut, type PortalReport } from '../../api/v1.ts'
import { PageBody, PageHeader } from '../../layout/Layout'
import { EmptyState, Notice, Panel, Skeleton, Table, type Column } from '../../ui'
import { decimal, plural } from '../../lib/format'
import { formatMetric, portalHeadline, splitRules } from './metricsView.ts'

const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

const COLUMNS: Column<MetricRow>[] = [
  { key: 'title', header: 'Метрика', render: (r) => <span className="text-ink">{r.title}</span> },
  {
    key: 'value',
    header: 'Значение',
    align: 'right',
    render: (r) => <span className="font-medium tabular-nums">{formatMetric(r.key, r.value)}</span>,
  },
  { key: 'n', header: 'Выборка', align: 'right', render: (r) => <span className="tabular-nums text-muted">{r.n}</span> },
  { key: 'how', header: 'Как считали', render: (r) => <span className="text-[13px] text-muted">{r.how}</span> },
]

function PortalLink({ example }: { example: AuditExample }) {
  return (
    <a href={example.url} target="_blank" rel="noreferrer" className="text-link underline decoration-line-strong/60 underline-offset-4">
      {example.name}
      <span className="sr-only"> (карточка на портале, откроется в новой вкладке)</span>
    </a>
  )
}

const RULE_COLUMNS: Column<AuditRule>[] = [
  { key: 'rule', header: 'Правило модерации', render: (r) => <span className="text-ink">{r.rule}</span> },
  { key: 'cards', header: 'Карточек', align: 'right', render: (r) => <span className="tabular-nums">{decimal(r.cards, 0)}</span> },
  { key: 'share', header: 'Доля', align: 'right', render: (r) => <span className="font-medium tabular-nums">{formatMetric('share', r.share)}</span> },
  {
    key: 'example',
    header: 'Пример',
    render: (r) =>
      r.examples[0] ? (
        <span className="text-[13px]">
          <PortalLink example={r.examples[0]} />
          <span className="block text-muted">{r.examples[0].message}</span>
        </span>
      ) : null,
  },
]

function PortalSection({ report }: { report: PortalReport }) {
  const { slips, other } = splitRules(report)
  return (
    <>
      <Panel
        flush
        title="Живые карточки портала: модерация"
        description={`${decimal(report.cards, 0)} СТЕ из ${decimal(report.categories, 0)} категорий каталога, собраны с публичного API zakupki.mos.ru · ${date.format(new Date(report.created_at))}`}
      >
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pb-4">
          <span className="text-[28px] font-semibold tracking-tight tabular-nums text-ink">{formatMetric('share', report.audit.share)}</span>
          <span className="text-sm text-muted">{portalHeadline(report)}.</span>
        </p>
        <Table columns={RULE_COLUMNS} rows={other} rowKey={(r) => r.rule} caption="Нарушения правил модерации в живых карточках портала" />
      </Panel>
      {slips && (
        <Panel
          title="Ошибки ввода в живых карточках"
          description={`${slips.cards} ${plural(slips.cards, 'карточка', 'карточки', 'карточек')}: число в характеристике расходится с наименованием так, как ошибаются при вводе. Перепутана единица, опечатка в числе или отрицательная величина.`}
        >
          <ol className="flex flex-col divide-y divide-line">
            {slips.examples.map((e) => (
              <li key={`${e.id}-${e.field}`} className="py-2.5 text-sm first:pt-0 last:pb-0">
                <PortalLink example={e} />
                <span className="ml-2 font-mono text-xs text-subtle" translate="no">
                  СТЕ {e.id}
                </span>
                <p className="text-[13px] text-muted">{e.message}</p>
              </li>
            ))}
          </ol>
        </Panel>
      )}
      <Panel
        flush
        title="Заполнение на живых карточках"
        description="Значения, которые модуль извлёк правилами из наименования и описания, против введённых поставщиком. Значение поставщика не эталон: в нём бывают те же ошибки."
      >
        <Table columns={COLUMNS} rows={report.fill} rowKey={(r) => r.key} caption="Заполнение характеристик на живых карточках портала" />
      </Panel>
    </>
  )
}

export function MetricsPage() {
  const [metrics, setMetrics] = useState<MetricsOut | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [portal, setPortal] = useState<PortalReport | null | undefined>(undefined)

  useEffect(() => {
    document.title = 'Метрики: автозаполнение характеристик'
    api
      .metrics()
      .then(setMetrics)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.detail : 'не удалось загрузить метрики'))
    api
      .portalReport()
      .then(setPortal)
      .catch(() => setPortal(null))
  }, [])

  const synthetic = metrics?.catalog_source.includes('synthetic') ?? false
  return (
    <>
      <PageHeader
        title="Метрики"
        description="Качество модуля на золотом наборе и на живых карточках Портала поставщиков: подбор кода КТРУ, заполнение характеристик, поиск ошибок, скорость. Числа берутся из последнего прогона как есть."
      />
      <PageBody className="flex flex-col gap-6">
        {error && (
          <Notice tone="danger" title="Не получилось">
            {error}
          </Notice>
        )}
        {metrics === undefined && !error && <Skeleton className="h-64 w-full" />}
        {metrics === null && (
          <EmptyState title="Оценка ещё не запускалась">
            Запустите в контейнере api: python -m app.tools.evaluate. Результат появится здесь.
          </EmptyState>
        )}
        {metrics && (
          <>
            {synthetic && (
              <Notice tone="warning" title="Демо-справочник">
                Числа показывают работу конвейера на синтетическом справочнике, а не качество на данных организаторов. Золотой набор
                собран из того же справочника, поэтому оценка оптимистична.
              </Notice>
            )}
            <Panel
              flush
              title="Последний прогон"
              description={`${date.format(new Date(metrics.created_at))} · справочник ${metrics.catalog_version} · ${metrics.model}`}
            >
              <Table columns={COLUMNS} rows={metrics.rows} rowKey={(r) => r.key} caption="Метрики качества модуля" />
            </Panel>
          </>
        )}
        {portal && <PortalSection report={portal} />}
      </PageBody>
    </>
  )
}
