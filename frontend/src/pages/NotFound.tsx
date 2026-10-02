import { PageBody, PageHeader } from '../layout/Layout'
import { navigate } from '../lib/router'
import { EmptyState } from '../ui'

export function NotFound() {
  return (
    <>
      <PageHeader title="Страница не найдена" />
      <PageBody>
        <EmptyState
          title="Такого раздела нет"
          action={
            <a href="/" onClick={(e) => navigate(e, '/')} className="text-sm text-link underline underline-offset-4">
              Перейти к созданию СТЕ
            </a>
          }
        >
          Проверьте адрес или откройте форму создания СТЕ.
        </EmptyState>
      </PageBody>
    </>
  )
}
