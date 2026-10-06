import { Suspense, lazy, useEffect } from 'react'

/*
 * Новый дизайн (прототип на MUI): модуль заполняет саму форму карточки, а не показывает отчёт о проверке.
 * Отдельный маршрут вне навигации, пока экраны приложения не переведены на него. MUI грузится отдельным чанком.
 */

const MuiFormScreen = lazy(() => import('./MuiFormScreen'))

export function PreviewPage() {
  useEffect(() => {
    document.title = 'Новая СТЕ: прототип'
  }, [])
  return (
    <Suspense fallback={<p className="p-6 font-sans text-sm">Загрузка…</p>}>
      <MuiFormScreen />
    </Suspense>
  )
}
