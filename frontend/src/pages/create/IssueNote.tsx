import type { Issue } from '../../api/v1.ts'
import { cx } from '../../lib/cx'
import { fieldLabel } from './createModel.ts'

function fixLabel(issue: Issue): string | null {
  const fix = issue.fix
  if (!fix) return null
  if (issue.field === 'name' && fix.value) return `Исправить наименование: «${fix.value}»`
  if (fix.name && fix.unit) return `Исправить: «${fix.name}», единица «${fix.unit}»`
  if (fix.name) return `Исправить название: «${fix.name}»`
  if (fix.value) return `Исправить: указать «${fix.value}»`
  return null
}

/** Замечания на полях: номер красным карандашом, что не так, почему (правило) и чем исправить. */
export function IssueList({ issues, onFix, locked }: { issues: Issue[]; onFix: (issue: Issue) => void; locked: boolean }) {
  if (issues.length === 0) return <p className="text-sm text-success">Замечаний нет.</p>
  const ordered = [...issues].sort((a, b) => Number(b.severity === 'block') - Number(a.severity === 'block'))
  return (
    <ol className="flex flex-col gap-4">
      {ordered.map((issue, i) => {
        const label = fixLabel(issue)
        return (
          <li key={`${issue.field}-${issue.kind}-${i}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
            <span className={cx('pt-px text-[15px] font-semibold tabular-nums', issue.severity === 'block' ? 'text-pencil' : 'text-muted')}>
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] text-muted">{fieldLabel(issue.field)}</p>
              <p className="text-[15px] font-medium text-ink">{issue.message}</p>
              <p className="mt-0.5 text-[13px] text-muted">{issue.why}</p>
              {issue.severity === 'block' && <p className="mt-0.5 text-xs text-pencil">Без исправления заявку вернут с модерации.</p>}
              {label && !locked && (
                <button
                  type="button"
                  onClick={() => onFix(issue)}
                  className="mt-1 text-left text-[13px] font-medium text-link underline decoration-link/35 underline-offset-4 hover:decoration-link"
                >
                  {label}
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
