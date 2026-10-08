import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api, type AutofillOut, type CheckOut, type Issue, type Submission } from '../../api/v1.ts'
import { PageBody, PageHeader } from '../../layout/Layout'
import { navigate } from '../../lib/router'
import { Button, Notice, Panel } from '../../ui'
import { CharacteristicsBlock } from './CharacteristicsBlock'
import { readFormTarget } from './formLink.ts'
import {
  PREFILL_KEY,
  acceptAll,
  applyFix,
  editValue,
  fillEmptyFromKtru,
  ktruFillMessage,
  mergeRows,
  moderationBlock,
  rowsFrom,
  setDecision,
  toCardIn,
  type Row,
} from './createModel.ts'
import { DescriptionField } from './DescriptionField'
import { EXAMPLES } from './examples'
import { IssueList } from './IssueNote'
import { emptyCreateDraft, loadCreateDraft, saveCreateDraft, type CreateDraft } from './createDraft'
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

function initialDraft(): CreateDraft {
  const target = readFormTarget(window.location.search)
  const saved = loadCreateDraft()
  if (target) {
    if (saved && saved.name.trim() === target.name && saved.phase === 'result' && saved.out) return saved
    return { ...emptyCreateDraft(), name: target.name, description: target.description }
  }
  const prefill = readPrefill()
  if (prefill) return { ...emptyCreateDraft(), name: prefill.name, description: prefill.description }
  return saved ?? emptyCreateDraft()
}

function shouldAutofill(seed: CreateDraft): boolean {
  const target = readFormTarget(window.location.search)
  return Boolean(target && !(seed.out && seed.name.trim() === target.name))
}

export function CreatePage() {
  const [seed] = useState(initialDraft)
  const [name, setName] = useState(seed.name)
  const [description, setDescription] = useState(seed.description)
  const [phase, setPhase] = useState<Phase>(shouldAutofill(seed) ? 'loading' : seed.phase)
  const [out, setOut] = useState<AutofillOut | null>(seed.out)
  const [rows, setRows] = useState<Row[] | null>(seed.rows)
  const [hover, setHover] = useState<string | null>(null)
  const [answering, setAnswering] = useState(false)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<CheckOut | null>(seed.check)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<Submission | null>(seed.submitted)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [fillingKtru, setFillingKtru] = useState(false)
  const [ktruFillNote, setKtruFillNote] = useState<string | null>(null)
  const [checkFresh, setCheckFresh] = useState(false)
  const ktruFillSeq = useRef(0)
  const rowsRef = useRef<Row[] | null>(seed.rows)
  const ktruCodeRef = useRef<string | null>(seed.out?.ktru.final_code ?? null)

  const rememberRows = (next: Row[] | null) => {
    rowsRef.current = next
  }

  useEffect(() => {
    document.title = 'Создание СТЕ: автозаполнение характеристик'
  }, [])

  const openedOnCharacteristics = readFormTarget(window.location.search) !== null

  useEffect(() => {
    if (!openedOnCharacteristics) return
    document.getElementById('characteristics')?.scrollIntoView?.({ block: 'start' })
  }, [openedOnCharacteristics, phase])

  useEffect(() => {
    saveCreateDraft({
      name,
      description,
      phase: phase === 'loading' ? 'edit' : phase,
      out,
      rows,
      submitted,
      check,
    })
  }, [name, description, phase, out, rows, submitted, check])

  // keep — после ответа на вопрос: решения человека по строкам сохраняются.
  const show = (next: AutofillOut, keep = false) => {
    ktruFillSeq.current += 1
    setFillingKtru(false)
    setKtruFillNote(null)
    const nextRows = keep && rowsRef.current ? mergeRows(rowsRef.current, next.characteristics) : rowsFrom(next.characteristics)
    rememberRows(nextRows)
    ktruCodeRef.current = next.ktru.final_code ?? null
    setOut(next)
    setRows(nextRows)
    setCheck(null)
    setCheckFresh(false)
  }

  useEffect(() => {
    const target = readFormTarget(window.location.search)
    if (!target || (seed.out && seed.name.trim() === target.name)) return
    let cancelled = false
    void api
      .autofill(target.name, target.description)
      .then((next) => {
        if (cancelled) return
        show(next)
        setPhase('result')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(errorText(e))
        setPhase('edit')
      })
    return () => {
      cancelled = true
    }
  }, [seed.name, seed.out])

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

  useEffect(() => {
    if (phase !== 'result' || !rows || submitted) return
    let cancelled = false
    void api
      .check(toCardIn(name, description, rows, ktruCode))
      .then((next) => {
        if (cancelled) return
        setCheck(next)
        setCheckFresh(true)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setCheckFresh(false)
        setError(errorText(e))
      })
    return () => {
      cancelled = true
    }
  }, [phase, rows, name, description, ktruCode, submitted])

  const fillByKtru = async () => {
    const code = ktruCode
    const currentRows = rows
    if (!code || !currentRows) return
    const seq = ++ktruFillSeq.current
    setFillingKtru(true)
    setKtruFillNote(null)
    setError(null)
    try {
      const position = await api.ktru(code)
      if (seq !== ktruFillSeq.current || ktruCodeRef.current !== code) return
      const freshRows = rowsRef.current
      if (!freshRows) return
      if (position.characteristics.length === 0) {
        setKtruFillNote(ktruFillMessage({ rows: freshRows, filled: 0, kept: 0, ambiguous: 0, unmapped: 0 }, true))
        return
      }
      const result = fillEmptyFromKtru(freshRows, position.characteristics)
      rememberRows(result.rows)
      setRows(result.rows)
      setCheck(null)
      setKtruFillNote(ktruFillMessage(result, false))
    } catch (e) {
      if (seq !== ktruFillSeq.current) return
      setError(errorText(e))
    } finally {
      if (seq === ktruFillSeq.current) setFillingKtru(false)
    }
  }

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

  const startNew = () => {
    saveCreateDraft(null)
    if (window.location.search || window.location.hash) {
      window.history.pushState(null, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
    setName('')
    setDescription('')
    setPhase('edit')
    setOut(null)
    rememberRows(null)
    setRows(null)
    setHover(null)
    setCheck(null)
    setSubmitted(null)
    setError(null)
    setExpired(false)
    setKtruFillNote(null)
    ktruCodeRef.current = null
  }

  const fix = (issue: Issue) => {
    if (issue.field === 'name' && issue.fix?.value) setName(issue.fix.value)
    else if (rowsRef.current) {
      const next = applyFix(rowsRef.current, issue)
      rememberRows(next)
      setRows(next)
    }
    setCheck(null)
  }

  const change = (next: Row[], editedName?: string) => {
    rememberRows(next)
    setRows(next)
    setCheckFresh(false)
    if (editedName) {
      setCheck((prev) =>
        prev ? { ...prev, issues: prev.issues.filter((issue) => issue.field !== `characteristics.${editedName}`) } : prev,
      )
    }
  }

  const marks = (rows ?? []).flatMap((r) => (r.source ? [{ span: r.source, key: r.name }] : []))
  const issues = check ? check.issues : (out?.issues ?? [])
  const locked = submitted !== null
  const editing = phase !== 'result'
  const gate = phase === 'result' && !locked ? moderationBlock(ktruCode, check, checkFresh) : null

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
              id="characteristics"
              title="Характеристики"
              className="scroll-mt-20"
              flush
              actions={
                rows && rows.some((r) => r.decision === 'pending' && (r.edited ?? r.value) !== null && r.status !== 'conflict') && !locked ? (
                  <button type="button" onClick={() => change(acceptAll(rows))} className="text-[13px] text-link underline decoration-link/35 underline-offset-4">
                    Принять всё
                  </button>
                ) : undefined
              }
            >
              {ktruCode && phase !== 'loading' && rows && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
                  <p className="min-w-0 text-[13px] text-muted">
                    КТРУ{' '}
                    <span className="font-mono text-ink" translate="no">
                      {ktruCode}
                    </span>
                  </p>
                  <Button size="sm" onClick={fillByKtru} loading={fillingKtru} loadingText="Заполняем…" disabled={locked || answering}>
                    Заполнить характеристики по КТРУ
                  </Button>
                  {ktruFillNote && (
                    <p role="status" className="w-full text-[13px] text-muted">
                      {ktruFillNote}
                    </p>
                  )}
                </div>
              )}
              <CharacteristicsBlock
                rows={phase === 'loading' ? null : rows}
                loading={phase === 'loading'}
                hover={hover}
                onHover={setHover}
                degradedLlm={out?.degraded.includes('llm') ?? false}
                locked={locked}
                issues={check?.issues ?? []}
                onAccept={(n) => rows && change(setDecision(rows, n, 'accepted'), n)}
                onRemove={(n) => rows && change(setDecision(rows, n, 'removed'), n)}
                onRestore={(n) => rows && change(setDecision(rows, n, 'pending'), n)}
                onEdit={(n, v) => rows && change(editValue(rows, n, v), n)}
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
                  <>
                    <Notice tone="success" title={`Заявка № ${submitted.id} отправлена на модерацию`} className="w-full">
                      <a href={`/moderation?id=${submitted.id}`} onClick={(e) => navigate(e, `/moderation?id=${submitted.id}`)} className="font-medium text-link underline underline-offset-4">
                        Открыть в заявках
                      </a>
                    </Notice>
                    <Button variant="primary" onClick={startNew}>
                      Добавить новый товар
                    </Button>
                  </>
                ) : (
                  <>
                    <Button onClick={runCheck} loading={checking} loadingText="Проверяем…">
                      Проверить перед отправкой
                    </Button>
                    <Button variant="primary" onClick={submit} loading={submitting} loadingText="Отправляем…" disabled={gate !== null}>
                      Отправить на модерацию
                    </Button>
                    {gate && (
                      <p role="status" className="w-full text-[13px] text-pencil">
                        {gate}
                      </p>
                    )}
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
