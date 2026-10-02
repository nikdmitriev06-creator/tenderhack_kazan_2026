import { useEffect, useState } from 'react'
import { ApiError, api, type Submission, type SubmissionView } from '../../api/v1.ts'
import { PageBody, PageHeader } from '../../layout/Layout'
import { cx } from '../../lib/cx'
import { NBSP } from '../../lib/format'
import { navigate } from '../../lib/router'
import { Button, EmptyState, Notice, Panel, Skeleton, Textarea } from '../../ui'
import { IssueList } from '../create/IssueNote'
import { returnNote, selectedId } from './moderationModel.ts'

const STATUS: Record<Submission['status'], string> = { pending: 'ждёт решения', accepted: 'принята', returned: 'возвращена' }
const time = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function ModerationPage() {
  const [queue, setQueue] = useState<Submission[] | null>(null)
  const [current, setCurrent] = useState<number | null>(() => selectedId(window.location.search))
  const [view, setView] = useState<SubmissionView | null>(null)
  const [note, setNote] = useState('')
  const [deciding, setDeciding] = useState<'accept' | 'return' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Заявки на модерацию: автозаполнение характеристик'
  }, [])

  // Перечитать очередь после решения: меняется ключ, эффект ниже загружает её заново.
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    api
      .submissions()
      .then((items) => {
        if (cancelled) return
        setQueue(items)
        setCurrent((c) => c ?? items.find((s) => s.status === 'pending')?.id ?? items[0]?.id ?? null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof ApiError ? e.detail : 'не удалось загрузить очередь')
        setQueue([])
      })
    return () => {
      cancelled = true
    }
  }, [reload])

  useEffect(() => {
    if (current === null) return
    let cancelled = false
    api
      .submission(current)
      .then((v) => {
        if (cancelled) return
        setView(v)
        setNote(returnNote(v.check.issues))
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof ApiError ? e.detail : 'не удалось открыть заявку'))
    return () => {
      cancelled = true
    }
  }, [current])

  const decide = async (decision: 'accept' | 'return') => {
    if (!view) return
    setDeciding(decision)
    setError(null)
    try {
      await api.decide(view.id, { decision, note: decision === 'return' ? note : null })
      const fresh = await api.submission(view.id)
      setView(fresh)
      setReload((n) => n + 1)
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'не удалось сохранить решение')
    } finally {
      setDeciding(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Заявки на модерацию"
        description="Стенд портала: очередь заявок модератора. Модуль проверил каждую карточку и подготовил замечания со ссылкой на правило."
      />
      <PageBody className="flex flex-col gap-6">
        {error && (
          <Notice tone="danger" title="Не получилось">
            {error}
          </Notice>
        )}
        {queue === null ? (
          <Skeleton className="h-40 w-full" />
        ) : queue.length === 0 ? (
          <EmptyState
            title="Заявок пока нет"
            action={
              <a href="/" onClick={(e) => navigate(e, '/')} className="text-sm text-link underline underline-offset-4">
                Создать СТЕ
              </a>
            }
          >
            Заявка появится здесь, когда поставщик отправит карточку на модерацию.
          </EmptyState>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Panel title="Очередь" flush>
              <ul className="divide-y divide-line border-t border-line">
                {queue.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setCurrent(s.id)}
                      aria-current={s.id === current ? 'true' : undefined}
                      className={cx('flex w-full flex-col gap-0.5 px-5 py-3 text-left transition-colors hover:bg-raised', s.id === current && 'bg-accent-soft')}
                    >
                      <span className="flex items-baseline justify-between gap-3 text-xs text-muted">
                        <span className="tabular-nums">№{NBSP}{s.id}</span>
                        <span className={cx(s.status === 'pending' ? 'text-warning' : s.status === 'returned' ? 'text-pencil' : 'text-success')}>{STATUS[s.status]}</span>
                      </span>
                      <span className="text-sm text-ink">{s.card.name}</span>
                      <span className="text-xs text-muted">{time.format(new Date(s.created_at))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>

            {view && view.id === current ? (
              <div className="flex flex-col gap-6">
                <article className="rounded-(--radius-panel) border border-line bg-surface shadow-[0_1px_2px_rgb(23_25_28/0.04),0_12px_32px_-16px_rgb(23_25_28/0.18)]">
                  <header className="flex items-baseline justify-between gap-4 border-b border-line px-6 py-3 md:px-10">
                    <h2 className="text-[13px] text-muted">Заявка №{NBSP}{view.id}</h2>
                    <span className="text-[13px] text-muted">{STATUS[view.status]}</span>
                  </header>
                  <div className="flex flex-col gap-4 px-6 py-6 md:px-10">
                    <p className="text-[17px] font-semibold text-ink">{view.card.name}</p>
                    {view.card.ktru_code && (
                      <p className="font-mono text-[13px] text-muted" translate="no">
                        КТРУ {view.card.ktru_code}
                      </p>
                    )}
                    {view.card.description && <p className="font-serif text-[16px] leading-[1.7] whitespace-pre-line text-ink/90">{view.card.description}</p>}
                    <dl className="divide-y divide-line border-y border-line">
                      {view.card.characteristics.map((c) => {
                        const flagged = view.check.issues.some((i) => i.field === `characteristics.${c.name}` && i.severity === 'block')
                        return (
                          <div key={c.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-2">
                            <dt className="text-[13px] text-muted">{c.name}</dt>
                            <dd className={cx('text-right text-sm tabular-nums', flagged ? 'text-pencil' : 'text-ink')}>
                              {c.value}
                              {c.unit ? `${NBSP}${c.unit}` : ''}
                            </dd>
                          </div>
                        )
                      })}
                    </dl>
                  </div>
                </article>

                <Panel title="Замечания модуля" description={view.check.verdict === 'ready' ? 'Блокирующих нарушений нет.' : 'Есть нарушения правил модерации.'}>
                  <IssueList issues={view.check.issues} onFix={() => undefined} locked />
                </Panel>

                {view.status === 'pending' ? (
                  <Panel title="Решение">
                    <label htmlFor="return-note" className="text-[13px] font-medium text-ink">
                      Текст возврата поставщику
                    </label>
                    <Textarea id="return-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} className="mt-1.5" />
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button onClick={() => decide('accept')} loading={deciding === 'accept'} disabled={deciding !== null}>
                        Принять
                      </Button>
                      <Button variant="primary" onClick={() => decide('return')} loading={deciding === 'return'} disabled={deciding !== null || !note.trim()}>
                        Вернуть с замечаниями
                      </Button>
                    </div>
                  </Panel>
                ) : (
                  <Notice tone={view.status === 'accepted' ? 'success' : 'warning'} title={view.status === 'accepted' ? 'Заявка принята' : 'Заявка возвращена поставщику'}>
                    {view.decision_note ? <span className="whitespace-pre-line">{view.decision_note}</span> : null}
                  </Notice>
                )}
              </div>
            ) : (
              <Skeleton className="h-80 w-full" />
            )}
          </div>
        )}
      </PageBody>
    </>
  )
}
