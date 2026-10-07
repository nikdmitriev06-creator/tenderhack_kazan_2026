import { useEffect, useRef, useState, type RefObject } from 'react'
import { Field, Input, Textarea } from '../../ui'
import { cx } from '../../lib/cx'
import type { Span } from '../../api/v1.ts'
import { quantityAdvice } from './bareNumber.ts'
import { highlightSegments } from './createModel.ts'

const ADVICE_MS = 8000
const PAUSE_MS = 1500

type AdviceField = 'name' | 'description'

type Mark = { span: Span; key: string }

/** Лист «Товар»: в правке — поля, после заполнения — текст поставщика с маркером найденного. */
export function DescriptionField({
  editing,
  name,
  description,
  onName,
  onDescription,
  onSubmit,
  marks,
  hover,
  onHover,
  busy,
}: {
  editing: boolean
  name: string
  description: string
  onName: (v: string) => void
  onDescription: (v: string) => void
  onSubmit: () => void
  marks: Mark[]
  hover: string | null
  onHover: (key: string | null) => void
  busy: boolean
}) {
  const [advice, setAdvice] = useState<{ field: AdviceField; text: string } | null>(null)
  const adviceRef = useRef<HTMLParagraphElement>(null)
  const timers = useRef<Partial<Record<AdviceField, number>>>({})
  const told = useRef<Record<AdviceField, string>>({ name: '', description: '' })
  const latest = useRef({ name, description })

  useEffect(() => {
    latest.current.name = name
    latest.current.description = description
  }, [name, description])

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of Object.values(pending)) window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!advice) return
    const hide = window.setTimeout(() => setAdvice(null), ADVICE_MS)
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && adviceRef.current?.contains(target)) return
      setAdvice(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAdvice(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(hide)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [advice])

  const reveal = (field: AdviceField, value: string) => {
    const text = quantityAdvice(value)
    if (!text) {
      told.current[field] = ''
      setAdvice((current) => (current?.field === field ? null : current))
      return
    }
    if (told.current[field] === text) return
    told.current[field] = text
    setAdvice({ field, text })
  }

  const schedule = (field: AdviceField, value: string) => {
    window.clearTimeout(timers.current[field])
    timers.current[field] = window.setTimeout(() => reveal(field, value), PAUSE_MS)
  }

  const flush = (field: AdviceField, value: string) => {
    window.clearTimeout(timers.current[field])
    reveal(field, value)
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Field label="Наименование" required hint="Как в заявке на создание СТЕ">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={name}
                onChange={(e) => {
                  latest.current.name = e.target.value
                  onName(e.target.value)
                  schedule('name', e.target.value)
                }}
                onBlur={() => flush('name', latest.current.name)}
                disabled={busy}
              />
            )}
          </Field>
          {advice?.field === 'name' && <QuantityAdvice text={advice.text} noteRef={adviceRef} />}
        </div>
        <div className="flex flex-col gap-2">
          <Field label="Описание" hint="Свободным текстом, как в документах поставщика. Ctrl+Enter: заполнить">
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                value={description}
                onChange={(e) => {
                  latest.current.description = e.target.value
                  onDescription(e.target.value)
                  schedule('description', e.target.value)
                }}
                onBlur={() => flush('description', latest.current.description)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSubmit()
                }}
                rows={6}
                spellCheck={false}
                disabled={busy}
                className="font-serif text-[16px] leading-[1.7]"
              />
            )}
          </Field>
          {advice?.field === 'description' && <QuantityAdvice text={advice.text} noteRef={adviceRef} />}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[17px] font-semibold text-ink">
        <MarkedText text={name} marks={marks.filter((m) => m.span.field === 'name')} hover={hover} onHover={onHover} />
      </p>
      {description ? (
        <p className="font-serif text-[17px] leading-[1.75] whitespace-pre-line text-ink/90">
          <MarkedText text={description} marks={marks.filter((m) => m.span.field === 'description')} hover={hover} onHover={onHover} />
        </p>
      ) : (
        <p className="text-sm text-muted">Описания нет: характеристики взяты из наименования.</p>
      )}
    </div>
  )
}

function QuantityAdvice({ text, noteRef }: { text: string; noteRef: RefObject<HTMLParagraphElement | null> }) {
  return (
    <p ref={noteRef} role="status" className="rounded-(--radius-ui) border border-line bg-raised px-3 py-2 text-[13px] leading-snug text-muted">
      <span className="font-medium text-ink">Рекомендация. </span>
      {text}
    </p>
  )
}

function MarkedText({ text, marks, hover, onHover }: { text: string; marks: Mark[]; hover: string | null; onHover: (k: string | null) => void }) {
  const segments = highlightSegments(
    text,
    marks.map((m) => ({ start: m.span.start, end: m.span.end, key: m.key })),
  )
  return (
    <>
      {segments.map((s, i) =>
        s.mark ? (
          <mark
            key={i}
            onMouseEnter={() => onHover(s.key)}
            onMouseLeave={() => onHover(null)}
            className={cx('marker rounded-[2px] px-0.5 text-ink', hover === s.key && 'outline outline-1 outline-ink/40')}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}
