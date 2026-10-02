import type { ReactNode } from 'react'
import { AppHeader } from './layout/Layout'
import { usePath } from './lib/router'
import { BatchPage } from './pages/batch/BatchPage'
import { CreatePage } from './pages/create/CreatePage'
import { DevelopersPage } from './pages/developers/DevelopersPage'
import { MetricsPage } from './pages/metrics/MetricsPage'
import { ModerationPage } from './pages/moderation/ModerationPage'
import { NotFound } from './pages/NotFound'
import { UiKitPage } from './pages/UiKitPage'
import { NAV_ASIDE, NAV_GROUPS, navHref, resolveRoute, type RouteId } from './routes'

const SCREENS: Record<RouteId, () => ReactNode> = {
  create: () => <CreatePage />,
  batch: () => <BatchPage />,
  moderation: () => <ModerationPage />,
  metrics: () => <MetricsPage />,
  developers: () => <DevelopersPage />,
  ui: () => <UiKitPage />,
  'not-found': () => <NotFound />,
}

export default function App() {
  const route = resolveRoute(usePath())
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader groups={NAV_GROUPS} aside={NAV_ASIDE} current={navHref(route)} roleSwitch />
      {SCREENS[route]()}
    </div>
  )
}
