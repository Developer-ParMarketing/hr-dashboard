import { Link } from 'react-router-dom'
import type { AuthUser } from '../api/auth'
import { getGroupedModules } from '../modules/access'
import type { ModuleDefinition } from '../modules/types'
import { ModuleIcon } from './ModuleIcon'

function ModuleTile({ module }: { module: ModuleDefinition }) {
  const soon = Boolean(module.comingSoon)
  return (
    <Link
      to={module.href}
      className={`module-tile${soon ? ' module-tile-soon' : ' module-tile-live'}`}
      title={soon ? `${module.description} (Coming soon)` : module.description}
    >
      <span className="module-tile-icon" aria-hidden>
        <ModuleIcon id={module.id} className="h-6 w-6" />
      </span>
      <span className="module-tile-body">
        <span className="module-tile-title-row">
          <span className="module-tile-title">{module.label}</span>
          {soon ? <span className="module-tile-soon-badge">Coming soon</span> : null}
        </span>
        <span className="module-tile-desc">{module.description}</span>
      </span>
    </Link>
  )
}

export function ModuleLauncher({ user }: { user: AuthUser }) {
  const grouped = getGroupedModules(user)
  const liveCount = grouped.reduce((n, g) => n + g.live.length, 0)
  const soonCount = grouped.reduce((n, g) => n + g.upcoming.length, 0)

  return (
    <section className="mb-8">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-warm-text)]">
            All modules
          </h2>
          <p className="mt-1 text-sm text-[var(--color-warm-text)]">
            {liveCount} available
            {soonCount > 0 ? ` · ${soonCount} coming soon` : ''}.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {grouped.map(({ group, live, upcoming }) => (
          <div key={group.id}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-brand)]">
              {group.label}
            </h3>
            {live.length > 0 ? (
              <div className="module-launcher-grid">
                {live.map((module) => (
                  <ModuleTile key={module.id} module={module} />
                ))}
              </div>
            ) : null}
            {upcoming.length > 0 ? (
              <div className={live.length > 0 ? 'mt-3' : undefined}>
                <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-warm-text)]">
                  Coming soon
                </p>
                <div className="module-launcher-grid">
                  {upcoming.map((module) => (
                    <ModuleTile key={module.id} module={module} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}
