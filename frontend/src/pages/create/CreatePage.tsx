import { useEffect, useMemo, useState } from 'react'
import { ApiError, api, type AutofillOut, type CheckOut, type Issue, type Submission } from '../../api/v1.ts'
import { PageBody, PageHeader } from '../../layout/Layout'
import { navigate } from '../../lib/router'
import { Button, Notice, Panel } from '../../ui'
import { CharacteristicsBlock } from './CharacteristicsBlock'
import { PREFILL_KEY, acceptAll, applyFix, editValue, mergeRows, rowsFrom, setDecision, toCardIn, type Row } from './createModel.ts'
import { DescriptionField } from './DescriptionField'
import { EXAMPLES } from './examples'
import { IssueList } from './IssueNote'
import { KtruBlock } from './KtruBlock'

type Phase = 'edit' | 'loading' | 'result'

function readPrefill(): { name: string; description: string } | null {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY)
    if (!raw) return null
    sessionStorage.removeItem(PREFILL_KEY)
    return JSON.parse(raw) as { name: string; description: string }
  } catch {
    return null
  }
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.detail : 'не удалось выполнить запрос')

export function CreatePage() {
  const [prefill] = useState(readPrefill)
  const [name, setName] = useState(prefill?.name ?? '')
  const [description, setDescription] = useState(prefill?.description ?? '')
  const [phase, setPhase] = useState<Phase>('edit')
  const [out, setOut] = useState<AutofillOut | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [answering, setAnswering] = useState(false)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<CheckOut | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<Submission | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    document.title = 'Создание СТЕ: автозаполнение характеристик'
  }, [])

  // keep — после ответа на вопрос: решения человека по строкам сохраняются.
  const show = (next: AutofillOut, keep = false) => {
    setOut(next)
    setRows((prev) => (keep && prev ? mergeRows(prev, next.characteristics) : rowsFrom(next.characteristics)))
    setCheck(null)
  }

  const fill = async () => {
    if (!name.trim()) {
      setError('Укажите наименование: без него позицию не подобрать.')
      return
    }
    setPhase('loading')
    setError(null)
    setExpired(false)
    setSubmitted(null)
    try {
      show(await api.autofill(name.trim(), description))
      setPhase('result')
    } catch (e) {
      setError(errorText(e))
      setPhase(out ? 'result' : 'edit')
    }
  }

  const answer = async (characteristic: string, value: string) => {
    if (!out) return
    setAnswering(true)
    setError(null)
    try {
      show(await api.answer(out.session_id, characteristic, value), true)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setExpired(true)
      else setError(errorText(e))
    } finally {
      setAnswering(false)
    }
  }

  const ktruCode = out?.ktru.final_code ?? null
  const card = useMemo(() => toCardIn(name, description, rows ?? [], ktruCode), [name, description, rows, ktruCode])

  const runCheck = async () => {
    setChecking(true)
    setError(null)
    try {
      setCheck(await api.check(card))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setChecking(false)
    }
  }

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const accepted = (rows ?? []).filter((r) => r.decision === 'accepted').map(({ decision: _d, edited, ...c }) => ({ ...c, value: edited ?? c.value }))
      setSubmitted(await api.submit({ card, accepted }))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSubmitting(false)
    }
  }

  const fix = (issue: Issue) => {
    if (issue.field === 'name' && issue.fix?.value) setName(issue.fix.value)
    else if (rows) setRows(applyFix(rows, issue))
    setCheck(null)
  }

  const change = (next: Row[]) => {
    setRows(next)
    setCheck(null)
  }

  const marks = (rows ?? []).flatMap((r) => (r.source ? [{ span: r.source, key: r.name }] : []))
  const issues = check ? check.issues : (out?.issues ?? [])
  const locked = submitted !== null
  const editing = phase !== 'result'

  return (
    <>
      <PageHeader
        title="Создание СТЕ"
        description="Опишите товар своими словами. Модуль подберёт позицию КТРУ, заполнит характеристики и проверит карточку по правилам модерации портала."
      />
      <PageBody className="flex flex-col gap-6">
        {error && (
          <Notice tone="danger" title="Не получилось">
            {error}
          </Notice>
        )}
        {expired && (
          <Notice
            tone="warning"
            title="Сессия заполнения истекла"
            action={
              <Button size="sm" onClick={fill}>
                Заполнить заново
              </Button>
            }
          >
            Текст сохранён, его можно заполнить заново.
          </Notice>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <article
            aria-label="Товар"
            className="rounded-(--radius-panel) border border-line bg-surface shadow-[0_1px_2px_rgb(23_25_28/0.04),0_12px_32px_-16px_rgb(23_25_28/0.18)] lg:sticky lg:top-20"
          >
            <header className="flex items-baseline justify-between gap-4 border-b border-line px-6 py-3 md:px-10">
              <h2 className="text-[13px] text-muted">Товар от поставщика</h2>
              {phase === 'result' && !locked && (
                <button type="button" onClick={() => setPhase('edit')} className="text-[13px] text-muted underline decoration-line-strong/60 underline-offset-4 hover:text-ink">
                  Изменить текст
                </button>
              )}
            </header>
            <div className="px-6 py-6 md:px-10 md:py-8">
              <DescriptionField
                editing={editing}
                name={name}
                description={description}
                onName={setName}
                onDescription={setDescription}
                onSubmit={fill}
                marks={marks}
                hover={hover}
                onHover={setHover}
                busy={phase === 'loading'}
              />
            </div>
            {editing && (
              <footer className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-4 md:px-10">
                <Button variant="primary" onClick={fill} loading={phase === 'loading'} loadingText="Заполняем…">
                  Заполнить по описанию
                </Button>
                {out && (
                  <button type="button" onClick={() => setPhase('result')} className="text-[13px] text-muted underline underline-offset-4 hover:text-ink">
                    Вернуться к результату
                  </button>
                )}
              </footer>
            )}
          </article>

          <div className="flex flex-col gap-6">
            {editing && (
              <Panel title="Примеры для показа" description="Заполняют поля; заполнение запускается кнопкой под описанием.">
                <ul className="flex flex-col gap-2 text-sm">
                  {EXAMPLES.map((ex) => (
                    <li key={ex.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setName(ex.name)
                          setDescription(ex.description)
                          setError(null)
                        }}
                        className="text-left text-link underline decoration-line-strong/60 underline-offset-4 hover:decoration-link"
                      >
                        {ex.label}
                      </button>
                      <span className="ml-2 text-[13px] text-muted">{ex.name}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            <Panel title="Категория КТРУ">
              <KtruBlock state={out?.ktru ?? null} loading={phase === 'loading'} answering={answering} onAnswer={answer} />
            </Panel>

            <Panel
              title="Характеристики"
              flush
              actions={
                rows && rows.some((r) => r.decision === 'pending' && r.value !== null && r.status !== 'conflict') && !locked ? (
                  <button type="button" onClick={() => change(acceptAll(rows))} className="text-[13px] text-link underline decoration-link/35 underline-offset-4">
                    Принять всё
                  </button>
                ) : undefined
              }
            >
              <CharacteristicsBlock
                rows={phase === 'loading' ? null : rows}
                loading={phase === 'loading'}
                hover={hover}
                onHover={setHover}
                degradedLlm={out?.degraded.includes('llm') ?? false}
                locked={locked}
                onAccept={(n) => rows && change(setDecision(rows, n, 'accepted'))}
                onRemove={(n) => rows && change(setDecision(rows, n, 'removed'))}
                onRestore={(n) => rows && change(setDecision(rows, n, 'pending'))}
                onEdit={(n, v) => rows && change(editValue(rows, n, v))}
              />
            </Panel>

            {out && phase === 'result' && (
              <Panel title={check ? 'Проверка перед отправкой' : 'Замечания'} description={check ? (check.verdict === 'ready' ? 'Карточка готова к отправке.' : 'Есть замечания, из-за которых заявку вернут.') : undefined}>
                <IssueList issues={issues} onFix={fix} locked={locked} />
              </Panel>
            )}

            {out && phase === 'result' && (
              <div className="flex flex-wrap items-center gap-3">
                {submitted ? (
                  <Notice tone="success" title={`Заявка № ${submitted.id} отправлена на модерацию`} className="w-full">
                    <a href={`/moderation?id=${submitted.id}`} onClick={(e) => navigate(e, `/moderation?id=${submitted.id}`)} className="font-medium text-link underline underline-offset-4">
                      Открыть в заявках
                    </a>
                  </Notice>
                ) : (
                  <>
                    <Button onClick={runCheck} loading={checking} loadingText="Проверяем…">
                      Проверить перед отправкой
                    </Button>
                    <Button variant="primary" onClick={submit} loading={submitting} loadingText="Отправляем…">
                      Отправить на модерацию
                    </Button>
                    <p className="w-full text-[13px] text-muted">
                      В карточку идут только принятые характеристики: <span className="tabular-nums">{card.characteristics.length}</span> из{' '}
                      <span className="tabular-nums">{rows?.length ?? 0}</span>.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </PageBody>
    </>
  )
}
