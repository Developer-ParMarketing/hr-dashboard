import { useLayoutEffect, useMemo, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { AuthUser } from '../api/auth'
import { getGroupedModules } from '../modules/access'
import type { ModuleDefinition, ModuleId } from '../modules/types'
import { ModuleIcon } from './ModuleIcon'

const BRAND_LOGO = '/par-marketing-logo.png'
const SIDEBAR_SCROLL_KEY = 'par-hr-sidebar-scroll'

function readSidebarScrollTop(): number | null {
  try {
    const raw = sessionStorage.getItem(SIDEBAR_SCROLL_KEY)
    if (raw == null) return null
    const top = Number.parseInt(raw, 10)
    return Number.isFinite(top) ? top : null
  } catch {
    return null
  }
}

function writeSidebarScrollTop(top: number) {
  try {
    sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(top))
  } catch {
    /* ignore quota / private mode */
  }
}

function restoreSidebarScroll(el: HTMLDivElement | null) {
  const top = readSidebarScrollTop()
  if (el == null || top == null) return
  el.scrollTop = top
}

type ModuleNavProps = {
  user: AuthUser
  active: ModuleId
  mobileOpen: boolean
  onNavigate?: () => void
  onClose?: () => void
}

function NavItem({
  module,
  active,
  onNavigate,
}: {
  module: ModuleDefinition
  active: boolean
  onNavigate?: () => void
}) {
  const soon = Boolean(module.comingSoon)
  return (
    <Link
      to={module.href}
      onClick={onNavigate}
      className={`app-nav-item${active ? ' app-nav-item-active' : ''}${soon ? ' app-nav-item-soon' : ''}`}
      aria-current={active ? 'page' : undefined}
      title={soon ? `${module.description} (Coming soon)` : module.description}
    >
      <ModuleIcon id={module.id} className="app-nav-icon-svg" />
      <span className="app-nav-label">{module.label}</span>
      {soon ? <span className="app-nav-soon-badge">Soon</span> : null}
    </Link>
  )
}

function NavModuleList({
  modules,
  active,
  onNavigate,
}: {
  modules: ModuleDefinition[]
  active: ModuleId
  onNavigate?: () => void
}) {
  return (
    <div className="app-sidebar-items">
      {modules.map((module) => (
        <NavItem
          key={module.id}
          module={module}
          active={module.id === active}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  )
}

export function ModuleNav({ user, active, mobileOpen, onNavigate, onClose }: ModuleNavProps) {
  const groups = useMemo(() => getGroupedModules(user), [user])
  const scrollRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useLayoutEffect(() => {
    restoreSidebarScroll(scrollRef.current)
    const id = requestAnimationFrame(() => restoreSidebarScroll(scrollRef.current))
    return () => cancelAnimationFrame(id)
  }, [location.pathname])

  return (
    <nav className={`app-sidebar${mobileOpen ? ' app-sidebar-open' : ''}`} aria-label="HR modules">
      <div className="app-sidebar-brand">
        <Link to="/" onClick={onNavigate} className="inline-flex">
          <img
            src={BRAND_LOGO}
            alt="Par Marketing"
            className="h-8 w-auto max-w-[160px] object-contain"
            width={240}
            height={72}
          />
        </Link>
        <button type="button" className="app-sidebar-close lg:hidden" aria-label="Close menu" onClick={onClose}>
          ×
        </button>
      </div>

      <div
        ref={scrollRef}
        className="app-sidebar-scroll"
        onScroll={(e) => writeSidebarScrollTop(e.currentTarget.scrollTop)}
      >
        {groups.map(({ group, live, upcoming }) => (
          <div key={group.id} className="app-nav-group">
            <p className="app-nav-group-label">{group.label}</p>
            {live.length > 0 ? <NavModuleList modules={live} active={active} onNavigate={onNavigate} /> : null}
            {upcoming.length > 0 ? (
              <div className="app-nav-upcoming">
                <p className="app-nav-upcoming-label">Coming soon</p>
                <NavModuleList modules={upcoming} active={active} onNavigate={onNavigate} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </nav>
  )
}
