import type { ReactNode } from 'react'
import { cx } from '../lib/cx'
import { navigate } from '../lib/router'

/** native: обычный переход со страницы на страницу, без history.pushState (другая точка входа Vite). */
export type NavItem = { href: string; label: string; native?: boolean }

/** Группа разделов шапки; role — чья это работа («Поставщик», «Модератор»). */
export type NavGroup = { role?: string; items: NavItem[] }

/** Название в шапке — что делает модуль, а не бренд. Меняется здесь и в index.html. */
export const PRODUCT_NAME = 'Автозаполнение характеристик СТЕ'

type AppHeaderProps = {
  groups: NavGroup[]
  /** Разделы справа: для жюри и разработчиков портала. */
  aside?: NavItem[]
  /** href активного раздела; null — ни один не подсвечен. */
  current: string | null
  /** Роли переключателем: видны только разделы выбранной роли. Иначе — все разделы с подписью роли. */
  roleSwitch?: boolean
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <a
      href={item.href}
      onClick={item.native ? undefined : (e) => navigate(e, item.href)}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex h-11 shrink-0 items-center text-sm transition-colors duration-150 focus-visible:outline-chrome-ink md:h-auto',
        'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5',
        active ? 'text-chrome-accent after:bg-chrome-accent' : 'text-chrome-muted hover:text-chrome-ink',
      )}
    >
      {item.label}
    </a>
  )
}

/** Переключатель роли: ведёт на первый раздел роли. Это ссылки, а не вкладки: каждая роль — свой адрес. */
function RoleSwitch({ groups, active }: { groups: NavGroup[]; active: NavGroup }) {
  return (
    <div aria-label="Роль" role="group" className="flex shrink-0 rounded-(--radius-ui) border border-chrome-line p-0.5">
      {groups.map((group) => {
        const href = group.items[0]?.href ?? '/'
        const on = group === active
        return (
          <a
            key={group.role}
            href={href}
            onClick={(e) => navigate(e, href)}
            aria-current={on ? 'true' : undefined}
            className={cx(
              'flex h-7 items-center rounded-[3px] px-2.5 text-[13px] transition-colors duration-150 focus-visible:outline-chrome-ink',
              on ? 'bg-accent-soft font-medium text-accent-text' : 'text-chrome-muted hover:text-chrome-ink',
            )}
          >
            {group.role}
          </a>
        )
      })}
    </div>
  )
}

/** Шапка: название, разделы по ролям, справа служебные для жюри разделы. Без плашек: только текст и линия. */
export function AppHeader({ groups, aside = [], current, roleSwitch = false }: AppHeaderProps) {
  // Роль экрана — группа, где есть текущий раздел; на «Метриках» и «API» остаётся первая.
  const activeGroup = groups.find((g) => g.items.some((i) => i.href === current)) ?? groups[0]
  const shown = roleSwitch && activeGroup ? [activeGroup] : groups
  return (
    <header className="sticky top-0 z-20 border-b border-chrome-line bg-chrome">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-40 focus:rounded-(--radius-ui) focus:bg-surface focus:px-4 focus:py-2 focus:text-ink"
      >
        Перейти к содержимому
      </a>
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-8 px-4 md:h-13 md:flex-nowrap md:px-6">
        <a href="/" onClick={(e) => navigate(e, '/')} className="flex h-13 shrink-0 items-center focus-visible:outline-chrome-ink">
          <span className="text-[15px] font-semibold tracking-tight text-chrome-ink">{PRODUCT_NAME}</span>
        </a>
        <nav
          aria-label="Разделы"
          className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-6 overflow-x-auto border-t border-chrome-line px-4 md:mx-0 md:w-auto md:flex-1 md:self-stretch md:border-t-0 md:p-0"
        >
          {roleSwitch && activeGroup && <RoleSwitch groups={groups} active={activeGroup} />}
          {shown.map((group) => (
            <div key={group.role ?? group.items[0]?.href} className="flex shrink-0 items-center gap-5 self-stretch">
              {!roleSwitch && group.role && <span className="text-xs text-chrome-muted">{group.role}</span>}
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={item.href === current} />
              ))}
            </div>
          ))}
          {aside.length > 0 && (
            <div className="flex shrink-0 items-center gap-5 self-stretch md:ml-auto">
              {aside.map((item) => (
                <NavLink key={item.href} item={item} active={item.href === current} />
              ))}
            </div>
          )}
        </nav>
      </div>
    </header>
  )
}

type PageHeaderProps = { title: string; description?: ReactNode; actions?: ReactNode }

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 pt-8 pb-2 md:flex-row md:items-end md:justify-between md:px-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-ink md:text-[26px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-[65ch] text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  // id — цель ссылки «Перейти к содержимому» из AppHeader.
  return (
    <main id="content" tabIndex={-1} className={cx('mx-auto w-full max-w-[1280px] px-4 py-6 outline-none md:px-6', className)}>
      {children}
    </main>
  )
}
