import { useEffect, useState, type MouseEvent } from 'react'

// Две страницы роутер-библиотеки не стоят: путь в history, nginx отдаёт index.html на любой путь.

export function currentLocation(): string {
  return window.location.pathname + window.location.search + window.location.hash
}

/** Путь без query и hash: по нему выбирается экран. */
export function routePath(location: string): string {
  const path = location.split(/[?#]/)[0] || '/'
  return path.startsWith('/') ? path : `/${path}`
}

export function useLocation(): string {
  const [location, setLocation] = useState(currentLocation)
  useEffect(() => {
    const onPop = () => setLocation(currentLocation())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return location
}

export function usePath(): string {
  return routePath(useLocation())
}

/** Переход без перезагрузки; ctrl/cmd-клик и средняя кнопка открывают вкладку как обычно. */
export function navigate(event: MouseEvent<HTMLAnchorElement>, to: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
  event.preventDefault()
  if (currentLocation() === to) return
  window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
  if (!to.includes('#')) window.scrollTo(0, 0)
}
