import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ApiError, api, type BatchRowResult, type BatchState } from '../../api/v1.ts'
import { PageBody, PageHeader } from '../../layout/Layout'
import { cx } from '../../lib/cx'
import { navigate } from '../../lib/router'
import { Button, EmptyState, Notice, Panel, Table, type Column } from '../../ui'
import { PREFILL_KEY } from '../create/createModel.ts'
import { STATUS_TEXT, isFinished, summarize } from './batchView.ts'

const POLL_MS = 1000

function openInForm(event: MouseEvent<HTMLAnchorElement>, row: BatchRowResult) {
  try {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ name: row.name, description: '' }))
  } catch {
    // без sessionStorage форма просто откроется пустой
  }
  navigate(event, '/')
}

const COLUMNS: Column<BatchRowResult>[] = [
  { key: 'row', header: '№', render: (r) => <span className="tabular-nums text-muted">{r.row}</span>, className: 'w-12' },
  { key: 'name', header: 'Наименование', render: (r) => r.name || <span className="text-subtle">без наименования</span> },
  {
    key: 'code',
    header: 'Код КТРУ',
    render: (r) =>
      r.ktru_code ? (
        <span className="font-mono text-[13px]" translate="no">
          {r.ktru_code}
        </span>
      ) : (
        <span className="text-subtle">не определён</span>
      ),
  },
  { key: 'filled', header: 'Заполнено', align: 'right', render: (r) => <span className="tabular-nums">{r.filled}</span> },
  {
    key: 'issues',
    header: 'Замечания',
    render: (r) =>
      r.error ? (
        <span className="text-pencil">{r.error}</span>
      ) : r.note ? (
        <span className="text-muted">{r.note}</span>
      ) : r.issues.length ? (
        <span>
          <span className="tabular-nums">{r.issues.length}</span>
          <span className="text-muted">: {r.issues[0].message}</span>
        </span>
      ) : (
        <span className="text-subtle">нет</span>
      ),
  },
  {
    key: 'status',
    header: 'Статус',
    render: (r) => (
      <span className={cx(r.status === 'ready' && 'text-success', (r.status === 'needs_fix' || r.status === 'failed') && 'text-pencil', r.status === 'needs_answer' && 'text-warning', r.status === 'not_found' && 'text-muted')}>
        {STATUS_TEXT[r.status]}
      </span>
    ),
  },
  {
    key: 'open',
    header: '',
    render: (r) =>
      r.name && r.status !== 'ready' ? (
        <a href="/" onClick={(e) => openInForm(e, r)} className="text-[13px] text-link underline decoration-line-strong/60 underline-offset-4">
          Открыть в форме
        </a>
      ) : null,
  },
]

export function BatchPage() {
  const [file, setFile] = useState<File | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [state, setState] = useState<BatchState | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.title = 'Массовая загрузка: автозаполнение характеристик'
  }, [])

  useEffect(() => {
    if (!jobId) return
    let stopped = false
    let timer: number | undefined
    const tick = async () => {
      try {
        const next = await api.batch(jobId)
        if (stopped) return
        setState(next)
        if (!isFinished(next)) timer = window.setTimeout(tick, POLL_MS)
      } catch (e) {
        if (!stopped) setError(e instanceof ApiError ? e.detail : 'не удалось получить состояние пакета')
      }
    }
    void tick()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [jobId])

  const upload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    setState(null)
    try {
      const accepted = await api.uploadBatch(file)
      setJobId(accepted.job_id)
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'не удалось загрузить файл')
    } finally {
      setUploading(false)
    }
  }

  const counts = state ? summarize(state) : null
  const done = state?.status === 'done'
  const progress = state && state.total ? state.processed / state.total : 0

  return (
    <>
      <PageHeader
        title="Массовая загрузка"
        description="Файл xlsx или csv со списком СТЕ. Модуль подберёт позицию, заполнит характеристики и проверит каждую строку; колонки определяются по содержимому."
      />
      <PageBody className="flex flex-col gap-6">
        <Panel title="Файл" description="До 5 МБ и 5 000 строк. Нужна колонка с наименованием; описание и характеристики, если есть.">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv"
              className="sr-only"
              id="batch-file"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setError(null)
              }}
            />
            <label
              htmlFor="batch-file"
              className="inline-flex h-9 cursor-pointer items-center rounded-(--radius-ui) border border-line-strong px-4 text-sm text-ink hover:bg-raised focus-within:outline-2"
            >
              Выбрать файл
            </label>
            <span className="text-sm text-muted">{file ? file.name : 'файл не выбран'}</span>
            <Button variant="primary" onClick={upload} disabled={!file} loading={uploading} loadingText="Загружаем…">
              Загрузить
            </Button>
          </div>
        </Panel>

        {error && (
          <Notice tone="danger" title="Не получилось">
            {error}
          </Notice>
        )}

        {state ? (
          <Panel
            flush
            title={state.filename}
            description={
              done
                ? `Обработано ${state.processed} из ${state.total}.`
                : state.status === 'failed'
                  ? 'Обработка прервалась.'
                  : `Обрабатываем: ${state.processed} из ${state.total}.`
            }
            actions={
              done && jobId ? (
                <a href={api.batchResultUrl(jobId)} download className="text-[13px] font-medium text-link underline decoration-link/35 underline-offset-4">
                  Скачать файл с результатом
                </a>
              ) : undefined
            }
          >
            {!done && (
              <div className="mx-5 mb-3 h-0.5 overflow-hidden rounded bg-line" aria-hidden="true">
                <div className="h-full bg-accent-text transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
            {counts && (
              <p className="flex flex-wrap gap-x-5 gap-y-1 px-5 pb-3 text-[13px]">
                <span className="text-success">готово {counts.ready}</span>
                <span className="text-warning">нужен ответ {counts.needs_answer}</span>
                <span className="text-pencil">нужно исправить {counts.needs_fix}</span>
                {counts.not_found > 0 && <span className="text-muted">нет в справочнике {counts.not_found}</span>}
                {counts.skipped > 0 && <span className="text-muted">пустых {counts.skipped}</span>}
                {counts.failed > 0 && <span className="text-pencil">сбоев {counts.failed}</span>}
              </p>
            )}
            <Table columns={COLUMNS} rows={state.rows} rowKey={(r) => String(r.row)} caption="Результат по строкам файла" />
          </Panel>
        ) : (
          !uploading && (
            <EmptyState title="Результат появится после загрузки">
              Строки обрабатываются в очереди: страницу можно не держать открытой, пакет хранится час.
            </EmptyState>
          )
        )}
      </PageBody>
    </>
  )
}
