import { Field, Input, Textarea } from '../../ui'
import { cx } from '../../lib/cx'
import type { Span } from '../../api/v1.ts'
import { highlightSegments } from './createModel.ts'

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
  if (editing) {
    return (
      <div className="flex flex-col gap-5">
        <Field label="Наименование" required hint="Как в заявке на создание СТЕ">
          {({ id, describedBy }) => (
            <Input id={id} aria-describedby={describedBy} value={name} onChange={(e) => onName(e.target.value)} disabled={busy} />
          )}
        </Field>
        <Field label="Описание" hint="Свободным текстом, как в документах поставщика. Ctrl+Enter: заполнить">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={description}
              onChange={(e) => onDescription(e.target.value)}
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
