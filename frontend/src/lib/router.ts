import { useEffect, useState, type MouseEvent } from 'react'

// Две страницы роутер-библиотеки не стоят: путь в history, nginx отдаёт index.html на любой путь.
export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return path
}

/** Переход без перезагрузки; ctrl/cmd-клик и средняя кнопка открывают вкладку как обычно. */
export function navigate(event: MouseEvent<HTMLAnchorElement>, to: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  event.preventDefault()
  if (window.location.pathname === to) return
  window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}
