import { useEffect, useRef, type KeyboardEvent } from 'react'
import { ApiError, api, type BatchRowResult, type BatchState } from '../../api/v1.ts'
import { PageBody, PageHeader } from '../../layout/Layout'
import { cx } from '../../lib/cx'
import { navigate } from '../../lib/router'
import { Badge, Button, EmptyState, Notice, Panel, Table, type Column, type Tone } from '../../ui'
import { characteristicsHref } from '../create/formLink.ts'
import { pollJobIds, sessionById, type BatchSession } from './batchSessions.ts'
import {
  addBatchDraft,
  applyBatchJobState,
  getBatchSnapshot,
  noteBatchJobFailure,
  pickBatchFile,
  selectBatch,
  uploadBatchSession,
  useBatchSessions,
} from './batchStore.ts'
import { STATUS_TEXT, sessionStatusText, summarize } from './batchView.ts'

const POLL_MS = 1000

function formHref(row: BatchRowResult, jobId: string | null): string {
  return characteristicsHref({ name: row.name, ktru: row.ktru_code, job: jobId, row: row.row })
}

function columns(jobId: string | null): Column<BatchRowResult>[] {
  return [
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
        <a
          href={formHref(r, jobId)}
          onClick={(e) => navigate(e, formHref(r, jobId))}
          className="text-[13px] text-link underline decoration-line-strong/60 underline-offset-4"
        >
          Открыть в форме
        </a>
      ) : null,
  },
  ]
}

function statusTone(text: string): Tone {
  if (text === 'готово') return 'success'
  if (text === 'ошибка' || text === 'сбой' || text === 'не найден') return 'danger'
  if (text === 'новый' || text === 'выбран') return 'neutral'
  return 'warning'
}

function fileLabel(session: BatchSession): string {
  return session.filename || 'Новый файл'
}

export function BatchPage() {
  const model = useBatchSessions()
  const selected = sessionById(model, model.selectedId)
  const input = useRef<HTMLInputElement>(null)
  const pollKey = pollJobIds(model.sessions).join('|')

  useEffect(() => {
    document.title = 'Массовая загрузка: автозаполнение характеристик'
  }, [])

  useEffect(() => {
    const ids = pollKey ? pollKey.split('|') : []
    if (!ids.length) return
    let stopped = false
    let timer: number | undefined
    const tick = async () => {
      await Promise.all(
        ids.map(async (jobId) => {
          try {
            const next = await api.batch(jobId)
            if (!stopped) applyBatchJobState(jobId, next)
          } catch (e) {
            if (stopped) return
            const terminal = e instanceof ApiError && e.status === 404
            const message = e instanceof ApiError ? e.detail : 'не удалось получить состояние пакета'
            noteBatchJobFailure(jobId, message, terminal)
          }
        }),
      )
      if (!stopped) timer = window.setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [pollKey])

  const onPick = (file: File | null) => {
    if (!file) return
    const current = getBatchSnapshot()
    const open = sessionById(current, current.selectedId)
    pickBatchFile(open && !open.jobId ? open.id : null, file)
  }

  const upload = () => {
    const current = getBatchSnapshot()
    const open = sessionById(current, current.selectedId)
    if (!open || open.jobId) return
    void uploadBatchSession(open.id, (file) => api.uploadBatch(file))
  }

  const addFile = () => {
    addBatchDraft()
    if (input.current) input.current.value = ''
  }

  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step || model.sessions.length === 0) return
    event.preventDefault()
    const index = Math.max(0, model.sessions.findIndex((s) => s.id === model.selectedId))
    const next = (index + step + model.sessions.length) % model.sessions.length
    selectBatch(model.sessions[next].id)
  }

  const showPicker = !selected || !selected.jobId

  return (
    <>
      <PageHeader
        title="Массовая загрузка"
        description="Файл xlsx или csv со списком СТЕ. Модуль подберёт позицию, заполнит характеристики и проверит каждую строку; колонки определяются по содержимому. Файлы обрабатываются независимо."
      />
      <PageBody className="flex flex-col gap-6">
        {model.sessions.length > 0 && (
          <div className="flex items-center gap-x-6 overflow-x-auto border-b border-line">
            <div role="tablist" aria-label="Файлы" className="flex items-center gap-x-6" onKeyDown={onTabsKeyDown}>
              {model.sessions.map((session) => {
                const active = session.id === model.selectedId
                const status = sessionStatusText(session)
                return (
                  <button
                    key={session.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="batch-file-panel"
                    id={`batch-tab-${session.id}`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => selectBatch(session.id)}
                    className={cx(
                      'relative flex shrink-0 items-center gap-2 whitespace-nowrap py-3 text-sm font-medium transition-colors duration-150',
                      'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:transition-colors',
                      active ? 'text-ink after:bg-accent-text' : 'text-muted after:bg-transparent hover:text-ink',
                    )}
                  >
                    <span className="max-w-48 truncate">{fileLabel(session)}</span>
                    <Badge tone={statusTone(status)}>{status}</Badge>
                  </button>
                )
              })}
            </div>
            <Button variant="ghost" size="sm" className="my-1.5" onClick={addFile}>
              Добавить файл
            </Button>
          </div>
        )}

        <div role="tabpanel" id="batch-file-panel" aria-labelledby={selected ? `batch-tab-${selected.id}` : undefined} className="flex flex-col gap-6">
          {showPicker && (
            <Panel title="Файл" description="До 5 МБ и 5 000 строк. Нужна колонка с наименованием; описание и характеристики, если есть.">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={input}
                  type="file"
                  accept=".xlsx,.csv"
                  className="sr-only"
                  id="batch-file"
                  onChange={(e) => {
                    onPick(e.target.files?.[0] ?? null)
                  }}
                />
                <label
                  htmlFor="batch-file"
                  className="inline-flex h-9 cursor-pointer items-center rounded-(--radius-ui) border border-line-strong px-4 text-sm text-ink hover:bg-raised focus-within:outline-2"
                >
                  Выбрать файл
                </label>
                <span className="text-sm text-muted">{selected?.file ? selected.file.name : 'файл не выбран'}</span>
                <Button variant="primary" onClick={upload} disabled={!selected?.file} loading={selected?.uploading ?? false} loadingText="Загружаем…">
                  Загрузить
                </Button>
              </div>
            </Panel>
          )}

          {selected?.error && (!selected.state || selected.missing) && (
            <Notice tone="danger" title="Не получилось">
              {selected.error}
            </Notice>
          )}

          {selected?.state ? (
            <ResultPanel session={selected} />
          ) : selected?.jobId && !selected.error ? (
            <p className="text-sm text-muted">Получаем состояние пакета…</p>
          ) : (
            !selected?.uploading &&
            !selected?.error && (
              <EmptyState title="Результат появится после загрузки">
                Строки обрабатываются в очереди. Список файлов остаётся в этой вкладке браузера, в том числе после перехода в другой раздел; на сервере пакет хранится час.
              </EmptyState>
            )
          )}
        </div>
      </PageBody>
    </>
  )
}

function ResultPanel({ session }: { session: BatchSession }) {
  const state = session.state as BatchState
  const counts = summarize(state)
  const done = state.status === 'done'
  const progress = state.total ? state.processed / state.total : 0
  return (
    <Panel
      flush
      title={state.filename || session.filename}
      description={
        done
          ? `Обработано ${state.processed} из ${state.total}.`
          : state.status === 'failed'
            ? 'Обработка прервалась.'
            : `Обрабатываем: ${state.processed} из ${state.total}.`
      }
      actions={
        done && session.jobId ? (
          <a href={api.batchResultUrl(session.jobId)} download className="text-[13px] font-medium text-link underline decoration-link/35 underline-offset-4">
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
      <p className="flex flex-wrap gap-x-5 gap-y-1 px-5 pb-3 text-[13px]">
        <span className="text-success">готово {counts.ready}</span>
        <span className="text-warning">нужен ответ {counts.needs_answer}</span>
        <span className="text-pencil">нужно исправить {counts.needs_fix}</span>
        {counts.not_found > 0 && <span className="text-muted">нет в справочнике {counts.not_found}</span>}
        {counts.skipped > 0 && <span className="text-muted">пустых {counts.skipped}</span>}
        {counts.failed > 0 && <span className="text-pencil">сбоев {counts.failed}</span>}
      </p>
      <Table columns={columns(session.jobId)} rows={state.rows} rowKey={(r) => String(r.row)} caption="Результат по строкам файла" />
    </Panel>
  )
}
