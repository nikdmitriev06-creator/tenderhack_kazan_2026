// Ссылка из массовой загрузки в форму. Всё нужное — в адресе: средняя кнопка и обновление
// страницы открывают ту же характеристику, без sessionStorage.

export const CHARACTERISTICS_SECTION = 'characteristics'

export type FormTarget = {
  name: string
  description: string
  ktru: string | null
  job: string | null
  row: string | null
}

export function characteristicsHref(input: {
  name: string
  description?: string
  ktru?: string | null
  job?: string | null
  row?: number | string | null
}): string {
  const query = new URLSearchParams()
  query.set('section', CHARACTERISTICS_SECTION)
  query.set('name', input.name)
  if (input.description) query.set('description', input.description)
  if (input.ktru) query.set('ktru', input.ktru)
  if (input.job) query.set('job', input.job)
  if (input.row !== undefined && input.row !== null && input.row !== '') query.set('row', String(input.row))
  return `/?${query.toString()}#${CHARACTERISTICS_SECTION}`
}

export function readFormTarget(search: string): FormTarget | null {
  const raw = (search.split('#')[0] ?? '').trim()
  const queryText = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw.replace(/^\?/, '')
  const query = new URLSearchParams(queryText)
  if (query.get('section') !== CHARACTERISTICS_SECTION) return null
  const name = (query.get('name') ?? '').trim()
  if (!name) return null
  return {
    name,
    description: query.get('description') ?? '',
    ktru: query.get('ktru') || null,
    job: query.get('job') || null,
    row: query.get('row') || null,
  }
}
