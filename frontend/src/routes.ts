import type { NavGroup, NavItem } from './layout/Layout'

export type RouteId = 'create' | 'batch' | 'moderation' | 'metrics' | 'developers' | 'ui' | 'preview' | 'not-found'

const PATHS: Record<string, RouteId> = {
  '/': 'create',
  '/batch': 'batch',
  '/moderation': 'moderation',
  '/metrics': 'metrics',
  '/developers': 'developers',
  // Витрина компонентов дизайн-системы: для разработки, в навигацию не входит.
  '/ui': 'ui',
  // Пробная сборка: сравнение дизайн-систем (временно), вне навигации.
  '/preview': 'preview',
}

export function resolveRoute(path: string): RouteId {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path
  return Object.hasOwn(PATHS, clean) ? PATHS[clean] : 'not-found'
}

/** Разделы образца портала по ролям: так их увидят поставщик и модератор. */
export const NAV_GROUPS: NavGroup[] = [
  {
    role: 'Поставщик',
    items: [
      { href: '/', label: 'Создание СТЕ' },
      { href: '/batch', label: 'Массовая загрузка' },
    ],
  },
  { role: 'Модератор', items: [{ href: '/moderation', label: 'Заявки' }] },
]

/** Справа в шапке: для жюри и для разработчиков портала. */
export const NAV_ASIDE: NavItem[] = [
  { href: '/metrics', label: 'Метрики' },
  { href: '/developers', label: 'API' },
]

/** Пункт навигации, который подсвечивается на экране (у not-found и ui — никакой). */
export function navHref(route: RouteId): string | null {
  const entry = Object.entries(PATHS).find(([, id]) => id === route)
  return entry && route !== 'ui' && route !== 'preview' ? entry[0] : null
}
